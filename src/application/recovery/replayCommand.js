import { redisCommandLog } from "../../infrastructure/redis/RedisCommandLog.js";
import { redisRecoverySnapshotStore } from "../../infrastructure/redis/RedisRecoverySnapshotStore.js";
import { bookRegistry } from "../../api/services/BookRegistry.js";
import { OrderBook } from "../../engine/OrderBook.js";
import { executeOrderCommand } from "../commands/executeOrderCommand.js";

async function replaySymbolFromCommandLog(symbol) {
  const commands = await redisCommandLog.getProcessedCommands(symbol, {
    start: "-",
    end: "+",
    count: 100_000,
  });

  for (const entry of commands) {
    executeOrderCommand(entry.command);
  }

  return {
    symbol,
    mode: "full-replay",
    replayedCommandCount: commands.length,
  };
}

async function recoverSymbolFromSnapshotThenReplay(symbol) {
  const snapshot = await redisRecoverySnapshotStore.getSnapshot(symbol);

  if (!snapshot || !snapshot.lastCommandStreamId) {
    return replaySymbolFromCommandLog(symbol);
  }

  const restoredBook = OrderBook.fromRecoverySnapshot(snapshot);

  bookRegistry.setBook(symbol, restoredBook);

  const commandsAfterSnapshot = await redisCommandLog.getProcessedCommandsAfter(
    symbol,
    snapshot.lastCommandStreamId,
    {
      count: 100_000,
    },
  );

  for (const entry of commandsAfterSnapshot) {
    executeOrderCommand(entry.command);
  }

  return {
    symbol,
    mode: "snapshot-plus-incremental-replay",
    checkpointStreamId: snapshot.lastCommandStreamId,
    replayedCommandCount: commandsAfterSnapshot.length,
  };
}

export async function replayAllSymbolsFromCommandLog({ reset = false } = {}) {
  if (reset) {
    bookRegistry.reset();
  }

  const symbols = await redisCommandLog.getSymbols();

  const results = [];

  for (const symbol of symbols) {
    const result = await recoverSymbolFromSnapshotThenReplay(symbol);
    results.push(result);
  }

  return results;
}