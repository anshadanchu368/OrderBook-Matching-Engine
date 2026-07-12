import http from "http";
import { Server } from "socket.io";
import { initializeSocketServer } from "../api/websocket/socketServer.js";

const port = process.env.WEBSOCKET_PORT ?? 3001;

console.log("[websocket] starting");

const httpServer = http.createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

initializeSocketServer(io);

// TODO: Subscribe to a Redis Pub/Sub market-event channel so events produced by
// the matching-worker process can be forwarded to connected socket clients.
httpServer.listen(port, () => {
  console.log(`[websocket] listening on port ${port}`);
});

httpServer.once("error", (error) => {
  console.error("[websocket] failed to start", error);
  process.exit(1);
});
