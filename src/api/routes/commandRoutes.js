import express from "express";

import { redisCommandStatusStore } from "../../infrastructure/redis/RedisCommandStatusStore.js";

export const commandRouter = express.Router();

commandRouter.get("/commands/:commandId/status", async (request, response, next) => {
  try {
    const { commandId } = request.params;

    const commandStatus = await redisCommandStatusStore.getStatus(commandId);

    if (!commandStatus) {
      return response.status(404).json({
        success: false,
        error: `command status not found: ${commandId}`,
      });
    }

    return response.json({
      success: true,
      data: commandStatus,
    });
  } catch (error) {
    return next(error);
  }
});
