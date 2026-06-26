import { isValidSide } from "../Constants.js";

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
  price,
  quantity,
  timestamp,
}) {
  assertNonEmptyString("orderId", orderId);
  assertNonEmptyString("userId", userId);
  assertNonEmptyString("symbol", symbol);

  assert(isValidSide(side), `invalid order side: ${side}`);

  assertPositiveNumber("price", price);
  assertPositiveInteger("quantity", quantity);
  assertNonNegativeInteger("timestamp", timestamp);
}