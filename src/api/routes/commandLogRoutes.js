import express from "express";

import { redisCommandLog } from "../../infrastructure/redis/RedisCommandLog.js";

export const commandLogRouter = express.Router();

commandLogRouter.get("/books/:symbol/commands", async (request, response, next) => {
  try {
    const { symbol } = request.params;
    const limit = Number(request.query.limit ?? 100);

    const commands = await redisCommandLog.getProcessedCommands(symbol, {
      count: limit,
    });

    return response.json({
      success: true,
      data: {
        symbol,
        commands,
      },
    });
  } catch (error) {
    return next(error);
  }
});