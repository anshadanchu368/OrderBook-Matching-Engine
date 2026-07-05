import { connectRedis } from "./redisConnection.js";

function bookSnapshotKey(symbol) {
  return `book:${symbol}:snapshot`;
}

function tradeHistoryKey(symbol) {
  return `book:${symbol}:trades`;
}

export class RedisBookReadModel {
  async saveSnapshot(symbol, snapshot) {
    const redis = await connectRedis();

    await redis.set(
      bookSnapshotKey(symbol),
      JSON.stringify(snapshot),
    );
  }

  async getSnapshot(symbol) {
    const redis = await connectRedis();

    const rawSnapshot = await redis.get(bookSnapshotKey(symbol));

    if (!rawSnapshot) {
      return null;
    }

    return JSON.parse(rawSnapshot);
  }

  async saveTrades(symbol, trades) {
    const redis = await connectRedis();

    await redis.set(
      tradeHistoryKey(symbol),
      JSON.stringify(trades),
    );
  }

  async getTrades(symbol) {
    const redis = await connectRedis();

    const rawTrades = await redis.get(tradeHistoryKey(symbol));

    if (!rawTrades) {
      return [];
    }

    return JSON.parse(rawTrades);
  }
}

export const redisBookReadModel = new RedisBookReadModel();
