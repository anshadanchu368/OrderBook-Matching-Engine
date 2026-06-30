import test from "node:test";
import assert from "node:assert/strict";
import { OrderBook } from "../src/engine/OrderBook.js";
import { OrderStatus, OrderType, Side } from "../src/engine/Constants.js";

test("SELL STOP_MARKET sleeps first, then triggers when last trade price reaches trigger", () => {
  const book = new OrderBook("BTC-INR");

  // 1. Add resting BUY liquidity.
  book.placeLimitOrder({
    orderId: "B1",
    userId: "U1",
    side: Side.BUY,
    priceTicks: 9900,
    quantity: 10,
    timestamp: 1,
  });

  // 2. Place SELL stop-market. It should not execute immediately.
  const stopResult = book.placeStopMarketOrder({
    orderId: "SM1",
    userId: "U2",
    side: Side.SELL,
    triggerPriceTicks: 9900,
    quantity: 5,
    timestamp: 2,
  });

  assert.equal(stopResult.order.type, OrderType.STOP_MARKET);
  assert.equal(stopResult.order.status, OrderStatus.OPEN);
  assert.equal(stopResult.trades.length, 0);

  let snapshot = book.snapshot();

  assert.equal(snapshot.stopOrders.length, 1);
  assert.equal(snapshot.stopOrders[0].orderId, "SM1");
  assert.equal(snapshot.bestBidPriceTicks, 9900);
  assert.equal(snapshot.lastTradePriceTicks, null);

  // 3. Place a normal SELL limit that trades at 9900.
  // This creates a trade, updates lastTradePriceTicks,
  // and then triggers SM1.
  const triggerResult = book.placeLimitOrder({
    orderId: "S1",
    userId: "U3",
    side: Side.SELL,
    priceTicks: 9900,
    quantity: 1,
    timestamp: 3,
  });

  assert.equal(triggerResult.triggeredOrders.length, 1);
  assert.equal(triggerResult.triggeredOrders[0].orderId, "SM1");
  assert.equal(triggerResult.triggeredOrders[0].status, OrderStatus.TRIGGERED);

  // First trade: S1 sells 1 into B1.
  // Second trade: SM1 market sells 5 into B1.
  assert.equal(triggerResult.trades.length, 2);

  assert.equal(triggerResult.trades[0].buyOrderId, "B1");
  assert.equal(triggerResult.trades[0].sellOrderId, "S1");
  assert.equal(triggerResult.trades[0].priceTicks, 9900);
  assert.equal(triggerResult.trades[0].quantity, 1);

  assert.equal(triggerResult.trades[1].buyOrderId, "B1");
  assert.equal(triggerResult.trades[1].sellOrderId, "SM1");
  assert.equal(triggerResult.trades[1].priceTicks, 9900);
  assert.equal(triggerResult.trades[1].quantity, 5);

  snapshot = book.snapshot();

  assert.equal(snapshot.lastTradePriceTicks, 9900);
  assert.equal(snapshot.stopOrders.length, 0);

  // B1 started with 10.
  // S1 consumed 1.
  // SM1 consumed 5.
  // Remaining B1 quantity = 4.
  assert.equal(snapshot.bids.length, 1);
  assert.equal(snapshot.bids[0].priceTicks, 9900);
  assert.equal(snapshot.bids[0].totalQuantity, 4);
  assert.equal(snapshot.asks.length, 0);
});

test("BUY STOP_LIMIT with same trigger and limit price wakes up and matches", () => {
  const book = new OrderBook("BTC-INR");

  // 1. Add resting SELL liquidity.
  book.placeLimitOrder({
    orderId: "S1",
    userId: "U1",
    side: Side.SELL,
    priceTicks: 10000,
    quantity: 10,
    timestamp: 1,
  });

  // 2. Place BUY stop-limit.
  // triggerPriceTicks and priceTicks are the same.
  const stopResult = book.placeStopLimitOrder({
    orderId: "SL1",
    userId: "U2",
    side: Side.BUY,
    triggerPriceTicks: 10000,
    priceTicks: 10000,
    quantity: 5,
    timestamp: 2,
  });

  assert.equal(stopResult.order.type, OrderType.STOP_LIMIT);
  assert.equal(stopResult.order.status, OrderStatus.OPEN);
  assert.equal(stopResult.trades.length, 0);

  let snapshot = book.snapshot();

  assert.equal(snapshot.stopOrders.length, 1);
  assert.equal(snapshot.stopOrders[0].orderId, "SL1");
  assert.equal(snapshot.bestAskPriceTicks, 10000);
  assert.equal(snapshot.lastTradePriceTicks, null);

  // 3. Place normal BUY limit to create trade at 10000.
  // This trade triggers SL1.
  const triggerResult = book.placeLimitOrder({
    orderId: "B1",
    userId: "U3",
    side: Side.BUY,
    priceTicks: 10000,
    quantity: 1,
    timestamp: 3,
  });

  assert.equal(triggerResult.triggeredOrders.length, 1);
  assert.equal(triggerResult.triggeredOrders[0].orderId, "SL1");
  assert.equal(triggerResult.triggeredOrders[0].status, OrderStatus.TRIGGERED);

  // First trade: B1 buys 1 from S1.
  // Second trade: SL1 becomes BUY LIMIT @ 10000 and buys 5 from S1.
  assert.equal(triggerResult.trades.length, 2);

  assert.equal(triggerResult.trades[0].buyOrderId, "B1");
  assert.equal(triggerResult.trades[0].sellOrderId, "S1");
  assert.equal(triggerResult.trades[0].priceTicks, 10000);
  assert.equal(triggerResult.trades[0].quantity, 1);

  assert.equal(triggerResult.trades[1].buyOrderId, "SL1");
  assert.equal(triggerResult.trades[1].sellOrderId, "S1");
  assert.equal(triggerResult.trades[1].priceTicks, 10000);
  assert.equal(triggerResult.trades[1].quantity, 5);

  snapshot = book.snapshot();

  assert.equal(snapshot.lastTradePriceTicks, 10000);
  assert.equal(snapshot.stopOrders.length, 0);

  // S1 started with 10.
  // B1 consumed 1.
  // SL1 consumed 5.
  // Remaining S1 quantity = 4.
  assert.equal(snapshot.asks.length, 1);
  assert.equal(snapshot.asks[0].priceTicks, 10000);
  assert.equal(snapshot.asks[0].totalQuantity, 4);
  assert.equal(snapshot.bids.length, 0);
});

test("stop order can be cancelled before trigger", () => {
  const book = new OrderBook("BTC-INR");

  book.placeStopMarketOrder({
    orderId: "SM-CANCEL",
    userId: "U1",
    side: Side.SELL,
    triggerPriceTicks: 9900,
    quantity: 5,
    timestamp: 1,
  });

  let snapshot = book.snapshot();
  assert.equal(snapshot.stopOrders.length, 1);

  const cancelled = book.cancelOrder("SM-CANCEL");

  assert.equal(cancelled.orderId, "SM-CANCEL");
  assert.equal(cancelled.status, OrderStatus.CANCELLED);

  snapshot = book.snapshot();
  assert.equal(snapshot.stopOrders.length, 0);
});

test("STOP_LIMIT can trigger and rest as normal limit order if not fully matched", () => {
  const book = new OrderBook("BTC-INR");

  // Existing sell liquidity only has quantity 2.
  book.placeLimitOrder({
    orderId: "S1",
    userId: "U1",
    side: Side.SELL,
    priceTicks: 10000,
    quantity: 2,
    timestamp: 1,
  });

  // Stop-limit wants to buy quantity 5.
  book.placeStopLimitOrder({
    orderId: "SL-PARTIAL",
    userId: "U2",
    side: Side.BUY,
    triggerPriceTicks: 10000,
    priceTicks: 10000,
    quantity: 5,
    timestamp: 2,
  });

  // Trigger trade.
  // This consumes 1 from S1 and triggers SL-PARTIAL.
  const triggerResult = book.placeLimitOrder({
    orderId: "B1",
    userId: "U3",
    side: Side.BUY,
    priceTicks: 10000,
    quantity: 1,
    timestamp: 3,
  });

  assert.equal(triggerResult.triggeredOrders.length, 1);
  assert.equal(triggerResult.triggeredOrders[0].orderId, "SL-PARTIAL");

  // First trade: B1 buys 1.
  // Second trade: SL-PARTIAL buys remaining 1 from S1.
  assert.equal(triggerResult.trades.length, 2);

  const snapshot = book.snapshot();

  assert.equal(snapshot.stopOrders.length, 0);
  assert.equal(snapshot.asks.length, 0);

  // SL-PARTIAL wanted 5.
  // It only bought 1 after trigger.
  // Remaining 4 should rest as normal BUY LIMIT @ 10000.
  assert.equal(snapshot.bids.length, 1);
  assert.equal(snapshot.bids[0].priceTicks, 10000);
  assert.equal(snapshot.bids[0].totalQuantity, 4);
  assert.equal(snapshot.bids[0].headOrderId, "SL-PARTIAL");
});
