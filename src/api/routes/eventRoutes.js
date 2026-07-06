import express from "express";

import { redisEventLog } from "../../infrastructure/redis/RedisEventLog.js";

export const eventRouter = express.Router();

eventRouter.get("/books/:symbol/events", async (request, response, next) => {
  try {
    const { symbol } = request.params;
    const limit = Number(request.query.limit ?? 100);

    const events = await redisEventLog.getEvents(symbol, {
      count: limit,
    });

    return response.json({
      success: true,
      data: {
        symbol,
        events,
      },
    });
  } catch (error) {
    return next(error);
  }
});
