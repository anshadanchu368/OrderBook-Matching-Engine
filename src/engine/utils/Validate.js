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
  priceTicks,
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
    assertPositiveInteger("priceTicks", priceTicks);
  }

  if (type === OrderType.MARKET) {
    assert(
      priceTicks === null || priceTicks === undefined,
      "market order price must be null or undefined",
    );
  }
}