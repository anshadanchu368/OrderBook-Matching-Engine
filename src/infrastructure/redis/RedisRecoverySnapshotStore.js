import { connectRedis } from "./redisConnection.js";

function recoverySnapshotKey(symbol) {
  return `recovery:${symbol}:snapshot`;
}

export class RedisRecoverySnapshotStore {
  async saveSnapshot(symbol, snapshot) {
    const redis = await connectRedis();

    await redis.set(recoverySnapshotKey(symbol), JSON.stringify(snapshot));
  }

  async getSnapshot(symbol) {
    const redis = await connectRedis();

    const rawSnapshot = await redis.get(recoverySnapshotKey(symbol));

    if (!rawSnapshot) {
      return null;
    }

    return JSON.parse(rawSnapshot);
  }
}

export const redisRecoverySnapshotStore = new RedisRecoverySnapshotStore();
