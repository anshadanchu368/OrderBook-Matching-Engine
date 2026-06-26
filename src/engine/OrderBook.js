import { OrderType, Side } from "./Constants.js";
import { OrderNode } from "./OrderNode.js";
import { PriceLevel } from "./PriceLevel.js";

export class OrderBook {
  constructor(symbol) {
    if (typeof symbol !== "string" || symbol.trim() === "") {
      throw new Error("symbol must be a non-empty string");
    }

    this.symbol = symbol;

    this.bids = new Map();
    this.asks = new Map();

    this.ordersById = new Map();
    this.trades = [];
  }

  placeLimitOrder({
    orderId,
    userId,
    side,
    priceTicks,
    quantity,
    timestamp,
  }) {
    if (this.ordersById.has(orderId)) {
      throw new Error(`order already exists: ${orderId}`);
    }

    const incomingOrder = new OrderNode({
      orderId,
      userId,
      symbol: this.symbol,
      side,
      type: OrderType.LIMIT,
      priceTicks,
      quantity,
      timestamp,
    });

    const trades =
      side === Side.BUY
        ? this.matchBuyOrder(incomingOrder)
        : this.matchSellOrder(incomingOrder);

    if (incomingOrder.isActive && incomingOrder.remainingQuantity > 0) {
      this.addRestingOrder(incomingOrder);
      this.ordersById.set(orderId, incomingOrder);
    }

    return {
      order: incomingOrder.snapshot(),
      trades,
    };
  }

  placeMarketOrder({
    orderId,
    userId,
    side,
    quantity,
    timestamp,
  }) {
    if (this.ordersById.has(orderId)) {
      throw new Error(`order already exists: ${orderId}`);
    }

    const incomingOrder = new OrderNode({
      orderId,
      userId,
      symbol: this.symbol,
      side,
      type: OrderType.MARKET,
      priceTicks: null,
      quantity,
      timestamp,
    });

    const trades =
      side === Side.BUY
        ? this.matchBuyOrder(incomingOrder, { ignorePriceLimit: true })
        : this.matchSellOrder(incomingOrder, { ignorePriceLimit: true });

    if (incomingOrder.remainingQuantity > 0 && incomingOrder.isActive) {
      incomingOrder.cancel();
    }

    return {
      order: incomingOrder.snapshot(),
      trades,
    };
  }

  matchBuyOrder(incomingBuyOrder, { ignorePriceLimit = false } = {}) {
    const trades = [];

    while (incomingBuyOrder.remainingQuantity > 0) {
      const bestAskPriceTicks = this.getBestAskPriceTicks();

      if (bestAskPriceTicks === null) {
        break;
      }

      if (!ignorePriceLimit && bestAskPriceTicks > incomingBuyOrder.priceTicks) {
        break;
      }

      const askLevel = this.asks.get(bestAskPriceTicks);
      const restingSellOrder = askLevel.peek();

      const fillQuantity = Math.min(
        incomingBuyOrder.remainingQuantity,
        restingSellOrder.remainingQuantity,
      );

      incomingBuyOrder.fill(fillQuantity);
      restingSellOrder.fill(fillQuantity);
      askLevel.decreaseTotalQuantity(fillQuantity);

      const trade = {
        symbol: this.symbol,
        priceTicks: restingSellOrder.priceTicks,
        quantity: fillQuantity,
        buyOrderId: incomingBuyOrder.orderId,
        sellOrderId: restingSellOrder.orderId,
        aggressorSide: Side.BUY,
        timestamp: incomingBuyOrder.timestamp,
      };

      trades.push(trade);
      this.trades.push(trade);

      if (restingSellOrder.isFilled) {
        askLevel.remove(restingSellOrder);
        this.ordersById.delete(restingSellOrder.orderId);
      }

      if (askLevel.isEmpty()) {
        this.asks.delete(bestAskPriceTicks);
      }
    }

    return trades;
  }

  matchSellOrder(incomingSellOrder, { ignorePriceLimit = false } = {}) {
    const trades = [];

    while (incomingSellOrder.remainingQuantity > 0) {
      const bestBidPriceTicks = this.getBestBidPriceTicks();

      if (bestBidPriceTicks === null) {
        break;
      }

      if (!ignorePriceLimit && bestBidPriceTicks < incomingSellOrder.priceTicks) {
        break;
      }

      const bidLevel = this.bids.get(bestBidPriceTicks);
      const restingBuyOrder = bidLevel.peek();

      const fillQuantity = Math.min(
        incomingSellOrder.remainingQuantity,
        restingBuyOrder.remainingQuantity,
      );

      incomingSellOrder.fill(fillQuantity);
      restingBuyOrder.fill(fillQuantity);
      bidLevel.decreaseTotalQuantity(fillQuantity);

      const trade = {
        symbol: this.symbol,
        priceTicks: restingBuyOrder.priceTicks,
        quantity: fillQuantity,
        buyOrderId: restingBuyOrder.orderId,
        sellOrderId: incomingSellOrder.orderId,
        aggressorSide: Side.SELL,
        timestamp: incomingSellOrder.timestamp,
      };

      trades.push(trade);
      this.trades.push(trade);

      if (restingBuyOrder.isFilled) {
        bidLevel.remove(restingBuyOrder);
        this.ordersById.delete(restingBuyOrder.orderId);
      }

      if (bidLevel.isEmpty()) {
        this.bids.delete(bestBidPriceTicks);
      }
    }

    return trades;
  }

  addRestingOrder(order) {
    if (!order.isLimitOrder) {
      throw new Error("only limit orders can rest in the order book");
    }

    const bookSide = order.side === Side.BUY ? this.bids : this.asks;

    let priceLevel = bookSide.get(order.priceTicks);

    if (!priceLevel) {
      priceLevel = new PriceLevel(order.priceTicks);
      bookSide.set(order.priceTicks, priceLevel);
    }

    priceLevel.append(order);
  }

  cancelOrder(orderId) {
    const order = this.ordersById.get(orderId);

    if (!order) {
      throw new Error(`order not found: ${orderId}`);
    }

    if (!order.isActive) {
      throw new Error(`order ${orderId} is already ${order.status}`);
    }

    const bookSide = order.side === Side.BUY ? this.bids : this.asks;
    const priceLevel = order.priceLevel;

    if (!priceLevel) {
      throw new Error(`order ${orderId} is not attached to a price level`);
    }

    priceLevel.remove(order);
    order.cancel();

    this.ordersById.delete(orderId);

    if (priceLevel.isEmpty()) {
      bookSide.delete(order.priceTicks);
    }

    return order.snapshot();
  }

  getBestBidPriceTicks() {
    if (this.bids.size === 0) {
      return null;
    }

    return Math.max(...this.bids.keys());
  }

  getBestAskPriceTicks() {
    if (this.asks.size === 0) {
      return null;
    }

    return Math.min(...this.asks.keys());
  }

  snapshot() {
    return {
      symbol: this.symbol,
      bestBidPriceTicks: this.getBestBidPriceTicks(),
      bestAskPriceTicks: this.getBestAskPriceTicks(),
      bids: this.getBookSideSnapshot(this.bids, Side.BUY),
      asks: this.getBookSideSnapshot(this.asks, Side.SELL),
    };
  }

  getBookSideSnapshot(bookSide, side) {
    const levels = [...bookSide.values()].map((level) => level.snapshot());

    return levels.sort((a, b) => {
      if (side === Side.BUY) {
        return b.priceTicks - a.priceTicks;
      }

      return a.priceTicks - b.priceTicks;
    });
  }
}