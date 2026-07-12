import { connectRabbitMQ } from "../infrastructure/rabbitmq/rabbitConnection.js";
import { RabbitQueue } from "../infrastructure/rabbitmq/rabbitConfig.js";
import { createOrderRejectedEvent } from "../engine/DomainEvent.js";
import { redisBookReadModel } from "../infrastructure/redis/RedisBookReadModel.js";
import { redisCommandStatusStore } from "../infrastructure/redis/RedisCommandStatusStore.js";
import { CommandStatus } from "../application/commands/CommandStatus.js";
import { redisEventLog } from "../infrastructure/redis/RedisEventLog.js";
import { redisCommandLog } from "../infrastructure/redis/RedisCommandLog.js";
import { executeOrderCommand } from "../application/commands/executeOrderCommand.js";
import { redisRecoverySnapshotStore } from "../infrastructure/redis/RedisRecoverySnapshotStore.js";
import { publishMarketEvents } from "../infrastructure/redis/RedisMarketEventPubSub.js";

function parseMessage(message) {
  return JSON.parse(message.content.toString("utf8"));
}

async function updateCommandStatus(command, status, reason = null) {

  await redisCommandStatusStore.saveStatus({
    commandId: command.commandId,
    symbol: command.symbol,
    type: command.type,
    status,
    reason,
    createdAt: command.createdAt,
    updatedAt: Date.now()
  });
}


async function saveReadModel(symbol, book, result) {
  const snapshot = book.snapshot();

  await redisBookReadModel.saveSnapshot(symbol, snapshot);
  await redisBookReadModel.appendTrades(symbol, result.trades ?? []);
}

export async function startOrderCommandWorker() {
  const channel = await connectRabbitMQ();

  await channel.prefetch(1);

  await channel.consume(
    RabbitQueue.ORDER_COMMANDS,
    async (message) => {
      if (!message) {
        return;
      }

      try {
        const command = parseMessage(message);

        const alreadyProcessed = await redisCommandLog.isCommandProcessed(
          command.symbol,
          command.commandId,
        );

        if (alreadyProcessed) {
          await updateCommandStatus(command, CommandStatus.PROCESSED);
          channel.ack(message);
          return;
        }

        const { book, result } = executeOrderCommand(command);

        const commandLogEntryId = await redisCommandLog.appendProcessedCommand(command);


        await redisEventLog.appendEvents(command.symbol, result.events ?? []);

        await saveReadModel(command.symbol, book, result);

        await redisRecoverySnapshotStore.saveSnapshot(
          command.symbol,
          book.toRecoverySnapshot({
            lastCommandStreamId: commandLogEntryId,
          })
        )

        await updateCommandStatus(command, CommandStatus.PROCESSED);

        channel.ack(message);

        void publishMarketEvents(command.symbol, result.events ?? []);

        console.log(`Order command processed: ${command.type}`, {
          commandId: command.commandId,
          symbol: command.symbol,
        });
      } catch (error) {
        console.error("Order command failed:", error);

        try {
          const command = parseMessage(message);

          const rejectedEvent = createOrderRejectedEvent({
            symbol: command.symbol,
            commandId: command.commandId,
            orderId: command.payload?.orderId ?? null,
            commandType: command.type,
            reason: error.message,
          });
          await updateCommandStatus(command, CommandStatus.REJECTED, error.message);

          channel.ack(message);

          void publishMarketEvents(command.symbol, [rejectedEvent]);
        } catch (rejectionError) {
          console.error("Failed to create rejection event:", rejectionError);

          channel.nack(message, false, false);
        }
      }
    },
    {
      noAck: false,
    },
  );

  console.log(`Order command worker consuming ${RabbitQueue.ORDER_COMMANDS}`);
}
