import { OrderCommandType } from "../application/commands/OrderCommandTypes.js";
import { bookRegistry } from "../api/services/BookRegistry.js";
import { broadcastDomainEvents } from "../api/websocket/socketServer.js";
import { connectRabbitMQ } from "../infrastructure/rabbitmq/rabbitConnection.js";
import { RabbitQueue } from "../infrastructure/rabbitmq/rabbitConfig.js";
import { createOrderRejectedEvent } from "../engine/DomainEvent.js";

function parseMessage(message) {
  return JSON.parse(message.content.toString("utf8"));
}

function executeOrderCommand(command) {
  const { type, symbol, payload } = command;

  const book = bookRegistry.getOrCreateBook(symbol);

  switch (type) {
    case OrderCommandType.PLACE_LIMIT_ORDER:
      return book.placeLimitOrder(payload);

    case OrderCommandType.PLACE_MARKET_ORDER:
      return book.placeMarketOrder(payload);

    case OrderCommandType.PLACE_STOP_MARKET_ORDER:
      return book.placeStopMarketOrder(payload);

    case OrderCommandType.PLACE_STOP_LIMIT_ORDER:
      return book.placeStopLimitOrder(payload);

    case OrderCommandType.PLACE_TRAILING_STOP_MARKET_ORDER:
      return book.placeTrailingStopMarketOrder(payload);

    case OrderCommandType.CANCEL_ORDER:
      return book.cancelOrder(payload.orderId);

    default:
      throw new Error(`unsupported order command type: ${type}`);
  }
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

        const result = executeOrderCommand(command);

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
