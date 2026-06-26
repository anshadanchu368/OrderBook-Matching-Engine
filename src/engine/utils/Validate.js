import {
  OrderType,
  isValidOrderType,
  isValidSide,
} from "../Constants.js";

import {
  assert,
  assertNonEmptyString,
  assertPositiveNumber,
  assertPositiveInteger,
  assertNonNegativeInteger,
} from "./Assertions.js";

export function validateOrderInput({
  orderId,
  userId,
  symbol,
  side,
  type = OrderType.LIMIT,
  price,
  quantity,
  timestamp,
}) {
  assertNonEmptyString("orderId", orderId);
  assertNonEmptyString("userId", userId);
  assertNonEmptyString("symbol", symbol);

  assert(isValidSide(side), `invalid order side: ${side}`);
  assert(isValidOrderType(type), `invalid order type: ${type}`);

  assertPositiveInteger("quantity", quantity);
  assertNonNegativeInteger("timestamp", timestamp);

  if (type === OrderType.LIMIT) {
    assertPositiveNumber("price", price);
  }

  if (type === OrderType.MARKET) {
    assert(
      price === null || price === undefined,
      "market order price must be null or undefined",
    );
  }
}