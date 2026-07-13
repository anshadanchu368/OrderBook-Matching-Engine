import { MatchingNode } from "../application/replication/MatchingNode.js";

const node = new MatchingNode();

async function shutdown(signal) {
  console.log("[matching-node] shutting down", { signal });
  await node.stop();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

node.start().catch((error) => {
  console.error("[matching-node] failed to start", error);
  process.exit(1);
});
