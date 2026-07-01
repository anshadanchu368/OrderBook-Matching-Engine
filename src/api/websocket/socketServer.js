let ioInstance = null;

export function initializeSocketServer(io) {
  ioInstance = io;

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on("subscribe:book", ({ symbol } = {}) => {
      if (typeof symbol !== "string" || symbol.trim() === "") {
        socket.emit("socket:error", {
          message: "symbol must be a non-empty string",
        });
        return;
      }

      const room = `book:${symbol}`;

      socket.join(room);

      socket.emit("subscribed:book", {
        symbol,
        room,
      });

      console.log(`Socket ${socket.id} subscribed to ${room}`);
    });

    socket.on("unsubscribe:book", ({ symbol } = {}) => {
      if (typeof symbol !== "string" || symbol.trim() === "") {
        socket.emit("socket:error", {
          message: "symbol must be a non-empty string",
        });
        return;
      }

      const room = `book:${symbol}`;

      socket.leave(room);

      socket.emit("unsubscribed:book", {
        symbol,
        room,
      });

      console.log(`Socket ${socket.id} unsubscribed from ${room}`);
    });

    socket.on("disconnect", (reason) => {
      console.log(`Socket disconnected: ${socket.id}, reason: ${reason}`);
    });
  });
}

export function broadcastBookUpdate(symbol, snapshot) {
  if (!ioInstance) {
    return;
  }

  ioInstance.to(`book:${symbol}`).emit("book:update", {
    type: "BOOK_UPDATED",
    symbol,
    data: snapshot,
    timestamp: Date.now(),
  });
}

export function broadcastTrades(symbol, trades) {
  if (!ioInstance || trades.length === 0) {
    return;
  }

  for (const trade of trades) {
    ioInstance.to(`book:${symbol}`).emit("trade:created", {
      type: "TRADE_CREATED",
      symbol,
      data: trade,
      timestamp: Date.now(),
    });
  }
}

export function broadcastDomainEvents(symbol, events = []) {
  if (!ioInstance || events.length === 0) {
    return;
  }

  for (const event of events) {
    ioInstance.to(`book:${symbol}`).emit("domain:event", event);
  }
}