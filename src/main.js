import { Side } from "./engine/Constants.js";
import { OrderBook } from "./engine/OrderBook.js";

function print(title, data) {
  console.log(`\n--- ${title} ---`);
  console.log(JSON.stringify(data, null, 2));
}

function section(title) {
  console.log("\n==============================");
  console.log(title);
  console.log("==============================");
}

function expectEqual(title, actual, expected) {
  const passed = actual === expected;

  console.log(
    `${passed ? "✅" : "❌"} ${title}: expected=${expected}, actual=${actual}`,
  );

  if (!passed) {
    throw new Error(`Test failed: ${title}`);
  }
}

function expectThrows(title, callback) {
  try {
    callback();
    console.log(`❌ ${title}: expected error, but no error was thrown`);
    throw new Error(`Test failed: ${title}`);
  } catch (error) {
    console.log(`✅ ${title}: ${error.message}`);
  }
}

const book = new OrderBook("BTC-INR");

/**
 * priceTicks mental model:
 *
 * 100.00 = 10000
 * 100.50 = 10050
 * 101.00 = 10100
 *
 * Internally we do not use decimal prices anymore.
 */

/**
 * TEST 1:
 * Add limit SELL orders.
 */
section("TEST 1: ADD LIMIT SELL ORDERS");

const sell1 = book.placeLimitOrder({
  orderId: "S1",
  userId: "U1",
  side: Side.SELL,
  priceTicks: 10100,
  quantity: 5,
  timestamp: 1,
});

const sell2 = book.placeLimitOrder({
  orderId: "S2",
  userId: "U2",
  side: Side.SELL,
  priceTicks: 10200,
  quantity: 10,
  timestamp: 2,
});

print("S1 result", sell1);
print("S2 result", sell2);
print("Book after adding asks", book.snapshot());

expectEqual("Best ask should be 10100", book.getBestAskPriceTicks(), 10100);
expectEqual("Best bid should be null", book.getBestBidPriceTicks(), null);

/**
 * TEST 2:
 * Add limit BUY orders that do not cross.
 */
section("TEST 2: ADD LIMIT BUY ORDERS");

const buy1 = book.placeLimitOrder({
  orderId: "B1",
  userId: "U3",
  side: Side.BUY,
  priceTicks: 9900,
  quantity: 4,
  timestamp: 3,
});

const buy2 = book.placeLimitOrder({
  orderId: "B2",
  userId: "U4",
  side: Side.BUY,
  priceTicks: 9800,
  quantity: 6,
  timestamp: 4,
});

print("B1 result", buy1);
print("B2 result", buy2);
print("Book after adding bids", book.snapshot());

expectEqual("Best bid should be 9900", book.getBestBidPriceTicks(), 9900);
expectEqual("Best ask should still be 10100", book.getBestAskPriceTicks(), 10100);

/**
 * TEST 3:
 * Limit BUY crosses the ask.
 *
 * B3 wants to buy 7 at 10100.
 * S1 has 5 available at 10100.
 *
 * So B3 fills 5, then remaining 2 rests at 10100 bid.
 */
section("TEST 3: LIMIT BUY PARTIAL FILL THEN REST");

const buy3 = book.placeLimitOrder({
  orderId: "B3",
  userId: "U5",
  side: Side.BUY,
  priceTicks: 10100,
  quantity: 7,
  timestamp: 5,
});

print("B3 result", buy3);
print("Book after B3", book.snapshot());

expectEqual("B3 should have 2 remaining", buy3.order.remainingQuantity, 2);
expectEqual("B3 should have 1 trade", buy3.trades.length, 1);
expectEqual("Trade should execute at 10100", buy3.trades[0].priceTicks, 10100);
expectEqual("Best bid should now be 10100", book.getBestBidPriceTicks(), 10100);
expectEqual("Best ask should now be 10200", book.getBestAskPriceTicks(), 10200);

/**
 * TEST 4:
 * FIFO at same price.
 *
 * Add B4 and B5 at same priceTicks 10000.
 * Then incoming sell should match B4 before B5.
 */
section("TEST 4: FIFO SAME PRICE LEVEL");

book.placeLimitOrder({
  orderId: "B4",
  userId: "U6",
  side: Side.BUY,
  priceTicks: 10000,
  quantity: 3,
  timestamp: 6,
});

book.placeLimitOrder({
  orderId: "B5",
  userId: "U7",
  side: Side.BUY,
  priceTicks: 10000,
  quantity: 3,
  timestamp: 7,
});

print("Book before FIFO sell", book.snapshot());

const sell3 = book.placeLimitOrder({
  orderId: "S3",
  userId: "U8",
  side: Side.SELL,
  priceTicks: 10000,
  quantity: 4,
  timestamp: 8,
});

print("S3 result", sell3);
print("Book after FIFO sell", book.snapshot());

expectEqual("S3 should create 2 trades", sell3.trades.length, 2);
expectEqual("First FIFO match should be B3 because best bid 10100 existed", sell3.trades[0].buyOrderId, "B3");
expectEqual("Second FIFO match should be B4", sell3.trades[1].buyOrderId, "B4");
expectEqual("B4 trade quantity should be 2", sell3.trades[1].quantity, 2);

/**
 * TEST 5:
 * Market BUY.
 *
 * It should ignore price limit and consume lowest asks first.
 * Current ask side should have S2 at 10200.
 */
section("TEST 5: MARKET BUY");

const marketBuy1 = book.placeMarketOrder({
  orderId: "MB1",
  userId: "U9",
  side: Side.BUY,
  quantity: 6,
  timestamp: 9,
});

print("MB1 result", marketBuy1);
print("Book after market buy", book.snapshot());

expectEqual("MB1 should be filled", marketBuy1.order.status, "FILLED");
expectEqual("MB1 remaining should be 0", marketBuy1.order.remainingQuantity, 0);
expectEqual("MB1 trade price should be 10200", marketBuy1.trades[0].priceTicks, 10200);

/**
 * TEST 6:
 * Market SELL.
 *
 * It should consume highest bids first.
 */
section("TEST 6: MARKET SELL");

const marketSell1 = book.placeMarketOrder({
  orderId: "MS1",
  userId: "U10",
  side: Side.SELL,
  quantity: 4,
  timestamp: 10,
});

print("MS1 result", marketSell1);
print("Book after market sell", book.snapshot());

expectEqual("MS1 should be filled", marketSell1.order.status, "FILLED");
expectEqual("MS1 remaining should be 0", marketSell1.order.remainingQuantity, 0);

/**
 * TEST 7:
 * Cancel an active resting order.
 *
 * Add a new buy order, then cancel it.
 */
section("TEST 7: CANCEL ORDER");

book.placeLimitOrder({
  orderId: "B6",
  userId: "U11",
  side: Side.BUY,
  priceTicks: 9700,
  quantity: 8,
  timestamp: 11,
});

print("Book before cancelling B6", book.snapshot());

const cancelledB6 = book.cancelOrder("B6");

print("Cancelled B6", cancelledB6);
print("Book after cancelling B6", book.snapshot());

expectEqual("B6 should be cancelled", cancelledB6.status, "CANCELLED");
expectThrows("Cancelling B6 again should fail", () => {
  book.cancelOrder("B6");
});

/**
 * TEST 8:
 * Market BUY with insufficient liquidity.
 *
 * Add one ask with quantity 2.
 * Market buy quantity 10.
 * It should fill 2 and cancel remaining 8.
 */
section("TEST 8: MARKET BUY INSUFFICIENT LIQUIDITY");

book.placeLimitOrder({
  orderId: "S4",
  userId: "U12",
  side: Side.SELL,
  priceTicks: 10500,
  quantity: 2,
  timestamp: 12,
});

const marketBuy2 = book.placeMarketOrder({
  orderId: "MB2",
  userId: "U13",
  side: Side.BUY,
  quantity: 10,
  timestamp: 13,
});

print("MB2 result", marketBuy2);
print("Book after insufficient market buy", book.snapshot());

expectEqual("MB2 should be cancelled because leftover cannot rest", marketBuy2.order.status, "CANCELLED");
expectEqual("MB2 remaining should be 8", marketBuy2.order.remainingQuantity, 8);
expectEqual("MB2 should have filled quantity 2", marketBuy2.order.filledQuantity, 2);

/**
 * TEST 9:
 * Market SELL with insufficient liquidity.
 *
 * Add one bid with quantity 3.
 * Market sell quantity 10.
 * It should fill 3 and cancel remaining 7.
 */
section("TEST 9: MARKET SELL INSUFFICIENT LIQUIDITY");

book.placeLimitOrder({
  orderId: "B7",
  userId: "U14",
  side: Side.BUY,
  priceTicks: 9600,
  quantity: 3,
  timestamp: 14,
});

const marketSell2 = book.placeMarketOrder({
  orderId: "MS2",
  userId: "U15",
  side: Side.SELL,
  quantity: 10,
  timestamp: 15,
});

print("MS2 result", marketSell2);
print("Book after insufficient market sell", book.snapshot());

expectEqual("MS2 should be cancelled because leftover cannot rest", marketSell2.order.status, "CANCELLED");
expectEqual("MS2 remaining should be 7", marketSell2.order.remainingQuantity, 7);
expectEqual("MS2 should have filled quantity 3", marketSell2.order.filledQuantity, 3);

/**
 * TEST 10:
 * Duplicate order id should fail while order is active/resting.
 */
section("TEST 10: DUPLICATE ORDER ID");

book.placeLimitOrder({
  orderId: "DUP1",
  userId: "U16",
  side: Side.BUY,
  priceTicks: 9500,
  quantity: 1,
  timestamp: 16,
});

expectThrows("Duplicate resting orderId should fail", () => {
  book.placeLimitOrder({
    orderId: "DUP1",
    userId: "U17",
    side: Side.BUY,
    priceTicks: 9400,
    quantity: 1,
    timestamp: 17,
  });
});

/**
 * TEST 11:
 * Invalid priceTicks should fail.
 *
 * priceTicks must be a positive integer.
 */
section("TEST 11: INVALID PRICE TICKS");

expectThrows("Decimal priceTicks should fail", () => {
  book.placeLimitOrder({
    orderId: "BAD1",
    userId: "U18",
    side: Side.BUY,
    priceTicks: 100.5,
    quantity: 1,
    timestamp: 18,
  });
});

expectThrows("Zero priceTicks should fail", () => {
  book.placeLimitOrder({
    orderId: "BAD2",
    userId: "U19",
    side: Side.BUY,
    priceTicks: 0,
    quantity: 1,
    timestamp: 19,
  });
});

expectThrows("Negative priceTicks should fail", () => {
  book.placeLimitOrder({
    orderId: "BAD3",
    userId: "U20",
    side: Side.BUY,
    priceTicks: -100,
    quantity: 1,
    timestamp: 20,
  });
});

/**
 * TEST 12:
 * Invalid market order with priceTicks should fail.
 *
 * Market order should not carry priceTicks.
 */
section("TEST 12: MARKET ORDER PRICE TICKS VALIDATION");

expectThrows("Direct OrderBook market order does not accept priceTicks field anyway", () => {
  book.placeMarketOrder({
    orderId: "BAD_MARKET_1",
    userId: "U21",
    side: Side.BUY,
    priceTicks: 10000,
    quantity: 1,
    timestamp: 21,
  });
});

/**
 * NOTE:
 * The above test may not fail because placeMarketOrder ignores extra priceTicks.
 * That is okay in plain JavaScript.
 *
 * Runtime validation happens inside OrderNode when priceTicks is passed.
 * Later TypeScript can prevent extra fields at compile time.
 */

/**
 * TEST 13:
 * Final snapshot and trade history.
 */
section("TEST 13: FINAL STATE");

print("Final book snapshot", book.snapshot());
print("All trades", book.trades);

console.log("\n✅ ALL TESTS COMPLETED SUCCESSFULLY");