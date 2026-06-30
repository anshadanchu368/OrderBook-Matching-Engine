import { OrderStatus, OrderType, Side } from "./Constants.js";
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
    this.stopOrdersById = new Map();

    this.trades = [];
    this.lastTradePriceTicks = null;
  }

  placeLimitOrder({
    orderId,
    userId,
    side,
    priceTicks,
    quantity,
    timestamp,
  }) {
    this.assertOrderIdAvailable(orderId);

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

    const triggered = this.processStopOrdersAfterTrades(trades);

    return {
      order: incomingOrder.snapshot(),
      trades: [...trades, ...triggered.trades],
      triggeredOrders: triggered.orders,
    };
  }

  placeTrailingStopMarketOrder({
    orderId,
    userId,
    side,
    trailingAmountTicks,
    quantity,
    timestamp,
  }) {
    this.assertOrderIdAvailable(orderId);

    if (this.lastTradePriceTicks === null) {
      throw new Error("cannot place trailing stop before first trade");
    }

    if (!Number.isInteger(trailingAmountTicks) || trailingAmountTicks <= 0) {
      throw new Error("trailingAmountTicks must be a positive integer");
    }

    const peakPriceTicks = //highest traded price seen after order placement
      side === Side.SELL ? this.lastTradePriceTicks : null;

    const valleyPriceTicks =
      side === Side.BUY ? this.lastTradePriceTicks : null;

    const triggerPriceTicks =
      side === Side.SELL
        ? this.lastTradePriceTicks - trailingAmountTicks
        : this.lastTradePriceTicks + trailingAmountTicks;

    const trailingStopOrder = {
      orderId,
      userId,
      symbol: this.symbol,
      side,
      type: OrderType.TRAILING_STOP_MARKET,
      triggerPriceTicks,
      priceTicks: null,
      trailingAmountTicks,
      peakPriceTicks,
      valleyPriceTicks,
      quantity,
      remainingQuantity: quantity,
      status: OrderStatus.OPEN,
      timestamp,
    };

    this.stopOrdersById.set(orderId, trailingStopOrder);

    return {
      order: this.getStopOrderSnapshot(trailingStopOrder),
      trades: [],
      triggeredOrders: [],
    };
  }
  placeMarketOrder({
    orderId,
    userId,
    side,
    quantity,
    timestamp,
  }) {
    this.assertOrderIdAvailable(orderId);

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

    const triggered = this.processStopOrdersAfterTrades(trades);

    return {
      order: incomingOrder.snapshot(),
      trades: [...trades, ...triggered.trades],
      triggeredOrders: triggered.orders,
    };
  }

  placeStopMarketOrder({
    orderId,
    userId,
    side,
    triggerPriceTicks,
    quantity,
    timestamp,
  }) {
    this.assertOrderIdAvailable(orderId);

    const stopOrder = {
      orderId,
      userId,
      symbol: this.symbol,
      side,
      type: OrderType.STOP_MARKET,
      triggerPriceTicks,
      priceTicks: null,
      quantity,
      remainingQuantity: quantity,
      status: OrderStatus.OPEN,
      timestamp,
    };

    this.stopOrdersById.set(orderId, stopOrder);

    return {
      order: this.getStopOrderSnapshot(stopOrder),
      trades: [],
      triggeredOrders: [],
    };
  }

  placeStopLimitOrder({
    orderId,
    userId,
    side,
    triggerPriceTicks,
    priceTicks,
    quantity,
    timestamp,
  }) {
    this.assertOrderIdAvailable(orderId);

    const stopOrder = {
      orderId,
      userId,
      symbol: this.symbol,
      side,
      type: OrderType.STOP_LIMIT,
      triggerPriceTicks,
      priceTicks,
      quantity,
      remainingQuantity: quantity,
      status: OrderStatus.OPEN,
      timestamp,
    };

    this.stopOrdersById.set(orderId, stopOrder);

    return {
      order: this.getStopOrderSnapshot(stopOrder),
      trades: [],
      triggeredOrders: [],
    };
  }

  processStopOrdersAfterTrades(initialTrades) {
    const allTriggeredTrades = [];
    const triggeredOrders = [];

    if (initialTrades.length === 0) {
      return {
        trades: allTriggeredTrades,
        orders: triggeredOrders,
      };
    }

    let latestTrades = initialTrades;
    let cycles = 0;
    const maxCycles = 1000;

    while (latestTrades.length > 0) {
      cycles += 1;

      if (cycles > maxCycles) {
        throw new Error("stop order trigger cycle limit exceeded");
      }

      const lastTrade = latestTrades[latestTrades.length - 1];
      this.lastTradePriceTicks = lastTrade.priceTicks;

      this.updateTrailingStopOrders();

      const eligibleStopOrders = this.getEligibleStopOrders();

      if (eligibleStopOrders.length === 0) {
        break;
      }

      latestTrades = [];

      for (const stopOrder of eligibleStopOrders) {
        this.stopOrdersById.delete(stopOrder.orderId);
        stopOrder.status = OrderStatus.TRIGGERED;

        const triggeredResult = this.executeTriggeredStopOrder(stopOrder);

        triggeredOrders.push(this.getStopOrderSnapshot(stopOrder));
        latestTrades.push(...triggeredResult.trades);
        allTriggeredTrades.push(...triggeredResult.trades);
      }
    }

    return {
      trades: allTriggeredTrades,
      orders: triggeredOrders,
    };
  }

  updateTrailingStopOrders() {
    if (this.lastTradePriceTicks === null) {
      return;
    }

    for (const stopOrder of this.stopOrdersById.values()) {
      if (stopOrder.type !== OrderType.TRAILING_STOP_MARKET) {
        continue;
      }

      if (stopOrder.side === Side.SELL) {
        if (
          stopOrder.peakPriceTicks === null ||
          this.lastTradePriceTicks > stopOrder.peakPriceTicks
        ) {
          stopOrder.peakPriceTicks = this.lastTradePriceTicks;
          stopOrder.triggerPriceTicks =
            stopOrder.peakPriceTicks - stopOrder.trailingAmountTicks;
        }
      }

      if (stopOrder.side === Side.BUY) {
        if (
          stopOrder.valleyPriceTicks === null ||
          this.lastTradePriceTicks < stopOrder.valleyPriceTicks
        ) {
          stopOrder.valleyPriceTicks = this.lastTradePriceTicks;
          stopOrder.triggerPriceTicks =
            stopOrder.valleyPriceTicks + stopOrder.trailingAmountTicks;
        }
      }
    }
  }

  getEligibleStopOrders() {
    if (this.lastTradePriceTicks === null) {
      return [];
    }

    const eligible = [];

    for (const stopOrder of this.stopOrdersById.values()) {
      if (stopOrder.side === Side.BUY) {
        if (this.lastTradePriceTicks >= stopOrder.triggerPriceTicks) {
          eligible.push(stopOrder);
        }
      }

      if (stopOrder.side === Side.SELL) {
        if (this.lastTradePriceTicks <= stopOrder.triggerPriceTicks) {
          eligible.push(stopOrder);
        }
      }
    }

    return eligible;
  }

  executeTriggeredStopOrder(stopOrder) {
    if (stopOrder.type === OrderType.STOP_MARKET || stopOrder.type === OrderType.TRAILING_STOP_MARKET) {
      const marketOrder = new OrderNode({
        orderId: stopOrder.orderId,
        userId: stopOrder.userId,
        symbol: this.symbol,
        side: stopOrder.side,
        type: OrderType.MARKET,
        priceTicks: null,
        quantity: stopOrder.remainingQuantity,
        timestamp: Date.now(),
      });

      const trades =
        marketOrder.side === Side.BUY
          ? this.matchBuyOrder(marketOrder, { ignorePriceLimit: true })
          : this.matchSellOrder(marketOrder, { ignorePriceLimit: true });

      if (marketOrder.remainingQuantity > 0 && marketOrder.isActive) {
        marketOrder.cancel();
      }

      return {
        order: marketOrder.snapshot(),
        trades,
      };
    }

    if (stopOrder.type === OrderType.STOP_LIMIT) {
      const limitOrder = new OrderNode({
        orderId: stopOrder.orderId,
        userId: stopOrder.userId,
        symbol: this.symbol,
        side: stopOrder.side,
        type: OrderType.LIMIT,
        priceTicks: stopOrder.priceTicks,
        quantity: stopOrder.remainingQuantity,
        timestamp: Date.now(),
      });

      const trades =
        limitOrder.side === Side.BUY
          ? this.matchBuyOrder(limitOrder)
          : this.matchSellOrder(limitOrder);

      if (limitOrder.isActive && limitOrder.remainingQuantity > 0) {
        this.addRestingOrder(limitOrder);
        this.ordersById.set(limitOrder.orderId, limitOrder);
      }

      return {
        order: limitOrder.snapshot(),
        trades,
      };
    }

    throw new Error(`unsupported stop order type: ${stopOrder.type}`);
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
    const stopOrder = this.stopOrdersById.get(orderId);

    if (stopOrder) {
      stopOrder.status = OrderStatus.CANCELLED;
      this.stopOrdersById.delete(orderId);
      return this.getStopOrderSnapshot(stopOrder);
    }

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

  assertOrderIdAvailable(orderId) {
    if (this.ordersById.has(orderId) || this.stopOrdersById.has(orderId)) {
      throw new Error(`order already exists: ${orderId}`);
    }
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
      lastTradePriceTicks: this.lastTradePriceTicks,
      stopOrders: [...this.stopOrdersById.values()].map((order) =>
        this.getStopOrderSnapshot(order),
      ),
      bids: this.getBookSideSnapshot(this.bids, Side.BUY),
      asks: this.getBookSideSnapshot(this.asks, Side.SELL),
    };
  }

  getStopOrderSnapshot(order) {
 return {
  orderId: order.orderId,
  userId: order.userId,
  symbol: order.symbol,
  side: order.side,
  type: order.type,
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