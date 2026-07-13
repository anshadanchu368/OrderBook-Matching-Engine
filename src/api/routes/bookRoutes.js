import express from "express";
import { randomUUID } from "node:crypto";

import { orderCommandBus } from "../../application/commands/orderCommandBus.js";
import { OrderCommandType } from "../../application/commands/OrderCommandTypes.js";
import { redisBookReadModel } from "../../infrastructure/redis/RedisBookReadModel.js";
import { redisCommandStatusStore } from "../../infrastructure/redis/RedisCommandStatusStore.js";
import { CommandStatus } from "../../application/commands/CommandStatus.js";
import { getPartitionId } from "../../application/partitioning/symbolPartitioner.js";

export const bookRouter = express.Router();

const PARTITION_COUNT = parseInt(process.env.PARTITION_COUNT ?? "1", 10);

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

async function saveQueuedCommandStatus(command) {
  const now = Date.now();

  await redisCommandStatusStore.saveStatus({
    commandId: command.commandId,
    symbol: command.symbol,
    type: command.type,
    status: CommandStatus.QUEUED,
    reason: null,
    createdAt: command.createdAt ?? now,
    updatedAt: now,
  });
}

bookRouter.get("/symbols", async (request, response, next) => {
  try {
    const symbols = await redisBookReadModel.getSymbols();

    return response.json({
      success: true,
      data: {
        symbols,
      },
    });
  } catch (error) {
    return next(error);
  }
});

bookRouter.get("/books/:symbol", async (request, response, next) => {
  try {
    const { symbol } = request.params;

    const redisSnapshot = await redisBookReadModel.getSnapshot(symbol);

    if (!redisSnapshot) {
      return response.status(404).json({
        success: false,
        error: `book snapshot not found for symbol: ${symbol}`,
      });
    }

    return response.json({
      success: true,
      source: "REDIS",
      data: redisSnapshot,
    });
  } catch (error) {
    return next(error);
  }
});

bookRouter.get("/books/:symbol/trades", async (request, response, next) => {
  try {
    const { symbol } = request.params;

    const redisTrades = await redisBookReadModel.getTrades(symbol);

    return response.json({
      success: true,
      source: "REDIS",
      data: {
        symbol,
        trades: redisTrades,
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

    await saveQueuedCommandStatus(command);
    const partitionId = getPartitionId(symbol, PARTITION_COUNT);
    await orderCommandBus.publish(command, partitionId);

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

    await saveQueuedCommandStatus(command);
    const partitionId = getPartitionId(symbol, PARTITION_COUNT);
    await orderCommandBus.publish(command, partitionId);

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

       await saveQueuedCommandStatus(command);
      const partitionId = getPartitionId(symbol, PARTITION_COUNT);
      await orderCommandBus.publish(command, partitionId);

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
      
      await saveQueuedCommandStatus(command);
      const partitionId = getPartitionId(symbol, PARTITION_COUNT);
      await orderCommandBus.publish(command, partitionId);

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
    await saveQueuedCommandStatus(command);
    const partitionId = getPartitionId(symbol, PARTITION_COUNT);

      await orderCommandBus.publish(command, partitionId);

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

      await saveQueuedCommandStatus(command);
      const partitionId = getPartitionId(symbol, PARTITION_COUNT);
      await orderCommandBus.publish(command, partitionId);

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
