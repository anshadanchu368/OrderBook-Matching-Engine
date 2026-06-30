import test from "node:test";
import assert from "node:assert/strict";
import { OrderBook } from "../src/engine/OrderBook.js";
import { OrderStatus, OrderType, Side } from "../src/engine/Constants.js";

test("SELL TRAILING_STOP_MARKET cannot be placed before first trade", () => {
  const book = new OrderBook("BTC-INR");

  assert.throws(
    () => {
      book.placeTrailingStopMarketOrder({
        orderId: "TSM1",
        userId: "U1",
        side: Side.SELL,
        trailingAmountTicks: 5,
        quantity: 10,
        timestamp: 1,
      });
    },
    {
      message: "cannot place trailing stop before first trade",
    },
  );
});

test("SELL TRAILING_STOP_MARKET starts below last traded price", () => {
  const book = new OrderBook("BTC-INR");

  // Create first trade at 100.
  book.placeLimitOrder({
    orderId: "B1",
    userId: "U1",
    side: Side.BUY,
    priceTicks: 100,
    quantity: 10,
    timestamp: 1,
  });

  book.placeLimitOrder({
    orderId: "S1",
    userId: "U2",
    side: Side.SELL,
    priceTicks: 100,
    quantity: 1,
    timestamp: 2,
  });

  assert.equal(book.snapshot().lastTradePriceTicks, 100);

  const result = book.placeTrailingStopMarketOrder({
    orderId: "TSM1",
    userId: "U3",
    side: Side.SELL,
    trailingAmountTicks: 5,
    quantity: 5,
    timestamp: 3,
  });

  assert.equal(result.order.type, OrderType.TRAILING_STOP_MARKET);
  assert.equal(result.order.status, OrderStatus.OPEN);
  assert.equal(result.order.trailingAmountTicks, 5);
  assert.equal(result.order.peakPriceTicks, 100);
  assert.equal(result.order.valleyPriceTicks, null);
  assert.equal(result.order.triggerPriceTicks, 95);

  const snapshot = book.snapshot();

  assert.equal(snapshot.stopOrders.length, 1);
  assert.equal(snapshot.stopOrders[0].orderId, "TSM1");
  assert.equal(snapshot.stopOrders[0].triggerPriceTicks, 95);
});

test("SELL TRAILING_STOP_MARKET moves trigger up when price rises", () => {
  const book = new OrderBook("BTC-INR");

  // Create first trade at 100.
  book.placeLimitOrder({
    orderId: "B1",
    userId: "U1",
    side: Side.BUY,
    priceTicks: 100,
    quantity: 20,
    timestamp: 1,
  });

  book.placeLimitOrder({
    orderId: "S1",
    userId: "U2",
    side: Side.SELL,
    priceTicks: 100,
    quantity: 1,
    timestamp: 2,
  });

  book.placeTrailingStopMarketOrder({
    orderId: "TSM1",
    userId: "U3",
    side: Side.SELL,
    trailingAmountTicks: 5,
    quantity: 5,
    timestamp: 3,
  });

  // Create trade at 105.
  // This should move peak from 100 to 105,
  // and trigger from 95 to 100.
  book.placeLimitOrder({
    orderId: "S2",
    userId: "U4",
    side: Side.SELL,
    priceTicks: 105,
    quantity: 1,
    timestamp: 4,
  });

  book.placeLimitOrder({
    orderId: "B2",
    userId: "U5",
    side: Side.BUY,
    priceTicks: 105,
    quantity: 1,
    timestamp: 5,
  });

  const snapshot = book.snapshot();

  assert.equal(snapshot.lastTradePriceTicks, 105);
  assert.equal(snapshot.stopOrders.length, 1);
  assert.equal(snapshot.stopOrders[0].orderId, "TSM1");
  assert.equal(snapshot.stopOrders[0].peakPriceTicks, 105);
  assert.equal(snapshot.stopOrders[0].triggerPriceTicks, 100);
});

test("SELL TRAILING_STOP_MARKET does not move trigger down when price falls but trigger is not hit", () => {
  const book = new OrderBook("BTC-INR");

  // First trade at 100.
  book.placeLimitOrder({
    orderId: "B1",
    userId: "U1",
    side: Side.BUY,
    priceTicks: 100,
    quantity: 20,
    timestamp: 1,
  });

  book.placeLimitOrder({
    orderId: "S1",
    userId: "U2",
    side: Side.SELL,
    priceTicks: 100,
    quantity: 1,
    timestamp: 2,
  });

  book.placeTrailingStopMarketOrder({
    orderId: "TSM1",
    userId: "U3",
    side: Side.SELL,
    trailingAmountTicks: 5,
    quantity: 5,
    timestamp: 3,
  });

  // Move price up to 105, trigger becomes 100.
  book.placeLimitOrder({
    orderId: "S2",
    userId: "U4",
    side: Side.SELL,
    priceTicks: 105,
    quantity: 1,
    timestamp: 4,
  });

  book.placeLimitOrder({
    orderId: "B2",
    userId: "U5",
    side: Side.BUY,
    priceTicks: 105,
    quantity: 1,
    timestamp: 5,
  });

  // Create trade at 103.
  // Trigger should stay 100.
  book.placeLimitOrder({
    orderId: "S3",
    userId: "U6",
    side: Side.SELL,
    priceTicks: 103,
    quantity: 1,
    timestamp: 6,
  });

  book.placeLimitOrder({
    orderId: "B3",
    userId: "U7",
    side: Side.BUY,
    priceTicks: 103,
    quantity: 1,
    timestamp: 7,
  });

  const snapshot = book.snapshot();

  assert.equal(snapshot.lastTradePriceTicks, 103);
  assert.equal(snapshot.stopOrders.length, 1);
  assert.equal(snapshot.stopOrders[0].peakPriceTicks, 105);
  assert.equal(snapshot.stopOrders[0].triggerPriceTicks, 100);
});

test("SELL TRAILING_STOP_MARKET triggers when price falls back to trigger", () => {
  const book = new OrderBook("BTC-INR");

  // Resting BUY liquidity that trailing stop can sell into later.
  book.placeLimitOrder({
    orderId: "B1",
    userId: "U1",
    side: Side.BUY,
    priceTicks: 100,
    quantity: 20,
    timestamp: 1,
  });

  // First trade at 100.
  book.placeLimitOrder({
    orderId: "S1",
    userId: "U2",
    side: Side.SELL,
    priceTicks: 100,
    quantity: 1,
    timestamp: 2,
  });

  // Trigger starts at 95.
  book.placeTrailingStopMarketOrder({
    orderId: "TSM1",
    userId: "U3",
    side: Side.SELL,
    trailingAmountTicks: 5,
    quantity: 5,
    timestamp: 3,
  });

  // Trade at 105.
  // Trigger moves to 100.
  book.placeLimitOrder({
    orderId: "S2",
    userId: "U4",
    side: Side.SELL,
    priceTicks: 105,
    quantity: 1,
    timestamp: 4,
  });

  book.placeLimitOrder({
    orderId: "B2",
    userId: "U5",
    side: Side.BUY,
    priceTicks: 105,
    quantity: 1,
    timestamp: 5,
  });

  let snapshot = book.snapshot();

  assert.equal(snapshot.stopOrders[0].triggerPriceTicks, 100);

  // Now create trade at 100.
  // This should trigger TSM1.
  const triggerResult = book.placeLimitOrder({
    orderId: "S3",
    userId: "U6",
    side: Side.SELL,
    priceTicks: 100,
    quantity: 1,
    timestamp: 6,
  });

  assert.equal(triggerResult.triggeredOrders.length, 1);
  assert.equal(triggerResult.triggeredOrders[0].orderId, "TSM1");
  assert.equal(triggerResult.triggeredOrders[0].status, OrderStatus.TRIGGERED);

  // First trade: S3 sells 1 into B1.
  // Second trade: TSM1 becomes market sell and sells 5 into B1.
  assert.equal(triggerResult.trades.length, 2);

  assert.equal(triggerResult.trades[0].sellOrderId, "S3");
  assert.equal(triggerResult.trades[0].buyOrderId, "B1");
  assert.equal(triggerResult.trades[0].priceTicks, 100);
  assert.equal(triggerResult.trades[0].quantity, 1);

  assert.equal(triggerResult.trades[1].sellOrderId, "TSM1");
  assert.equal(triggerResult.trades[1].buyOrderId, "B1");
  assert.equal(triggerResult.trades[1].priceTicks, 100);
  assert.equal(triggerResult.trades[1].quantity, 5);

  snapshot = book.snapshot();

  assert.equal(snapshot.lastTradePriceTicks, 100);
  assert.equal(snapshot.stopOrders.length, 0);

  // B1 quantity:
  // initial 20
  // S1 consumed 1
  // S3 consumed 1
  // TSM1 consumed 5
  // remaining = 13
  assert.equal(snapshot.bids.length, 1);
  assert.equal(snapshot.bids[0].priceTicks, 100);
  assert.equal(snapshot.bids[0].totalQuantity, 13);
});

test("BUY TRAILING_STOP_MARKET moves trigger down when price falls and triggers when price rises", () => {
  const book = new OrderBook("BTC-INR");

  // Resting SELL liquidity.
  book.placeLimitOrder({
    orderId: "S1",
    userId: "U1",
    side: Side.SELL,
    priceTicks: 100,
    quantity: 20,
    timestamp: 1,
  });

  // First trade at 100.
  book.placeLimitOrder({
    orderId: "B1",
    userId: "U2",
    side: Side.BUY,
    priceTicks: 100,
    quantity: 1,
    timestamp: 2,
  });

  // BUY trailing stop starts at trigger 105.
  book.placeTrailingStopMarketOrder({
    orderId: "BTM1",
    userId: "U3",
    side: Side.BUY,
    trailingAmountTicks: 5,
    quantity: 5,
    timestamp: 3,
  });

  let snapshot = book.snapshot();

  assert.equal(snapshot.stopOrders[0].valleyPriceTicks, 100);
  assert.equal(snapshot.stopOrders[0].triggerPriceTicks, 105);

  // Create trade at 95.
  // Valley becomes 95, trigger becomes 100.
  book.placeLimitOrder({
    orderId: "B2",
    userId: "U4",
    side: Side.BUY,
    priceTicks: 95,
    quantity: 1,
    timestamp: 4,
  });

  book.placeLimitOrder({
    orderId: "S2",
    userId: "U5",
    side: Side.SELL,
    priceTicks: 95,
    quantity: 1,
    timestamp: 5,
  });

  snapshot = book.snapshot();

  assert.equal(snapshot.lastTradePriceTicks, 95);
  assert.equal(snapshot.stopOrders.length, 1);
  assert.equal(snapshot.stopOrders[0].valleyPriceTicks, 95);
  assert.equal(snapshot.stopOrders[0].triggerPriceTicks, 100);

  // Now create trade at 100.
  // This should trigger BTM1.
  const triggerResult = book.placeLimitOrder({
    orderId: "B3",
    userId: "U6",
    side: Side.BUY,
    priceTicks: 100,
    quantity: 1,
    timestamp: 6,
  });

  assert.equal(triggerResult.triggeredOrders.length, 1);
  assert.equal(triggerResult.triggeredOrders[0].orderId, "BTM1");
  assert.equal(triggerResult.triggeredOrders[0].status, OrderStatus.TRIGGERED);

  // First trade: B3 buys 1 from S1.
  // Second trade: BTM1 market buys 5 from S1.
  assert.equal(triggerResult.trades.length, 2);

  assert.equal(triggerResult.trades[0].buyOrderId, "B3");
  assert.equal(triggerResult.trades[0].sellOrderId, "S1");
  assert.equal(triggerResult.trades[0].priceTicks, 100);
  assert.equal(triggerResult.trades[0].quantity, 1);

  assert.equal(triggerResult.trades[1].buyOrderId, "BTM1");
  assert.equal(triggerResult.trades[1].sellOrderId, "S1");
  assert.equal(triggerResult.trades[1].priceTicks, 100);
  assert.equal(triggerResult.trades[1].quantity, 5);

  snapshot = book.snapshot();

  assert.equal(snapshot.stopOrders.length, 0);
});
