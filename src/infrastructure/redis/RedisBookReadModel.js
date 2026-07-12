import { connectRedis } from "./redisConnection.js";

const DEFAULT_RECENT_TRADES_LIMIT = 1000;
const BOOK_SYMBOLS_KEY = "books:symbols";

function bookSnapshotKey(symbol) {
  return `book:${symbol}:snapshot`;
}

function recentTradesKey(symbol) {
  return `book:${symbol}:recent-trades`;
}

export class RedisBookReadModel {
  constructor({ recentTradesLimit = DEFAULT_RECENT_TRADES_LIMIT } = {}) {
    this.recentTradesLimit = recentTradesLimit;
  }

  async saveSnapshot(symbol, snapshot) {
    const redis = await connectRedis();

    await Promise.all([
      redis.set(bookSnapshotKey(symbol), JSON.stringify(snapshot)),
      redis.sAdd(BOOK_SYMBOLS_KEY, symbol),
    ]);
  }

  async getSymbols() {
    const redis = await connectRedis();

    return (await redis.sMembers(BOOK_SYMBOLS_KEY)).sort();
  }

  async getSnapshot(symbol) {
    const redis = await connectRedis();

    const rawSnapshot = await redis.get(bookSnapshotKey(symbol));

    if (!rawSnapshot) {
      return null;
    }

    return JSON.parse(rawSnapshot);
  }

  async appendTrades(symbol, trades = []) {
    if (trades.length === 0) {
      return;
    }

    const redis = await connectRedis();
    const key = recentTradesKey(symbol);

    const serializedTrades = trades.map((trade) => JSON.stringify(trade));

    await redis.lPush(key, serializedTrades);
    await redis.lTrim(key, 0, this.recentTradesLimit - 1);
  }

  async getTrades(symbol, limit = 100) {
    const redis = await connectRedis();

    const rawTrades = await redis.lRange(
      recentTradesKey(symbol),
      0,
      limit - 1,
    );

    return rawTrades.map((rawTrade) => JSON.parse(rawTrade));
  }
}

export const redisBookReadModel = new RedisBookReadModel();
