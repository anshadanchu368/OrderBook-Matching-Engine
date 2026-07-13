import { connectRabbitMQ } from "../infrastructure/rabbitmq/rabbitConnection.js";
import { RabbitQueue, getOrderCommandQueueName } from "../infrastructure/rabbitmq/rabbitConfig.js";
import { createOrderRejectedEvent } from "../engine/DomainEvent.js";
import { redisBookReadModel } from "../infrastructure/redis/RedisBookReadModel.js";
import { redisCommandStatusStore } from "../infrastructure/redis/RedisCommandStatusStore.js";
import { CommandStatus } from "../application/commands/CommandStatus.js";
import { redisEventLog } from "../infrastructure/redis/RedisEventLog.js";
import { redisCommandLog } from "../infrastructure/redis/RedisCommandLog.js";
import { executeOrderCommand } from "../application/commands/executeOrderCommand.js";
import { redisRecoverySnapshotStore } from "../infrastructure/redis/RedisRecoverySnapshotStore.js";
import { publishMarketEvents } from "../infrastructure/redis/RedisMarketEventPubSub.js";
import { getPartitionId } from "../application/partitioning/symbolPartitioner.js";

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

export async function startOrderCommandWorker({
  hasLeadership = async () => true,
  onLeadershipLost = async () => {},
  partitionId = 0,
  partitionCount = 1,
} = {}) {
  const channel = await connectRabbitMQ({ partitionId, partitionCount });

  await channel.prefetch(1);

  let stopped = false;
  let leadershipLossReported = false;

  const reportLeadershipLost = () => {
    if (leadershipLossReported) {
      return;
    }

    leadershipLossReported = true;
    void onLeadershipLost();
  };

  const checkLeadership = async () => {
    if (stopped) {
      return false;
    }

    try {
      return await hasLeadership();
    } catch (error) {
      console.error("[leader] ownership check failed", {
        message: error.message,
      });
      return false;
    }
  };

  // Determine which queue to consume from
  const targetQueue = typeof partitionId === "number"
    ? getOrderCommandQueueName(partitionId)
    : getOrderCommandQueueName(0);

  const consumer = await channel.consume(
    targetQueue,
    async (message) => {
      if (!message) {
        return;
      }

      if (!(await checkLeadership())) {
        channel.nack(message, false, true);
        reportLeadershipLost();
        return;
      }

      try {
        const command = parseMessage(message);

        // Validate command belongs to this partition
        const commandPartitionId = getPartitionId(command.symbol, partitionCount);
        if (commandPartitionId !== partitionId) {
          console.error("[worker] partition mismatch", {
            symbol: command.symbol,
            expectedPartition: partitionId,
            actualPartition: commandPartitionId,
          });
          // Move to DLQ
          channel.nack(message, false, false);
          return;
        }

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

        if (!(await checkLeadership())) {
          channel.nack(message, false, true);
          reportLeadershipLost();
          return;
        }

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

        const stillLeader = await checkLeadership();

        channel.ack(message);

        void publishMarketEvents(command.symbol, result.events ?? []);

        if (!stillLeader) {
          reportLeadershipLost();
        }

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

  console.log(`Order command worker consuming ${targetQueue}`);

  return {
    async stop() {
      if (stopped) {
        return;
      }

      stopped = true;
      await channel.cancel(consumer.consumerTag);
    },
  };
}
