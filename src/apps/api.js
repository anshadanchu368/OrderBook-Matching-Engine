import { startApiServer } from "../api/server.js";

console.log("[api] starting");

startApiServer().catch((error) => {
  console.error("[api] failed to start", error);
  process.exit(1);
});
