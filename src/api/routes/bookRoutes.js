import express from "express";
import { randomUUID } from "node:crypto";

import { bookRegistry } from "../services/BookRegistry.js";
import { orderCommandBus } from "../../application/commands/orderCommandBus.js";
import { OrderCommandType } from "../../application/commands/OrderCommandTypes.js";
import { redisBookReadModel } from "../../infrastructure/redis/RedisBookReadModel.js";

export const bookRouter = express.Router();

function createOrderCommand({ type, symbol, payload }) {
  return {
    commandId: randomUUID(),
    type,
    symbol,
    payload,
    createdAt: Date.now(),
  };
}

function createQueuedResponse(command, extraData = {}) {
  return {
    success: true,
    data: {
      status: "QUEUED",
      commandId: command.commandId,
      commandType: command.type,
      symbol: command.symbol,
      ...extraData,
    },
  };
}

bookRouter.get("/symbols", (request, response) => {
  response.json({
    success: true,
    data: {
      symbols: bookRegistry.listSymbols(),
    },
  });
});

bookRouter.get("/books/:symbol", async (request, response, next) => {
  try {
    const { symbol } = request.params;

    const redisSnapshot = await redisBookReadModel.getSnapshot(symbol);

    if (redisSnapshot) {
      return response.json({
        success: true,
        source: "REDIS",
        data: redisSnapshot,
      });
    }

    const book = bookRegistry.getOrCreateBook(symbol);
    const snapshot = book.snapshot();

    return response.json({
      success: true,
      source: "MEMORY",
      data: snapshot,
    });
  } catch (error) {
    return next(error);
  }
});

bookRouter.get("/books/:symbol/trades", async (request, response, next) => {
  try {
    const { symbol } = request.params;

    const redisTrades = await redisBookReadModel.getTrades(symbol);

    if (redisTrades.length > 0) {
      return response.json({
        success: true,
        source: "REDIS",
        data: {
          symbol,
          trades: redisTrades,
        },
      });
    }

    const book = bookRegistry.getOrCreateBook(symbol);

    return response.json({
      success: true,
      source: "MEMORY",
      data: {
        symbol,
        trades: book.trades,
      },
    });
  } catch (error) {
    return next(error);
  }
});

bookRouter.post("/books/:symbol/orders/limit", async (request, response, next) => {
  try {
    const { symbol } = request.params;
    const { orderId, userId, side, priceTicks, quantity, timestamp } =
      request.body;

    const command = createOrderCommand({
      type: OrderCommandType.PLACE_LIMIT_ORDER,
      symbol,
      payload: {
        orderId,
        userId,
        side,
        priceTicks,
        quantity,
        timestamp,
      },
    });

    await orderCommandBus.publish(command);

    return response.status(202).json(
      createQueuedResponse(command, {
        orderId,
      }),
    );
  } catch (error) {
    return next(error);
  }
});

bookRouter.post("/books/:symbol/orders/market", async (request, response, next) => {
  try {
    const { symbol } = request.params;
    const { orderId, userId, side, quantity, timestamp } = request.body;

    const command = createOrderCommand({
      type: OrderCommandType.PLACE_MARKET_ORDER,
      symbol,
      payload: {
        orderId,
        userId,
        side,
        quantity,
        timestamp,
      },
    });

    await orderCommandBus.publish(command);

    return response.status(202).json(
      createQueuedResponse(command, {
        orderId,
      }),
    );
  } catch (error) {
    return next(error);
  }
});

bookRouter.post(
  "/books/:symbol/orders/stop-market",
  async (request, response, next) => {
    try {
      const { symbol } = request.params;
      const { orderId, userId, side, triggerPriceTicks, quantity, timestamp } =
        request.body;

      const command = createOrderCommand({
        type: OrderCommandType.PLACE_STOP_MARKET_ORDER,
        symbol,
        payload: {
          orderId,
          userId,
          side,
          triggerPriceTicks,
          quantity,
          timestamp,
        },
      });

      await orderCommandBus.publish(command);

      return response.status(202).json(
        createQueuedResponse(command, {
          orderId,
        }),
      );
    } catch (error) {
      return next(error);
    }
  },
);

bookRouter.post(
  "/books/:symbol/orders/stop-limit",
  async (request, response, next) => {
    try {
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

      const command = createOrderCommand({
        type: OrderCommandType.PLACE_STOP_LIMIT_ORDER,
        symbol,
        payload: {
          orderId,
          userId,
          side,
          triggerPriceTicks,
          priceTicks,
          quantity,
          timestamp,
        },
      });

      await orderCommandBus.publish(command);

      return response.status(202).json(
        createQueuedResponse(command, {
          orderId,
        }),
      );
    } catch (error) {
      return next(error);
    }
  },
);

bookRouter.post(
  "/books/:symbol/orders/trailing-stop-market",
  async (request, response, next) => {
    try {
      const { symbol } = request.params;
      const { orderId, userId, side, trailingAmountTicks, quantity, timestamp } =
        request.body;

      const command = createOrderCommand({
        type: OrderCommandType.PLACE_TRAILING_STOP_MARKET_ORDER,
        symbol,
        payload: {
          orderId,
          userId,
          side,
          trailingAmountTicks,
          quantity,
          timestamp,
        },
      });

      await orderCommandBus.publish(command);

      return response.status(202).json(
        createQueuedResponse(command, {
          orderId,
        }),
      );
    } catch (error) {
      return next(error);
    }
  },
);

bookRouter.delete(
  "/books/:symbol/orders/:orderId",
  async (request, response, next) => {
    try {
      const { symbol, orderId } = request.params;

      const command = createOrderCommand({
        type: OrderCommandType.CANCEL_ORDER,
        symbol,
        payload: {
          orderId,
        },
      });

      await orderCommandBus.publish(command);

      return response.status(202).json(
        createQueuedResponse(command, {
          orderId,
        }),
      );
    } catch (error) {
      return next(error);
    }
  },
);