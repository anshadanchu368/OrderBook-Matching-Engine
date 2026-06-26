import { Side } from "./engine/Constants.js";
import { OrderBook } from "./engine/OrderBook.js";

function print(title, data) {
  console.log(`\n--- ${title} ---`);
  console.log(JSON.stringify(data, null, 2));
}

const book = new OrderBook("BTC-INR");

/**
 * TEST 1:
 * Market BUY should match lowest asks first.
 */
console.log("\n==============================");
console.log("TEST 1: MARKET BUY");
console.log("==============================");

book.placeLimitOrder({
  orderId: "S1",
  userId: "U1",
  side: Side.SELL,
  price: 100,
  quantity: 5,
  timestamp: 1,
});

book.placeLimitOrder({
  orderId: "S2",
  userId: "U2",
  side: Side.SELL,
  price: 101,
  quantity: 5,
  timestamp: 2,
});

print("Before market BUY", book.snapshot());

const marketBuyResult = book.placeMarketOrder({
  orderId: "MB1",
  userId: "U3",
  side: Side.BUY,
  quantity: 8,
  timestamp: 3,
});

print("Market BUY result", marketBuyResult);
print("After market BUY", book.snapshot());

/**
 * Expected:
 *
 * MB1 buys:
 * - 5 quantity from S1 at price 100
 * - 3 quantity from S2 at price 101
 *
 * S1 fully filled and removed.
 * S2 remainingQuantity should be 2.
 */


/**
 * TEST 2:
 * Market SELL should match highest bids first.
 */
console.log("\n==============================");
console.log("TEST 2: MARKET SELL");
console.log("==============================");

book.placeLimitOrder({
  orderId: "B1",
  userId: "U4",
  side: Side.BUY,
  price: 99,
  quantity: 4,
  timestamp: 4,
});

book.placeLimitOrder({
  orderId: "B2",
  userId: "U5",
  side: Side.BUY,
  price: 98,
  quantity: 4,
  timestamp: 5,
});

print("Before market SELL", book.snapshot());

const marketSellResult = book.placeMarketOrder({
  orderId: "MS1",
  userId: "U6",
  side: Side.SELL,
  quantity: 6,
  timestamp: 6,
});

print("Market SELL result", marketSellResult);
print("After market SELL", book.snapshot());

/**
 * Expected:
 *
 * MS1 sells:
 * - 4 quantity to B1 at price 99
 * - 2 quantity to B2 at price 98
 *
 * B1 fully filled and removed.
 * B2 remainingQuantity should be 2.
 */


/**
 * TEST 3:
 * Market BUY with not enough liquidity.
 * Remaining market quantity should be cancelled.
 */
console.log("\n==============================");
console.log("TEST 3: MARKET BUY WITH INSUFFICIENT LIQUIDITY");
console.log("==============================");

const marketBuyInsufficient = book.placeMarketOrder({
  orderId: "MB2",
  userId: "U7",
  side: Side.BUY,
  quantity: 10,
  timestamp: 7,
});

print("Market BUY insufficient liquidity result", marketBuyInsufficient);
print("After insufficient market BUY", book.snapshot());

/**
 * Expected:
 *
 * At this point, ask side only has S2 remaining 2.
 *
 * MB2 buys 2 quantity at price 101.
 * Remaining 8 quantity should be cancelled.
 *
 * MB2:
 * initialQuantity = 10
 * remainingQuantity = 8
 * filledQuantity = 2
 * status = CANCELLED
 *
 * Market order should NOT rest in bids.
 */


/**
 * TEST 4:
 * Market SELL with not enough liquidity.
 * Remaining market quantity should be cancelled.
 */
console.log("\n==============================");
console.log("TEST 4: MARKET SELL WITH INSUFFICIENT LIQUIDITY");
console.log("==============================");

const marketSellInsufficient = book.placeMarketOrder({
  orderId: "MS2",
  userId: "U8",
  side: Side.SELL,
  quantity: 10,
  timestamp: 8,
});

print("Market SELL insufficient liquidity result", marketSellInsufficient);
print("After insufficient market SELL", book.snapshot());

/**
 * Expected:
 *
 * At this point, bid side only has B2 remaining 2.
 *
 * MS2 sells 2 quantity at price 98.
 * Remaining 8 quantity should be cancelled.
 *
 * MS2:
 * initialQuantity = 10
 * remainingQuantity = 8
 * filledQuantity = 2
 * status = CANCELLED
 *
 * Market order should NOT rest in asks.
 */


/**
 * FINAL CHECK:
 * Both sides should be empty now.
 */
console.log("\n==============================");
console.log("FINAL BOOK STATE");
console.log("==============================");

print("Final snapshot", book.snapshot());

/**
 * Expected final book:
 *
 * bestBid = null
 * bestAsk = null
 * bids = []
 * asks = []
 */