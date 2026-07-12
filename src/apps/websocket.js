import http from "http";
import { Server } from "socket.io";
import {
  broadcastDomainEvents,
  initializeSocketServer,
} from "../api/websocket/socketServer.js";
import { subscribeToMarketEvents } from "../infrastructure/redis/RedisMarketEventPubSub.js";

const port = process.env.WEBSOCKET_PORT ?? 3001;

async function startWebSocketServer() {
  console.log("[websocket] starting");

  const httpServer = http.createServer();
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  initializeSocketServer(io);

  await subscribeToMarketEvents((symbol, events) => {
    broadcastDomainEvents(symbol, events);
  });
  console.log("[websocket] subscribed to redis market events");

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, resolve);
  });

  console.log(`[websocket] listening on port ${port}`);
}

startWebSocketServer().catch((error) => {
  console.error("[websocket] failed to start", error);
  process.exit(1);
});
