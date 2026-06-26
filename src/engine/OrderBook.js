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
        price,
        quantity,
        timestamp,
    }) {
        if (this.ordersById.has(orderId)) {
            throw new Error(`order already exists: ${orderId}`);
        }  // if resting orders have orderId, we should not allow incoming orders to have the same orderId

        const incomingOrder = new OrderNode({
            orderId,
            userId,
            symbol: this.symbol,
            side,
            type: OrderType.LIMIT,
            price,
            quantity,
            timestamp,
        });

        const trades =  // incoming side if buy matching logic to buy else vise versa
            side === Side.BUY
                ? this.matchBuyOrder(incomingOrder)
                : this.matchSellOrder(incomingOrder);

        if (incomingOrder.isActive && incomingOrder.remainingQuantity > 0) { //if incoming order is not matched and is pending we add it to order book based on bids and ask respectively
            this.addRestingOrder(incomingOrder);
            this.ordersById.set(orderId, incomingOrder);
        }

        return {
            order: incomingOrder.snapshot(), // final state of incoming orders state as ins status
            trades, // trades executed  way as in , matched way , 1 buy order would have eben executed with multiple sell orders
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
            price: null,
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
            const bestAskPrice = this.getBestAskPrice(); // lowest price available to sell

            if (bestAskPrice === null) {
                break;
            }//if no ask price sell

            if (!ignorePriceLimit && bestAskPrice > incomingBuyOrder.price) {
                break;
            }
            const askLevel = this.asks.get(bestAskPrice); // best price sell limit available at specifuc price level at 101 100.40 is the best sell limit if there is nothing lower than that
            const restingSellOrder = askLevel.peek(); //we look into  first header of double linked list of sell limit ask side which is not matched or remaining

            const fillQuantity = Math.min(
                incomingBuyOrder.remainingQuantity,
                restingSellOrder.remainingQuantity,
            );// this is to ensure tht buy and sell both will have only fills enough as much both sides can provide

            incomingBuyOrder.fill(fillQuantity);
            restingSellOrder.fill(fillQuantity);
            askLevel.decreaseTotalQuantity(fillQuantity);

            const trade = {
                symbol: this.symbol,
                price: restingSellOrder.price,
                quantity: fillQuantity,
                buyOrderId: incomingBuyOrder.orderId,
                sellOrderId: restingSellOrder.orderId,
                aggressorSide: Side.BUY,
                timestamp: incomingBuyOrder.timestamp,
            };

            trades.push(trade);//each individuval trades took for matching
            this.trades.push(trade);// single trade multiple matching  record

            if (restingSellOrder.isFilled) {
                askLevel.remove(restingSellOrder);
                this.ordersById.delete(restingSellOrder.orderId);
            }

            if (askLevel.isEmpty()) {
                this.asks.delete(bestAskPrice);
            }
        }

        return trades;
    }

    matchSellOrder(incomingSellOrder, { ignorePriceLimit = false } = {}) {
        const trades = [];

        while (incomingSellOrder.remainingQuantity > 0) {
            const bestBidPrice = this.getBestBidPrice();

            if (bestBidPrice === null) {
                break;
            }

            if (!ignorePriceLimit && bestBidPrice < incomingSellOrder.price) {
                break;
            }

            const bidLevel = this.bids.get(bestBidPrice);
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
                price: restingBuyOrder.price,
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
                this.bids.delete(bestBidPrice);
            }
        }

        return trades;
    }

    addRestingOrder(order) {
        if (!order.isLimitOrder) {
            throw new Error("only limit orders can rest in the order book");
        }
        const bookSide = order.side === Side.BUY ? this.bids : this.asks;

        let priceLevel = bookSide.get(order.price);

        if (!priceLevel) {
            priceLevel = new PriceLevel(order.price);
            bookSide.set(order.price, priceLevel);
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
            bookSide.delete(order.price);
        }

        return order.snapshot();
    }

    getBestBidPrice() {
        if (this.bids.size === 0) {
            return null;
        }

        return Math.max(...this.bids.keys());
    }

    getBestAskPrice() {
        if (this.asks.size === 0) {
            return null;
        }

        return Math.min(...this.asks.keys());
    }

    snapshot() {
        return {
            symbol: this.symbol,
            bestBid: this.getBestBidPrice(),
            bestAsk: this.getBestAskPrice(),
            bids: this.getBookSideSnapshot(this.bids, Side.BUY),
            asks: this.getBookSideSnapshot(this.asks, Side.SELL),
        };
    }

    getBookSideSnapshot(bookSide, side) {
        const levels = [...bookSide.values()].map((level) => level.snapshot());

        return levels.sort((a, b) => {
            if (side === Side.BUY) {
                return b.price - a.price;
            }

            return a.price - b.price;
        });
    }
}