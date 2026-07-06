import { bookRegistry } from "../../api/services/BookRegistry.js";
import { OrderCommandType } from "./OrderCommandTypes.js";

export function executeOrderCommand(command) {
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