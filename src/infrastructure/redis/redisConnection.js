import { createClient } from "redis";

let redisClient = null;

export async function connectRedis() {
  if (redisClient?.isOpen) {
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

  redisClient = createClient({
    url: redisUrl,
  });

  redisClient.on("error", (error) => {
    console.error("Redis client error:", error);
  });

  await redisClient.connect();

  console.log("Redis connected");

  return redisClient;
}

export function getRedisClient() {
  if (!redisClient?.isOpen) {
    throw new Error("Redis client is not initialized");
  }

  return redisClient;
}

export async function closeRedis() {
  if (redisClient?.isOpen) {
    await redisClient.quit();
    redisClient = null;
  }
}
