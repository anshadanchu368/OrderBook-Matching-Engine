import assert from "node:assert/strict";
import { OrderBook } from "./orderBook.js";
import { Side } from "./constants.js";

function runOrderBookTests() {
  console.log("Running OrderBook tests...");

  testBuyOrderRestsWhenNoSellOrders();
  testSellOrderRestsWhenNoBuyOrders();
  testIncomingBuyMatchesRestingSell();
  testIncomingSellMatchesRestingBuy();
  testPartialFillIncomingBuy();
  testOneBuyMatchesMultipleSellOrders();
  testNoMatchWhenBuyPriceTooLow();
  testBestBidAndBestAsk();
  testSnapshotSorting();

  console.log("All OrderBook tests passed ✅");
}

function testBuyOrderRestsWhenNoSellOrders() {
  const book = new OrderBook("RELIANCE");

  const result = book.placeLimitOrder({
    orderId: "B1",
    userId: "U1",
    side: Side.BUY,
    price: 100,
    quantity: 50,
    timestamp: 1,
  });

  assert.equal(result.trades.length, 0);
  assert.equal(book.getBestBidPrice(), 100);
  assert.equal(book.getBestAskPrice(), null);

  const snapshot = book.snapshot();

  assert.equal(snapshot.bids.length, 1);
  assert.equal(snapshot.bids[0].price, 100);
  assert.equal(snapshot.bids[0].totalQuantity, 50);
}

function testSellOrderRestsWhenNoBuyOrders() {
  const book = new OrderBook("RELIANCE");

  const result = book.placeLimitOrder({
    orderId: "S1",
    userId: "U1",
    side: Side.SELL,
    price: 105,
    quantity: 40,
    timestamp: 1,
  });

  assert.equal(result.trades.length, 0);
  assert.equal(book.getBestBidPrice(), null);
  assert.equal(book.getBestAskPrice(), 105);

  const snapshot = book.snapshot();

  assert.equal(snapshot.asks.length, 1);
  assert.equal(snapshot.asks[0].price, 105);
  assert.equal(snapshot.asks[0].totalQuantity, 40);
}

function testIncomingBuyMatchesRestingSell() {
  const book = new OrderBook("RELIANCE");

  book.placeLimitOrder({
    orderId: "S1",
    userId: "seller",
    side: Side.SELL,
    price: 100,
    quantity: 50,
    timestamp: 1,
  });

  const result = book.placeLimitOrder({
    orderId: "B1",
    userId: "buyer",
    side: Side.BUY,
    price: 105,
    quantity: 50,
    timestamp: 2,
  });

  assert.equal(result.trades.length, 1);

  assert.deepEqual(result.trades[0], {
    symbol: "RELIANCE",
    price: 100,
    quantity: 50,
    buyOrderId: "B1",
    sellOrderId: "S1",
    aggressorSide: Side.BUY,
    timestamp: 2,
  });

  assert.equal(book.getBestBidPrice(), null);
  assert.equal(book.getBestAskPrice(), null);
  assert.equal(book.trades.length, 1);
}

function testIncomingSellMatchesRestingBuy() {
  const book = new OrderBook("RELIANCE");

  book.placeLimitOrder({
    orderId: "B1",
    userId: "buyer",
    side: Side.BUY,
    price: 100,
    quantity: 50,
    timestamp: 1,
  });

  const result = book.placeLimitOrder({
    orderId: "S1",
    userId: "seller",
    side: Side.SELL,
    price: 95,
    quantity: 50,
    timestamp: 2,
  });

  assert.equal(result.trades.length, 1);

  assert.deepEqual(result.trades[0], {
    symbol: "RELIANCE",
    price: 100,
    quantity: 50,
    buyOrderId: "B1",
    sellOrderId: "S1",
    aggressorSide: Side.SELL,
    timestamp: 2,
  });

  assert.equal(book.getBestBidPrice(), null);
  assert.equal(book.getBestAskPrice(), null);
}

function testPartialFillIncomingBuy() {
  const book = new OrderBook("RELIANCE");

  book.placeLimitOrder({
    orderId: "S1",
    userId: "seller",
    side: Side.SELL,
    price: 100,
    quantity: 50,
    timestamp: 1,
  });

  const result = book.placeLimitOrder({
    orderId: "B1",
    userId: "buyer",
    side: Side.BUY,
    price: 105,
    quantity: 100,
    timestamp: 2,
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].quantity, 50);

  const snapshot = book.snapshot();

  assert.equal(snapshot.asks.length, 0);
  assert.equal(snapshot.bids.length, 1);
  assert.equal(snapshot.bids[0].price, 105);
  assert.equal(snapshot.bids[0].totalQuantity, 50);
}

function testOneBuyMatchesMultipleSellOrders() {
  const book = new OrderBook("RELIANCE");

  book.placeLimitOrder({
    orderId: "S1",
    userId: "seller1",
    side: Side.SELL,
    price: 100,
    quantity: 30,
    timestamp: 1,
  });

  book.placeLimitOrder({
    orderId: "S2",
    userId: "seller2",
    side: Side.SELL,
    price: 101,
    quantity: 40,
    timestamp: 2,
  });

  book.placeLimitOrder({
    orderId: "S3",
    userId: "seller3",
    side: Side.SELL,
    price: 102,
    quantity: 50,
    timestamp: 3,
  });

  const result = book.placeLimitOrder({
    orderId: "B1",
    userId: "buyer",
    side: Side.BUY,
    price: 102,
    quantity: 100,
    timestamp: 4,
  });

  assert.equal(result.trades.length, 3);

  assert.equal(result.trades[0].price, 100);
  assert.equal(result.trades[0].quantity, 30);

  assert.equal(result.trades[1].price, 101);
  assert.equal(result.trades[1].quantity, 40);

  assert.equal(result.trades[2].price, 102);
  assert.equal(result.trades[2].quantity, 30);

  const snapshot = book.snapshot();

  assert.equal(snapshot.bids.length, 0);
  assert.equal(snapshot.asks.length, 1);
  assert.equal(snapshot.asks[0].price, 102);
  assert.equal(snapshot.asks[0].totalQuantity, 20);
}

function testNoMatchWhenBuyPriceTooLow() {
  const book = new OrderBook("RELIANCE");

  book.placeLimitOrder({
    orderId: "S1",
    userId: "seller",
    side: Side.SELL,
    price: 100,
    quantity: 50,
    timestamp: 1,
  });

  const result = book.placeLimitOrder({
    orderId: "B1",
    userId: "buyer",
    side: Side.BUY,
    price: 99,
    quantity: 50,
    timestamp: 2,
  });

  assert.equal(result.trades.length, 0);

  const snapshot = book.snapshot();

  assert.equal(snapshot.bids.length, 1);
  assert.equal(snapshot.asks.length, 1);

  assert.equal(snapshot.bids[0].price, 99);
  assert.equal(snapshot.asks[0].price, 100);
}

function testBestBidAndBestAsk() {
  const book = new OrderBook("RELIANCE");

  book.placeLimitOrder({
    orderId: "B1",
    userId: "buyer1",
    side: Side.BUY,
    price: 99,
    quantity: 10,
    timestamp: 1,
  });

  book.placeLimitOrder({
    orderId: "B2",
    userId: "buyer2",
    side: Side.BUY,
    price: 101,
    quantity: 10,
    timestamp: 2,
  });

  book.placeLimitOrder({
    orderId: "S1",
    userId: "seller1",
    side: Side.SELL,
    price: 105,
    quantity: 10,
    timestamp: 3,
  });

  book.placeLimitOrder({
    orderId: "S2",
    userId: "seller2",
    side: Side.SELL,
    price: 103,
    quantity: 10,
    timestamp: 4,
  });

  assert.equal(book.getBestBidPrice(), 101);
  assert.equal(book.getBestAskPrice(), 103);
}

function testSnapshotSorting() {
  const book = new OrderBook("RELIANCE");

  book.placeLimitOrder({
    orderId: "B1",
    userId: "buyer1",
    side: Side.BUY,
    price: 99,
    quantity: 10,
    timestamp: 1,
  });

  book.placeLimitOrder({
    orderId: "B2",
    userId: "buyer2",
    side: Side.BUY,
    price: 101,
    quantity: 10,
    timestamp: 2,
  });

  book.placeLimitOrder({
    orderId: "B3",
    userId: "buyer3",
    side: Side.BUY,
    price: 100,
    quantity: 10,
    timestamp: 3,
  });

  book.placeLimitOrder({
    orderId: "S1",
    userId: "seller1",
    side: Side.SELL,
    price: 105,
    quantity: 10,
    timestamp: 4,
  });

  book.placeLimitOrder({
    orderId: "S2",
    userId: "seller2",
    side: Side.SELL,
    price: 103,
    quantity: 10,
    timestamp: 5,
  });

  book.placeLimitOrder({
    orderId: "S3",
    userId: "seller3",
    side: Side.SELL,
    price: 104,
    quantity: 10,
    timestamp: 6,
  });

  const snapshot = book.snapshot();

  assert.deepEqual(
    snapshot.bids.map((level) => level.price),
    [101, 100, 99]
  );

  assert.deepEqual(
    snapshot.asks.map((level) => level.price),
    [103, 104, 105]
  );
}

runOrderBookTests();