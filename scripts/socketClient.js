import { io } from "socket.io-client";

console.log("Socket client starting...");

const socket = io("http://lob-engine-dev:3000", {
  transports: ["websocket"],
});

socket.on("connect", () => {
  console.log("Connected:", socket.id);

  socket.emit("subscribe:book", {
    symbol: "BTC-INR",
  });
});

socket.on("subscribed:book", (message) => {
  console.log("Subscribed:");
  console.log(JSON.stringify(message, null, 2));
});

socket.on("book:update", (message) => {
  console.log("BOOK UPDATE:");
  console.log(JSON.stringify(message, null, 2));
});

socket.on("trade:created", (message) => {
  console.log("TRADE CREATED:");
  console.log(JSON.stringify(message, null, 2));
});

socket.on("connect_error", (error) => {
  console.log("Connection error:", error.message);
});

socket.on("disconnect", (reason) => {
  console.log("Disconnected:", reason);
});