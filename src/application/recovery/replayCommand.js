import { redisCommandLog } from "../../infrastructure/redis/RedisCommandLog.js";
import { bookRegistry } from "../../api/services/BookRegistry.js";
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
    replayedCommandCount: commands.length,
  };
}

export async function replayAllSymbolsFromCommandLog({ reset = false } = {}) {
  if (reset) {
    bookRegistry.reset();
  }

  const symbols = await redisCommandLog.getSymbols();

  const results = [];

  for (const symbol of symbols) {
    const result = await replaySymbolFromCommandLog(symbol);
    results.push(result);
  }

  return results;
}
