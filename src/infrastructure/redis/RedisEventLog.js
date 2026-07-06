import { connectRedis } from "./redisConnection.js";

const DEFAULT_MAX_EVENTS_PER_SYMBOL = 10_000;

function eventStreamKey(symbol) {
  return `stream:${symbol}:events`;
}

export class RedisEventLog {
  constructor({ maxEventsPerSymbol = DEFAULT_MAX_EVENTS_PER_SYMBOL } = {}) {
    this.maxEventsPerSymbol = maxEventsPerSymbol;
  }

  async appendEvents(symbol, events = []) {
    if (events.length === 0) {
      return;
    }

    const redis = await connectRedis();
    const key = eventStreamKey(symbol);

    const pipeline =redis.multi()
    for (const event of events) {
      await pipeline.xAdd(
        key,
        "*",
        {
          type: event.type,
          symbol: event.symbol ?? symbol,
          sequence: String(event.sequence ?? ""),
          payload: JSON.stringify(event),
        },
        {
          TRIM: {
            strategy: "MAXLEN",
            strategyModifier: "~",
            threshold: this.maxEventsPerSymbol,
          },
        },
      );
    }

    await pipeline.exec()
  }

  async getEvents(symbol, { start = "-", end = "+", count = 100 } = {}) {
    const redis = await connectRedis();
    const key = eventStreamKey(symbol);

    const entries = await redis.xRange(key, start, end, {
      COUNT: count,
    });

    return entries.map((entry) => ({
      id: entry.id,
      event: JSON.parse(entry.message.payload),
    }));
  }

  async getEventCount(symbol) {
    const redis = await connectRedis();

    return redis.xLen(eventStreamKey(symbol));
  }
}

export const redisEventLog = new RedisEventLog();