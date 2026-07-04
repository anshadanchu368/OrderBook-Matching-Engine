import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { createApp } from "../src/api/app.js";
import { bookRegistry } from "../src/api/services/BookRegistry.js";
import { connectRabbitMQ } from "../src/infrastructure/rabbitmq/rabbitConnection.js";
import { RabbitQueue } from "../src/infrastructure/rabbitmq/rabbitConfig.js";

beforeEach(async () => {
  bookRegistry.reset();

  const channel = await connectRabbitMQ();
  await channel.purgeQueue(RabbitQueue.ORDER_COMMANDS);
  await channel.purgeQueue(RabbitQueue.ORDER_COMMANDS_DLQ);
});

function assertQueuedResponse(response, { commandType, symbol, orderId }) {
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.status, "QUEUED");
  assert.equal(response.body.data.commandType, commandType);
  assert.equal(response.body.data.symbol, symbol);
  assert.equal(response.body.data.orderId, orderId);
  assert.equal(typeof response.body.data.commandId, "string");
  assert.ok(response.body.data.commandId.length > 0);
}

test("GET /health should return service health", async () => {
  const app = createApp();

  const response = await request(app).get("/health").expect(200);

  assert.equal(response.body.success, true);
  assert.equal(response.body.data.status, "ok");
  assert.equal(response.body.data.service, "lob-matching-engine");
});

test("GET /api/v1/books/:symbol should return empty book snapshot", async () => {
  const app = createApp();

  const response = await request(app).get("/api/v1/books/BTC-INR").expect(200);

  assert.equal(response.body.success, true);
  assert.equal(response.body.data.symbol, "BTC-INR");
  assert.equal(response.body.data.bestBidPriceTicks, null);
  assert.equal(response.body.data.bestAskPriceTicks, null);
  assert.deepEqual(response.body.data.bids, []);
  assert.deepEqual(response.body.data.asks, []);
});

test("POST limit order should return QUEUED", async () => {
  const app = createApp();

  const response = await request(app)
    .post("/api/v1/books/BTC-INR/orders/limit")
    .send({
      orderId: "B1",
      userId: "U1",
      side: "BUY",
      priceTicks: 100,
      quantity: 10,
      timestamp: 1,
    })
    .expect(202);

  assertQueuedResponse(response, {
    commandType: "PLACE_LIMIT_ORDER",
    symbol: "BTC-INR",
    orderId: "B1",
  });
});

test("POST market order should return QUEUED", async () => {
  const app = createApp();

  const response = await request(app)
    .post("/api/v1/books/BTC-INR/orders/market")
    .send({
      orderId: "M1",
      userId: "U1",
      side: "BUY",
      quantity: 10,
      timestamp: 1,
    })
    .expect(202);

  assertQueuedResponse(response, {
    commandType: "PLACE_MARKET_ORDER",
    symbol: "BTC-INR",
    orderId: "M1",
  });
});

test("POST stop-market order should return QUEUED", async () => {
  const app = createApp();

  const response = await request(app)
    .post("/api/v1/books/BTC-INR/orders/stop-market")
    .send({
      orderId: "SM1",
      userId: "U1",
      side: "SELL",
      triggerPriceTicks: 95,
      quantity: 10,
      timestamp: 1,
    })
    .expect(202);

  assertQueuedResponse(response, {
    commandType: "PLACE_STOP_MARKET_ORDER",
    symbol: "BTC-INR",
    orderId: "SM1",
  });
});

test("POST stop-limit order should return QUEUED", async () => {
  const app = createApp();

  const response = await request(app)
    .post("/api/v1/books/BTC-INR/orders/stop-limit")
    .send({
      orderId: "SL1",
      userId: "U1",
      side: "BUY",
      triggerPriceTicks: 105,
      priceTicks: 105,
      quantity: 10,
      timestamp: 1,
    })
    .expect(202);

  assertQueuedResponse(response, {
    commandType: "PLACE_STOP_LIMIT_ORDER",
    symbol: "BTC-INR",
    orderId: "SL1",
  });
});

test("POST trailing-stop-market order should return QUEUED", async () => {
  const app = createApp();

  const response = await request(app)
    .post("/api/v1/books/BTC-INR/orders/trailing-stop-market")
    .send({
      orderId: "TSM1",
      userId: "U1",
      side: "SELL",
      trailingAmountTicks: 5,
      quantity: 10,
      timestamp: 1,
    })
    .expect(202);

  assertQueuedResponse(response, {
    commandType: "PLACE_TRAILING_STOP_MARKET_ORDER",
    symbol: "BTC-INR",
    orderId: "TSM1",
  });
});

test("DELETE order should return QUEUED", async () => {
  const app = createApp();

  const response = await request(app)
    .delete("/api/v1/books/BTC-INR/orders/B1")
    .expect(202);

  assertQueuedResponse(response, {
    commandType: "CANCEL_ORDER",
    symbol: "BTC-INR",
    orderId: "B1",
  });
});

test("GET /api/v1/symbols should return created symbols", async () => {
  const app = createApp();

  await request(app).get("/api/v1/books/BTC-INR").expect(200);
  await request(app).get("/api/v1/books/ETH-INR").expect(200);

  const response = await request(app).get("/api/v1/symbols").expect(200);

  assert.equal(response.body.success, true);
  assert.deepEqual(response.body.data.symbols.sort(), ["BTC-INR", "ETH-INR"]);
});

test("GET /api/v1/books/:symbol/trades should return empty trade history initially", async () => {
  const app = createApp();

  const response = await request(app)
    .get("/api/v1/books/BTC-INR/trades")
    .expect(200);

  assert.equal(response.body.success, true);
  assert.equal(response.body.data.symbol, "BTC-INR");
  assert.deepEqual(response.body.data.trades, []);
});

test("unknown route should return 404 response", async () => {
  const app = createApp();

  const response = await request(app).get("/api/v1/unknown-route").expect(404);

  assert.equal(response.body.success, false);
  assert.match(response.body.error, /Route not found/);
});