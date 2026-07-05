import test, { before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { createApp } from "../src/api/app.js";
import { bookRegistry } from "../src/api/services/BookRegistry.js";
import { connectRabbitMQ } from "../src/infrastructure/rabbitmq/rabbitConnection.js";
import { RabbitQueue } from "../src/infrastructure/rabbitmq/rabbitConfig.js";
import { connectRedis } from "../src/infrastructure/redis/redisConnection.js";
import { startOrderCommandWorker } from "../src/workers/orderCommanderWorker.js";

let workerStarted = false;

before(async () => {
  if (!workerStarted) {
    await startOrderCommandWorker();
    workerStarted = true;
  }
});

beforeEach(async () => {
  bookRegistry.reset();

  const redis = await connectRedis();
  await redis.flushDb();

  const channel = await connectRabbitMQ();
  await channel.purgeQueue(RabbitQueue.ORDER_COMMANDS);
  await channel.purgeQueue(RabbitQueue.ORDER_COMMANDS_DLQ);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCommandStatus(app, commandId, expectedStatus, timeoutMs = 3000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await request(app)
      .get(`/api/v1/commands/${commandId}/status`);

    if (
      response.status === 200 &&
      response.body.data?.status === expectedStatus
    ) {
      return response.body.data;
    }

    await sleep(50);
  }

  throw new Error(
    `Timed out waiting for command ${commandId} to become ${expectedStatus}`,
  );
}

test("POST order should create QUEUED command status", async () => {
  const app = createApp();
  const symbol = "CMD-QUEUED-INR";

  const response = await request(app)
    .post(`/api/v1/books/${symbol}/orders/limit`)
    .send({
      orderId: "CQ-B1",
      userId: "U1",
      side: "BUY",
      priceTicks: 10000,
      quantity: 10,
      timestamp: 1,
    })
    .expect(202);

  const commandId = response.body.data.commandId;

  assert.equal(response.body.success, true);
  assert.equal(response.body.data.status, "QUEUED");
  assert.equal(typeof commandId, "string");

  const statusResponse = await request(app)
    .get(`/api/v1/commands/${commandId}/status`)
    .expect(200);

  assert.equal(statusResponse.body.success, true);
  assert.equal(statusResponse.body.data.commandId, commandId);
  assert.equal(statusResponse.body.data.symbol, symbol);
  assert.equal(statusResponse.body.data.type, "PLACE_LIMIT_ORDER");

  assert.ok(
    ["QUEUED", "PROCESSED"].includes(statusResponse.body.data.status),
  );
});

test("worker should update command status to PROCESSED after successful order", async () => {
  const app = createApp();
  const symbol = "CMD-PROCESSED-INR";

  const response = await request(app)
    .post(`/api/v1/books/${symbol}/orders/limit`)
    .send({
      orderId: "CP-B1",
      userId: "U1",
      side: "BUY",
      priceTicks: 10000,
      quantity: 10,
      timestamp: 1,
    })
    .expect(202);

  const commandId = response.body.data.commandId;

  const commandStatus = await waitForCommandStatus(
    app,
    commandId,
    "PROCESSED",
  );

  assert.equal(commandStatus.commandId, commandId);
  assert.equal(commandStatus.symbol, symbol);
  assert.equal(commandStatus.type, "PLACE_LIMIT_ORDER");
  assert.equal(commandStatus.status, "PROCESSED");
  assert.equal(commandStatus.reason, null);
  assert.equal(typeof commandStatus.createdAt, "number");
  assert.equal(typeof commandStatus.updatedAt, "number");
});

test("worker should update command status to REJECTED for duplicate order", async () => {
  const app = createApp();
  const symbol = "CMD-REJECTED-INR";

  const firstResponse = await request(app)
    .post(`/api/v1/books/${symbol}/orders/limit`)
    .send({
      orderId: "CR-B1",
      userId: "U1",
      side: "BUY",
      priceTicks: 10000,
      quantity: 10,
      timestamp: 1,
    })
    .expect(202);

  await waitForCommandStatus(
    app,
    firstResponse.body.data.commandId,
    "PROCESSED",
  );

  const duplicateResponse = await request(app)
    .post(`/api/v1/books/${symbol}/orders/limit`)
    .send({
      orderId: "CR-B1",
      userId: "U2",
      side: "BUY",
      priceTicks: 9990,
      quantity: 5,
      timestamp: 2,
    })
    .expect(202);

  const duplicateCommandId = duplicateResponse.body.data.commandId;

  const commandStatus = await waitForCommandStatus(
    app,
    duplicateCommandId,
    "REJECTED",
  );

  assert.equal(commandStatus.commandId, duplicateCommandId);
  assert.equal(commandStatus.symbol, symbol);
  assert.equal(commandStatus.type, "PLACE_LIMIT_ORDER");
  assert.equal(commandStatus.status, "REJECTED");
  assert.match(commandStatus.reason, /order already exists/);
});

test("GET command status should return 404 for missing commandId", async () => {
  const app = createApp();

  const response = await request(app)
    .get("/api/v1/commands/unknown-command-id/status")
    .expect(404);

  assert.equal(response.body.success, false);
  assert.match(response.body.error, /command status not found/);
});
