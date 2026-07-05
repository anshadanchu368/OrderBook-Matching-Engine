import { connectRedis } from "./redisConnection.js";

const DEFAULT_COMMAND_STATUS_TTL_SECONDS = 10 * 60;

function commandStatusKey(commandId) {
  return `command:${commandId}:status`;
}

export class RedisCommandStatusStore {
  constructor({ ttlSeconds = DEFAULT_COMMAND_STATUS_TTL_SECONDS } = {}) {
    this.ttlSeconds = ttlSeconds;
  }

  async saveStatus(commandStatus) {
    const redis = await connectRedis();

    await redis.set(
      commandStatusKey(commandStatus.commandId),
      JSON.stringify(commandStatus),
      {
        EX: this.ttlSeconds,
      },
    );
  }

  async getStatus(commandId) {
    const redis = await connectRedis();

    const rawStatus = await redis.get(commandStatusKey(commandId));

    if (!rawStatus) {
      return null;
    }

    return JSON.parse(rawStatus);
  }
}

export const redisCommandStatusStore = new RedisCommandStatusStore();