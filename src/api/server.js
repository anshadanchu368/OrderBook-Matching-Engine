import http from "http";
import {Server} from "socket.io"
import { createApp } from "./app.js";
import { initializeSocketServer } from "./websocket/socketServer.js";
import { startOrderCommandWorker } from "../workers/orderCommanderWorker.js";


const PORT = process.env.PORT ?? 3000;

const app = createApp();

const httpServer = http.createServer(app)

const io =new Server(httpServer,{
  cors:{
    origin:"*"
  }
})

initializeSocketServer(io);

httpServer.listen(PORT, async () => {
  console.log(`LOB API server running on port ${PORT}`);

  try {
    await startOrderCommandWorker();
  } catch (error) {
    console.error("Failed to start order command worker:", error);
    process.exit(1);
  }
});
