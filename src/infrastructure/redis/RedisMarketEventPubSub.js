import { createClient } from "redis";
import { connectRedis } from "./redisConnection.js";

export const MARKET_EVENTS_CHANNEL = "market:events";

export async function publishMarketEvents(symbol, events = []) {
  if (events.length === 0) {
    return;
  }

  try {
    const redis = await connectRedis();

    await redis.publish(
      MARKET_EVENTS_CHANNEL,
      JSON.stringify({
        symbol,
        events,
        publishedAt: Date.now(),
      }),
    );
  } catch (error) {
    // Market-data delivery is ephemeral. Durable command/event logs and recovery
    // snapshots remain the source of truth if Pub/Sub is unavailable.
    console.error("[matching-worker] failed to publish market events", {
      symbol,
      message: error.message,
    });
  }
}

export async function subscribeToMarketEvents(onEvents) {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const subscriber = createClient({ url: redisUrl });

  subscriber.on("error", (error) => {
    console.error("[websocket] redis subscriber error", error);
  });

  await subscriber.connect();
  await subscriber.subscribe(MARKET_EVENTS_CHANNEL, async (message) => {
    try {
      const payload = JSON.parse(message);

      if (
        typeof payload.symbol !== "string" ||
        !Array.isArray(payload.events)
      ) {
        throw new Error("invalid market event payload");
      }

      await onEvents(payload.symbol, payload.events);
    } catch (error) {
      console.error("[websocket] failed to handle market events", {
        message: error.message,
      });
    }
  });

  return subscriber;
}
