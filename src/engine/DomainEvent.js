export const DomainEventType = Object.freeze({
  ORDER_ACCEPTED: "ORDER_ACCEPTED",
  ORDER_RESTED: "ORDER_RESTED",
  ORDER_CANCELLED: "ORDER_CANCELLED",
  ORDER_FILLED: "ORDER_FILLED",
  ORDER_PARTIALLY_FILLED: "ORDER_PARTIALLY_FILLED",
  TRADE_CREATED: "TRADE_CREATED",
  STOP_ORDER_ACCEPTED: "STOP_ORDER_ACCEPTED",
  STOP_ORDER_TRIGGERED: "STOP_ORDER_TRIGGERED",
  BOOK_UPDATED: "BOOK_UPDATED",
});

export function createOrderAcceptedEvent(order) {
  return {
    type: DomainEventType.ORDER_ACCEPTED,
    symbol: order.symbol,
    orderId: order.orderId,
    userId: order.userId,
    side: order.side,
    orderType: order.type,
    priceTicks: order.priceTicks,
    quantity: order.quantity,
    remainingQuantity: order.remainingQuantity,
    timestamp: order.timestamp,
  };
}

export function createOrderRestedEvent(order) {
  return {
    type: DomainEventType.ORDER_RESTED,
    symbol: order.symbol,
    orderId: order.orderId,
    userId: order.userId,
    side: order.side,
    orderType: order.type,
    priceTicks: order.priceTicks,
    remainingQuantity: order.remainingQuantity,
    timestamp: order.timestamp,
  };
}

export function createOrderCancelledEvent(order) {
  return {
    type: DomainEventType.ORDER_CANCELLED,
    symbol: order.symbol,
    orderId: order.orderId,
    userId: order.userId,
    side: order.side,
    orderType: order.type,
    priceTicks: order.priceTicks,
    remainingQuantity: order.remainingQuantity,
    status: order.status,
    timestamp: order.timestamp,
  };
}

export function createOrderFillEvent(order) {
  const eventType =
    order.remainingQuantity === 0
      ? DomainEventType.ORDER_FILLED
      : DomainEventType.ORDER_PARTIALLY_FILLED;

  return {
    type: eventType,
    symbol: order.symbol,
    orderId: order.orderId,
    userId: order.userId,
    side: order.side,
    orderType: order.type,
    priceTicks: order.priceTicks,
    quantity: order.quantity,
    remainingQuantity: order.remainingQuantity,
    status: order.status,
    timestamp: order.timestamp,
  };
}

export function createTradeCreatedEvent(trade) {
  return {
    type: DomainEventType.TRADE_CREATED,
    symbol: trade.symbol,
    priceTicks: trade.priceTicks,
    quantity: trade.quantity,
    buyOrderId: trade.buyOrderId,
    sellOrderId: trade.sellOrderId,
    aggressorSide: trade.aggressorSide,
    timestamp: trade.timestamp,
  };
}

export function createTradeCreatedEvents(trades) {
  return trades.map((trade) => createTradeCreatedEvent(trade));
}

export function createStopOrderAcceptedEvent(order) {
  return {
    type: DomainEventType.STOP_ORDER_ACCEPTED,
    symbol: order.symbol,
    orderId: order.orderId,
    userId: order.userId,
    side: order.side,
    orderType: order.type,
    triggerPriceTicks: order.triggerPriceTicks,
    priceTicks: order.priceTicks,
    trailingAmountTicks: order.trailingAmountTicks ?? null,
    peakPriceTicks: order.peakPriceTicks ?? null,
    valleyPriceTicks: order.valleyPriceTicks ?? null,
    quantity: order.quantity,
    remainingQuantity: order.remainingQuantity,
    status: order.status,
    timestamp: order.timestamp,
  };
}

export function createStopOrderTriggeredEvent(order) {
  return {
    type: DomainEventType.STOP_ORDER_TRIGGERED,
    symbol: order.symbol,
    orderId: order.orderId,
    userId: order.userId,
    side: order.side,
    orderType: order.type,
    triggerPriceTicks: order.triggerPriceTicks,
    priceTicks: order.priceTicks,
    trailingAmountTicks: order.trailingAmountTicks ?? null,
    peakPriceTicks: order.peakPriceTicks ?? null,
    valleyPriceTicks: order.valleyPriceTicks ?? null,
    quantity: order.quantity,
    remainingQuantity: order.remainingQuantity,
    status: order.status,
    timestamp: order.timestamp,
  };
}

export function createBookUpdatedEvent(snapshot) {
  return {
    type: DomainEventType.BOOK_UPDATED,
    snapshot,
    timestamp: Date.now(),
  };
}