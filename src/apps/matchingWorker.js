import { connectRedis } from "../infrastructure/redis/redisConnection.js";
import { connectRabbitMQ } from "../infrastructure/rabbitmq/rabbitConnection.js";
import { replayAllSymbolsFromCommandLog } from "../application/recovery/replayCommand.js";
import { startOrderCommandWorker } from "../workers/orderCommanderWorker.js";

async function startMatchingWorker() {
  console.log("[matching-worker] starting");

  await connectRedis();
  console.log("[matching-worker] redis connected");

  await connectRabbitMQ();
  console.log("[matching-worker] rabbitmq connected");

  const recoveryResult = await replayAllSymbolsFromCommandLog({ reset: true });
  console.log("[matching-worker] recovery completed", recoveryResult);

  await startOrderCommandWorker();
  console.log("[matching-worker] consuming order commands");
}

startMatchingWorker().catch((error) => {
  console.error("[matching-worker] failed to start", error);
  process.exit(1);
});
