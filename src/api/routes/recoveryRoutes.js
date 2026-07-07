import express from "express";

import { redisRecoverySnapshotStore } from "../../infrastructure/redis/RedisRecoverySnapshotStore.js";

export const recoveryRouter = express.Router();

recoveryRouter.get("/books/:symbol/recovery-snapshot", async (request, response, next) => {
  try {
    const { symbol } = request.params;

    const snapshot = await redisRecoverySnapshotStore.getSnapshot(symbol);

    if (!snapshot) {
      return response.status(404).json({
        success: false,
        error: `recovery snapshot not found for symbol: ${symbol}`,
      });
    }

    return response.json({
      success: true,
      data: snapshot,
    });
  } catch (error) {
    return next(error);
  }
});
