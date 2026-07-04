import express from "express";
import { randomUUID } from "node:crypto";
import { bookRegistry } from "../services/BookRegistry.js";
import { orderCommandBus } from "../../application/commands/orderCommandBus.js";
import { OrderCommandType } from "../../application/commands/OrderCommandTypes.js";

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

    response.status(202).json(
      createQueuedResponse(command, {
        orderId,
      }),
    );
  } catch (error) {
    next(error);
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

    response.status(202).json(
      createQueuedResponse(command, {
        orderId,
      }),
    );
  } catch (error) {
    next(error);
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

      response.status(202).json(
        createQueuedResponse(command, {
          orderId,
        }),
      );
    } catch (error) {
      next(error);
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

      response.status(202).json(
        createQueuedResponse(command, {
          orderId,
        }),
      );
    } catch (error) {
      next(error);
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

      response.status(202).json(
        createQueuedResponse(command, {
          orderId,
        }),
      );
    } catch (error) {
      next(error);
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

      response.status(202).json(
        createQueuedResponse(command, {
          orderId,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);