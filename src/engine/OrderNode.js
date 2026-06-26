import { OrderStatus, OrderType } from "./Constants.js";
import { validateOrderInput } from "./utils/Validate.js";

export class OrderNode {
  constructor({
    orderId,
    userId,
    side,
    symbol,
    type = OrderType.LIMIT,
    price = null,
    quantity,
    timestamp,
  }) {
    validateOrderInput({
      orderId,
      userId,
      side,
      symbol,
      type,
      price,
      quantity,
      timestamp,
    });

    this.orderId = orderId;
    this.userId = userId;
    this.side = side;
    this.symbol = symbol;
    this.type = type;
    this.price = price;
    this.timestamp = timestamp;

    this.initialQuantity = quantity;
    this.remainingQuantity = quantity;

    this.status = OrderStatus.OPEN;

    this.prev = null;
    this.next = null;

    this.priceLevel = null;
  }

  get filledQuantity() {
    return this.initialQuantity - this.remainingQuantity;
  }

  get isFilled() {
    return this.status === OrderStatus.FILLED;
  }

  get isCancelled() {
    return this.status === OrderStatus.CANCELLED;
  }

  get isActive() {
    return !this.isFilled && !this.isCancelled;
  }

  get isMarketOrder() {
    return this.type === OrderType.MARKET;
  }

  get isLimitOrder() {
    return this.type === OrderType.LIMIT;
  }

  fill(quantity) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("fill quantity must be a positive integer");
    }

    if (!this.isActive) {
      throw new Error(`order ${this.orderId} is already ${this.status}`);
    }

    if (quantity > this.remainingQuantity) {
      throw new Error("fill quantity exceeds remaining quantity");
    }

    this.remainingQuantity -= quantity;

    this.status =
      this.remainingQuantity === 0
        ? OrderStatus.FILLED
        : OrderStatus.PARTIALLY_FILLED;
  }

  cancel() {
    if (!this.isActive) {
      throw new Error(`order ${this.orderId} is already ${this.status}`);
    }

    this.status = OrderStatus.CANCELLED;
  }

  detachLinks() {
    this.prev = null;
    this.next = null;
    this.priceLevel = null;
  }

  snapshot() {
    return {
      orderId: this.orderId,
      userId: this.userId,
      symbol: this.symbol,
      side: this.side,
      type: this.type,
      price: this.price,
      initialQuantity: this.initialQuantity,
      remainingQuantity: this.remainingQuantity,
      filledQuantity: this.filledQuantity,
      status: this.status,
      timestamp: this.timestamp,
    };
  }
}