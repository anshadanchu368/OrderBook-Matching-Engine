import { OrderCommandType } from "../application/commands/OrderCommandTypes.js";
import { bookRegistry } from "../api/services/BookRegistry.js";
import { broadcastDomainEvents } from "../api/websocket/socketServer.js";
import { connectRabbitMQ } from "../infrastructure/rabbitmq/rabbitConnection.js";
import { RabbitQueue } from "../infrastructure/rabbitmq/rabbitConfig.js";
import { createOrderRejectedEvent } from "../engine/DomainEvent.js";
import { redisBookReadModel } from "../infrastructure/redis/RedisBookReadModel.js";
import { redisCommandStatusStore } from "../infrastructure/redis/RedisCommandStatusStore.js";
import { CommandStatus } from "../application/commands/CommandStatus.js";

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

function executeOrderCommand(command) {
  const { type, symbol, payload } = command;
  const book = bookRegistry.getOrCreateBook(symbol);

  switch (type) {
    case OrderCommandType.PLACE_LIMIT_ORDER:
      return {
        book,
        result: book.placeLimitOrder(payload),
      };

    case OrderCommandType.PLACE_MARKET_ORDER:
      return {
        book,
        result: book.placeMarketOrder(payload),
      };

    case OrderCommandType.PLACE_STOP_MARKET_ORDER:
      return {
        book,
        result: book.placeStopMarketOrder(payload),
      };

    case OrderCommandType.PLACE_STOP_LIMIT_ORDER:
      return {
        book,
        result: book.placeStopLimitOrder(payload),
      };

    case OrderCommandType.PLACE_TRAILING_STOP_MARKET_ORDER:
      return {
        book,
        result: book.placeTrailingStopMarketOrder(payload),
      };

    case OrderCommandType.CANCEL_ORDER:
      return {
        book,
        result: book.cancelOrder(payload.orderId),
      };

    default:
      throw new Error(`unsupported order command type: ${type}`);
  }
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

        const {book,result} = executeOrderCommand(command);
        await saveReadModel(command.symbol, book, result);

        await updateCommandStatus(command, CommandStatus.PROCESSED);

        broadcastDomainEvents(command.symbol, result.events ?? []);

        channel.ack(message);

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
          broadcastDomainEvents(command.symbol, [rejectedEvent]);

          channel.ack(message);
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
