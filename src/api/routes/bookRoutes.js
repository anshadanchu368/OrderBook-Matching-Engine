import express from "express";
import { bookRegistry } from "../services/BookRegistry.js";

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

  response.status(201).json({
    success: true,
    data: result,
  });
});

bookRouter.delete("/books/:symbol/orders/:orderId", (request, response) => {
  const { symbol, orderId } = request.params;

  const book = bookRegistry.getOrCreateBook(symbol);

  const cancelledOrder = book.cancelOrder(orderId);

  response.json({
    success: true,
    data: {
      order: cancelledOrder,
    },
  });
});