import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { createApp } from "../src/api/app.js";
import { bookRegistry } from "../src/api/services/BookRegistry.js";

beforeEach(() => {
  bookRegistry.reset();
});

test("GET /health should return service health", async () => {
  const app = createApp();

  const response = await request(app)
    .get("/health")
    .expect(200);

  assert.equal(response.body.success, true);
  assert.equal(response.body.data.status, "ok");
  assert.equal(response.body.data.service, "lob-matching-engine");
});

test("GET /api/v1/books/:symbol should create and return empty book snapshot", async () => {
  const app = createApp();

  const response = await request(app)
    .get("/api/v1/books/BTC-INR")
    .expect(200);

  assert.equal(response.body.success, true);
  assert.equal(response.body.data.symbol, "BTC-INR");
  assert.equal(response.body.data.bestBidPriceTicks, null);
  assert.equal(response.body.data.bestAskPriceTicks, null);
  assert.deepEqual(response.body.data.bids, []);
  assert.deepEqual(response.body.data.asks, []);
});

test("POST /api/v1/books/:symbol/orders/limit should place resting SELL limit order", async () => {
  const app = createApp();

  const response = await request(app)
    .post("/api/v1/books/BTC-INR/orders/limit")
    .send({
      orderId: "S1",
      userId: "U1",
      side: "SELL",
      priceTicks: 10100,
      quantity: 5,
      timestamp: 1,
    })
    .expect(201);

  assert.equal(response.body.success, true);
  assert.equal(response.body.data.order.orderId, "S1");
  assert.equal(response.body.data.order.side, "SELL");
  assert.equal(response.body.data.order.priceTicks, 10100);
  assert.equal(response.body.data.order.remainingQuantity, 5);
  assert.equal(response.body.data.order.status, "OPEN");
  assert.deepEqual(response.body.data.trades, []);

  const bookResponse = await request(app)
    .get("/api/v1/books/BTC-INR")
    .expect(200);

  assert.equal(bookResponse.body.data.bestAskPriceTicks, 10100);
  assert.equal(bookResponse.body.data.asks.length, 1);
  assert.equal(bookResponse.body.data.asks[0].priceTicks, 10100);
  assert.equal(bookResponse.body.data.asks[0].totalQuantity, 5);
});

test("POST /api/v1/books/:symbol/orders/limit should match BUY limit order against resting SELL", async () => {
  const app = createApp();

  await request(app)
    .post("/api/v1/books/BTC-INR/orders/limit")
    .send({
      orderId: "S1",
      userId: "U1",
      side: "SELL",
      priceTicks: 10100,
      quantity: 5,
      timestamp: 1,
    })
    .expect(201);

  const response = await request(app)
    .post("/api/v1/books/BTC-INR/orders/limit")
    .send({
      orderId: "B1",
      userId: "U2",
      side: "BUY",
      priceTicks: 10100,
      quantity: 3,
      timestamp: 2,
    })
    .expect(201);

  assert.equal(response.body.success, true);
  assert.equal(response.body.data.order.orderId, "B1");
  assert.equal(response.body.data.order.status, "FILLED");
  assert.equal(response.body.data.order.remainingQuantity, 0);
  assert.equal(response.body.data.trades.length, 1);

  const trade = response.body.data.trades[0];

  assert.equal(trade.symbol, "BTC-INR");
  assert.equal(trade.priceTicks, 10100);
  assert.equal(trade.quantity, 3);
  assert.equal(trade.buyOrderId, "B1");
  assert.equal(trade.sellOrderId, "S1");
  assert.equal(trade.aggressorSide, "BUY");

  const bookResponse = await request(app)
    .get("/api/v1/books/BTC-INR")
    .expect(200);

  assert.equal(bookResponse.body.data.bestAskPriceTicks, 10100);
  assert.equal(bookResponse.body.data.asks[0].totalQuantity, 2);
});

test("POST /api/v1/books/:symbol/orders/market should match market BUY against lowest ask", async () => {
  const app = createApp();

  await request(app)
    .post("/api/v1/books/BTC-INR/orders/limit")
    .send({
      orderId: "S1",
      userId: "U1",
      side: "SELL",
      priceTicks: 10100,
      quantity: 5,
      timestamp: 1,
    })
    .expect(201);

  await request(app)
    .post("/api/v1/books/BTC-INR/orders/limit")
    .send({
      orderId: "S2",
      userId: "U2",
      side: "SELL",
      priceTicks: 10200,
      quantity: 5,
      timestamp: 2,
    })
    .expect(201);

  const response = await request(app)
    .post("/api/v1/books/BTC-INR/orders/market")
    .send({
      orderId: "MB1",
      userId: "U3",
      side: "BUY",
      quantity: 7,
      timestamp: 3,
    })
    .expect(201);

  assert.equal(response.body.success, true);
  assert.equal(response.body.data.order.orderId, "MB1");
  assert.equal(response.body.data.order.type, "MARKET");
  assert.equal(response.body.data.order.priceTicks, null);
  assert.equal(response.body.data.order.status, "FILLED");
  assert.equal(response.body.data.order.remainingQuantity, 0);

  assert.equal(response.body.data.trades.length, 2);
  assert.equal(response.body.data.trades[0].priceTicks, 10100);
  assert.equal(response.body.data.trades[0].quantity, 5);
  assert.equal(response.body.data.trades[1].priceTicks, 10200);
  assert.equal(response.body.data.trades[1].quantity, 2);

  const bookResponse = await request(app)
    .get("/api/v1/books/BTC-INR")
    .expect(200);

  assert.equal(bookResponse.body.data.bestAskPriceTicks, 10200);
  assert.equal(bookResponse.body.data.asks[0].totalQuantity, 3);
});

test("POST /api/v1/books/:symbol/orders/market should match market SELL against highest bid", async () => {
  const app = createApp();

  await request(app)
    .post("/api/v1/books/BTC-INR/orders/limit")
    .send({
      orderId: "B1",
      userId: "U1",
      side: "BUY",
      priceTicks: 10100,
      quantity: 5,
      timestamp: 1,
    })
    .expect(201);

  await request(app)
    .post("/api/v1/books/BTC-INR/orders/limit")
    .send({
      orderId: "B2",
      userId: "U2",
      side: "BUY",
      priceTicks: 10000,
      quantity: 5,
      timestamp: 2,
    })
    .expect(201);

  const response = await request(app)
    .post("/api/v1/books/BTC-INR/orders/market")
    .send({
      orderId: "MS1",
      userId: "U3",
      side: "SELL",
      quantity: 8,
      timestamp: 3,
    })
    .expect(201);

  assert.equal(response.body.success, true);
  assert.equal(response.body.data.order.orderId, "MS1");
  assert.equal(response.body.data.order.type, "MARKET");
  assert.equal(response.body.data.order.priceTicks, null);
  assert.equal(response.body.data.order.status, "FILLED");

  assert.equal(response.body.data.trades.length, 2);
  assert.equal(response.body.data.trades[0].priceTicks, 10100);
  assert.equal(response.body.data.trades[0].quantity, 5);
  assert.equal(response.body.data.trades[1].priceTicks, 10000);
  assert.equal(response.body.data.trades[1].quantity, 3);

  const bookResponse = await request(app)
    .get("/api/v1/books/BTC-INR")
    .expect(200);

  assert.equal(bookResponse.body.data.bestBidPriceTicks, 10000);
  assert.equal(bookResponse.body.data.bids[0].totalQuantity, 2);
});

test("DELETE /api/v1/books/:symbol/orders/:orderId should cancel resting order", async () => {
  const app = createApp();

  await request(app)
    .post("/api/v1/books/BTC-INR/orders/limit")
    .send({
      orderId: "B1",
      userId: "U1",
      side: "BUY",
      priceTicks: 10000,
      quantity: 5,
      timestamp: 1,
    })
    .expect(201);

  const response = await request(app)
    .delete("/api/v1/books/BTC-INR/orders/B1")
    .expect(200);

  assert.equal(response.body.success, true);
  assert.equal(response.body.data.order.orderId, "B1");
  assert.equal(response.body.data.order.status, "CANCELLED");

  const bookResponse = await request(app)
    .get("/api/v1/books/BTC-INR")
    .expect(200);

  assert.equal(bookResponse.body.data.bestBidPriceTicks, null);
  assert.deepEqual(bookResponse.body.data.bids, []);
});

test("GET /api/v1/books/:symbol/trades should return trade history", async () => {
  const app = createApp();

  await request(app)
    .post("/api/v1/books/BTC-INR/orders/limit")
    .send({
      orderId: "S1",
      userId: "U1",
      side: "SELL",
      priceTicks: 10100,
      quantity: 5,
      timestamp: 1,
    })
    .expect(201);

  await request(app)
    .post("/api/v1/books/BTC-INR/orders/limit")
    .send({
      orderId: "B1",
      userId: "U2",
      side: "BUY",
      priceTicks: 10100,
      quantity: 5,
      timestamp: 2,
    })
    .expect(201);

  const response = await request(app)
    .get("/api/v1/books/BTC-INR/trades")
    .expect(200);

  assert.equal(response.body.success, true);
  assert.equal(response.body.data.symbol, "BTC-INR");
  assert.equal(response.body.data.trades.length, 1);
  assert.equal(response.body.data.trades[0].buyOrderId, "B1");
  assert.equal(response.body.data.trades[0].sellOrderId, "S1");
  assert.equal(response.body.data.trades[0].priceTicks, 10100);
});

test("GET /api/v1/symbols should return created symbols", async () => {
  const app = createApp();

  await request(app)
    .get("/api/v1/books/BTC-INR")
    .expect(200);

  await request(app)
    .get("/api/v1/books/ETH-INR")
    .expect(200);

  const response = await request(app)
    .get("/api/v1/symbols")
    .expect(200);

  assert.equal(response.body.success, true);
  assert.deepEqual(response.body.data.symbols.sort(), ["BTC-INR", "ETH-INR"]);
});

test("API should support multiple independent books", async () => {
  const app = createApp();

  await request(app)
    .post("/api/v1/books/BTC-INR/orders/limit")
    .send({
      orderId: "BTC-S1",
      userId: "U1",
      side: "SELL",
      priceTicks: 10100,
      quantity: 5,
      timestamp: 1,
    })
    .expect(201);

  await request(app)
    .post("/api/v1/books/ETH-INR/orders/limit")
    .send({
      orderId: "ETH-B1",
      userId: "U2",
      side: "BUY",
      priceTicks: 250000,
      quantity: 3,
      timestamp: 1,
    })
    .expect(201);

  const btcResponse = await request(app)
    .get("/api/v1/books/BTC-INR")
    .expect(200);

  const ethResponse = await request(app)
    .get("/api/v1/books/ETH-INR")
    .expect(200);

  assert.equal(btcResponse.body.data.bestAskPriceTicks, 10100);
  assert.equal(btcResponse.body.data.bestBidPriceTicks, null);

  assert.equal(ethResponse.body.data.bestBidPriceTicks, 250000);
  assert.equal(ethResponse.body.data.bestAskPriceTicks, null);
});

test("invalid priceTicks should return error response", async () => {
  const app = createApp();

  const response = await request(app)
    .post("/api/v1/books/BTC-INR/orders/limit")
    .send({
      orderId: "BAD1",
      userId: "U1",
      side: "BUY",
      priceTicks: 100.5,
      quantity: 5,
      timestamp: 1,
    })
    .expect(400);

  assert.equal(response.body.success, false);
  assert.match(response.body.error, /priceTicks must be a positive integer/);
});

test("invalid side should return error response", async () => {
  const app = createApp();

  const response = await request(app)
    .post("/api/v1/books/BTC-INR/orders/limit")
    .send({
      orderId: "BAD1",
      userId: "U1",
      side: "buy",
      priceTicks: 10000,
      quantity: 5,
      timestamp: 1,
    })
    .expect(400);

  assert.equal(response.body.success, false);
  assert.match(response.body.error, /invalid order side: buy/);
});

test("duplicate resting orderId should return error response", async () => {
  const app = createApp();

  await request(app)
    .post("/api/v1/books/BTC-INR/orders/limit")
    .send({
      orderId: "B1",
      userId: "U1",
      side: "BUY",
      priceTicks: 10000,
      quantity: 5,
      timestamp: 1,
    })
    .expect(201);

  const response = await request(app)
    .post("/api/v1/books/BTC-INR/orders/limit")
    .send({
      orderId: "B1",
      userId: "U2",
      side: "BUY",
      priceTicks: 9900,
      quantity: 5,
      timestamp: 2,
    })
    .expect(400);

  assert.equal(response.body.success, false);
  assert.match(response.body.error, /order already exists: B1/);
});

test("cancel unknown order should return error response", async () => {
  const app = createApp();

  const response = await request(app)
    .delete("/api/v1/books/BTC-INR/orders/UNKNOWN")
    .expect(400);

  assert.equal(response.body.success, false);
  assert.match(response.body.error, /order not found: UNKNOWN/);
});

test("unknown route should return 404 response", async () => {
  const app = createApp();

  const response = await request(app)
    .get("/api/v1/unknown-route")
    .expect(404);

  assert.equal(response.body.success, false);
  assert.match(response.body.error, /Route not found/);
});
