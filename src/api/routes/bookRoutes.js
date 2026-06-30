import express from "express";
import { bookRegistry } from "../services/BookRegistry.js";
import { broadcastBookUpdate, broadcastTrades } from "../websocket/socketServer.js";

export const bookRouter = express.Router();

bookRouter.get("/symbols", (request, response) => {
  response.json({
    success: true,
    data: {
      symbols: bookRegistry.listSymbols(),
    },
  });
});

bookRouter.get("/books/:symbol", (request, response) => {
  const { symbol } = request.params;

  const book = bookRegistry.getOrCreateBook(symbol);

  response.json({
    success: true,
    data: book.snapshot(),
  });
});

bookRouter.get("/books/:symbol/trades", (request, response) => {
  const { symbol } = request.params;

  const book = bookRegistry.getOrCreateBook(symbol);

  response.json({
    success: true,
    data: {
      symbol,
      trades: book.trades,
    },
  });
});

bookRouter.post("/books/:symbol/orders/limit", (request, response) => {
  const { symbol } = request.params;
  const { orderId, userId, side, priceTicks, quantity, timestamp } = request.body;

  const book = bookRegistry.getOrCreateBook(symbol);

  const result = book.placeLimitOrder({
    orderId,
    userId,
    side,
    priceTicks,
    quantity,
    timestamp,
  });

  broadcastTrades(symbol, result.trades);
  broadcastBookUpdate(symbol, book.snapshot());

  response.status(201).json({
    success: true,
    data: result,
  });
});

bookRouter.post("/books/:symbol/orders/market", (request, response) => {
  const { symbol } = request.params;
  const { orderId, userId, side, quantity, timestamp } = request.body;

  const book = bookRegistry.getOrCreateBook(symbol);

  const result = book.placeMarketOrder({
    orderId,
    userId,
    side,
    quantity,
    timestamp,
  });

  broadcastTrades(symbol, result.trades);
  broadcastBookUpdate(symbol, book.snapshot());

  response.status(201).json({
    success: true,
    data: result,
  });
});

bookRouter.post("/books/:symbol/orders/stop-market", (request, response) => {
  const { symbol } = request.params;
  const { orderId, userId, side, triggerPriceTicks, quantity, timestamp } =
    request.body;

  const book = bookRegistry.getOrCreateBook(symbol);

  const result = book.placeStopMarketOrder({
    orderId,
    userId,
    side,
    triggerPriceTicks,
    quantity,
    timestamp,
  });

  broadcastBookUpdate(symbol, book.snapshot());

  response.status(201).json({
    success: true,
    data: result,
  });
});

bookRouter.post("/books/:symbol/orders/stop-limit", (request, response) => {
  const { symbol } = request.params;
  const {
    orderId,
    userId,
    side,
    triggerPriceTicks,
    priceTicks,
    quantity,
    timestamp,
  } = request.body;

  const book = bookRegistry.getOrCreateBook(symbol);

  const result = book.placeStopLimitOrder({
    orderId,
    userId,
    side,
    triggerPriceTicks,
    priceTicks,
    quantity,
    timestamp,
  });

  broadcastBookUpdate(symbol, book.snapshot());

  response.status(201).json({
    success: true,
    data: result,
  });
});
bookRouter.delete("/books/:symbol/orders/:orderId", (request, response) => {
  const { symbol, orderId } = request.params;

  const book = bookRegistry.getOrCreateBook(symbol);

  const cancelledOrder = book.cancelOrder(orderId);

  broadcastBookUpdate(symbol, book.snapshot());

  response.json({
    success: true,
    data: {
      order: cancelledOrder,
    },
  });
});