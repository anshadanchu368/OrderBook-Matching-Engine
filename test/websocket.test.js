import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import request from "supertest";
import { Server } from "socket.io";
import { io as Client } from "socket.io-client";

import { createApp } from "../src/api/app.js";
import { bookRegistry } from "../src/api/services/BookRegistry.js";
import { initializeSocketServer } from "../src/api/websocket/socketServer.js";

beforeEach(() => {
  bookRegistry.reset();
});

async function createTestServer() {
  const app = createApp();
  const httpServer = http.createServer(app);

  const ioServer = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  initializeSocketServer(ioServer);

  await new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });

  const { port } = httpServer.address();

  return {
    httpServer,
    ioServer,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

function connectSocket(baseUrl) {
  return Client(baseUrl, {
    transports: ["websocket"],
    forceNew: true,
  });
}

function waitForEvent(socket, eventName, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for event: ${eventName}`));
    }, timeoutMs);

    function handler(payload) {
      clearTimeout(timer);
      resolve(payload);
    }

    socket.once(eventName, handler);
  });
}

function waitForNoEvent(socket, eventName, timeoutMs = 300) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      resolve();
    }, timeoutMs);

    function handler(payload) {
      clearTimeout(timer);
      reject(
        new Error(
          `Expected no ${eventName} event, but received: ${JSON.stringify(payload)}`,
        ),
      );
    }

    socket.once(eventName, handler);
  });
}

async function closeTestServer({ socket, ioServer, httpServer }) {
  if (socket) {
    socket.disconnect();
  }

  await new Promise((resolve) => {
    ioServer.close(resolve);
  });

  await new Promise((resolve) => {
    httpServer.close(resolve);
  });
}

test("websocket client can connect and subscribe to a book", async () => {
  const server = await createTestServer();
  const socket = connectSocket(server.baseUrl);

  try {
    await waitForEvent(socket, "connect");

    const subscribedPromise = waitForEvent(socket, "subscribed:book");

    socket.emit("subscribe:book", {
      symbol: "BTC-INR",
    });

    const message = await subscribedPromise;

    assert.equal(message.symbol, "BTC-INR");
    assert.equal(message.room, "book:BTC-INR");
  } finally {
    await closeTestServer({
      socket,
      ioServer: server.ioServer,
      httpServer: server.httpServer,
    });
  }
});

test("placing a limit order broadcasts book:update to subscribed clients", async () => {
  const server = await createTestServer();
  const socket = connectSocket(server.baseUrl);

  try {
    await waitForEvent(socket, "connect");

    const subscribedPromise = waitForEvent(socket, "subscribed:book");

    socket.emit("subscribe:book", {
      symbol: "BTC-INR",
    });

    await subscribedPromise;

    const bookUpdatePromise = waitForEvent(socket, "book:update");

    const response = await request(server.httpServer)
      .post("/api/v1/books/BTC-INR/orders/limit")
      .send({
        orderId: "S1",
        userId: "U1",
        side: "SELL",
        priceTicks: 10100,
        quantity: 5,
        timestamp: 1,
      });

    assert.equal(response.status, 201);
    assert.equal(response.body.success, true);

    const event = await bookUpdatePromise;

    assert.equal(event.type, "BOOK_UPDATED");
    assert.equal(event.symbol, "BTC-INR");
    assert.equal(event.data.symbol, "BTC-INR");
    assert.equal(event.data.bestAskPriceTicks, 10100);
  } finally {
    await closeTestServer({
      socket,
      ioServer: server.ioServer,
      httpServer: server.httpServer,
    });
  }
});

test("matching orders broadcast trade:created and book:update", async () => {
  const server = await createTestServer();
  const socket = connectSocket(server.baseUrl);

  try {
    await waitForEvent(socket, "connect");

    const subscribedPromise = waitForEvent(socket, "subscribed:book");

    socket.emit("subscribe:book", {
      symbol: "BTC-INR",
    });

    await subscribedPromise;

    const firstBookUpdatePromise = waitForEvent(socket, "book:update");

    const sellResponse = await request(server.httpServer)
      .post("/api/v1/books/BTC-INR/orders/limit")
      .send({
        orderId: "S2",
        userId: "U1",
        side: "SELL",
        priceTicks: 10100,
        quantity: 5,
        timestamp: 1,
      });

    assert.equal(sellResponse.status, 201);
    await firstBookUpdatePromise;

    const tradePromise = waitForEvent(socket, "trade:created");
    const secondBookUpdatePromise = waitForEvent(socket, "book:update");

    const buyResponse = await request(server.httpServer)
      .post("/api/v1/books/BTC-INR/orders/limit")
      .send({
        orderId: "B1",
        userId: "U2",
        side: "BUY",
        priceTicks: 10100,
        quantity: 5,
        timestamp: 2,
      });

    assert.equal(buyResponse.status, 201);

    const tradeEvent = await tradePromise;
    const bookUpdateEvent = await secondBookUpdatePromise;

    assert.equal(tradeEvent.type, "TRADE_CREATED");
    assert.equal(tradeEvent.symbol, "BTC-INR");
    assert.equal(tradeEvent.data.priceTicks, 10100);
    assert.equal(tradeEvent.data.quantity, 5);

    assert.equal(bookUpdateEvent.type, "BOOK_UPDATED");
    assert.equal(bookUpdateEvent.symbol, "BTC-INR");
  } finally {
    await closeTestServer({
      socket,
      ioServer: server.ioServer,
      httpServer: server.httpServer,
    });
  }
});

test("unsubscribed clients do not receive book:update", async () => {
  const server = await createTestServer();
  const socket = connectSocket(server.baseUrl);

  try {
    await waitForEvent(socket, "connect");

    const subscribedPromise = waitForEvent(socket, "subscribed:book");

    socket.emit("subscribe:book", {
      symbol: "BTC-INR",
    });

    await subscribedPromise;

    const unsubscribedPromise = waitForEvent(socket, "unsubscribed:book");

    socket.emit("unsubscribe:book", {
      symbol: "BTC-INR",
    });

    const unsubscribeMessage = await unsubscribedPromise;

    assert.equal(unsubscribeMessage.symbol, "BTC-INR");
    assert.equal(unsubscribeMessage.room, "book:BTC-INR");

    const noBookUpdatePromise = waitForNoEvent(socket, "book:update");

    const response = await request(server.httpServer)
      .post("/api/v1/books/BTC-INR/orders/limit")
      .send({
        orderId: "S3",
        userId: "U3",
        side: "SELL",
        priceTicks: 10200,
        quantity: 10,
        timestamp: 3,
      });

    assert.equal(response.status, 201);

    await noBookUpdatePromise;
  } finally {
    await closeTestServer({
      socket,
      ioServer: server.ioServer,
      httpServer: server.httpServer,
    });
  }
});