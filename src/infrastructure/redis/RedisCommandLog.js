import { connectRedis } from "./redisConnection.js";

const DEFAULT_MAX_COMMANDS_PER_SYMBOL = 100_000;
const COMMAND_LOG_SYMBOLS_KEY = "commands:symbols";


function commandStreamKey(symbol) {
  return `stream:${symbol}:commands`;
}

function processedCommandIdsKey(symbol) {
  return `commands:${symbol}:processed-ids`;
}

export class RedisCommandLog {
  constructor({ maxCommandsPerSymbol = DEFAULT_MAX_COMMANDS_PER_SYMBOL } = {}) {
    this.maxCommandsPerSymbol = maxCommandsPerSymbol;
  }

  async appendProcessedCommand(command) {
    const redis = await connectRedis();

    const processedAt = Date.now();
    const streamKey = commandStreamKey(command.symbol);
    const idsKey = processedCommandIdsKey(command.symbol);

    const pipeline = redis.multi();

    pipeline.xAdd(
      streamKey,
      "*",
      {
        commandId: command.commandId,
        symbol: command.symbol,
        type: command.type,
        payload: JSON.stringify(command.payload ?? {}),
        createdAt: String(command.createdAt ?? ""),
        processedAt: String(processedAt),
        command: JSON.stringify({
          ...command,
          processedAt,
        }),
      },
      {
        TRIM: {
          strategy: "MAXLEN",
          strategyModifier: "~",
          threshold: this.maxCommandsPerSymbol,
        },
      },
    );

    pipeline.sAdd(idsKey, command.commandId);
    pipeline.sAdd(COMMAND_LOG_SYMBOLS_KEY, command.symbol);

   const results = await pipeline.exec();
   return results[0]
  }
  
  async getSymbols() {
  const redis = await connectRedis();

  return redis.sMembers(COMMAND_LOG_SYMBOLS_KEY);
}

  async isCommandProcessed(symbol, commandId) {
    const redis = await connectRedis();

    return redis.sIsMember(processedCommandIdsKey(symbol), commandId);
  }

  async getProcessedCommands(symbol, { start = "-", end = "+", count = 100 } = {}) {
    const redis = await connectRedis();

    const entries = await redis.xRange(commandStreamKey(symbol), start, end, {
      COUNT: count,
    });

    return entries.map((entry) => ({
      id: entry.id,
      command: JSON.parse(entry.message.command),
    }));
  }

  async getCommandCount(symbol) {
    const redis = await connectRedis();

    return redis.xLen(commandStreamKey(symbol));
  }
}

export const redisCommandLog = new RedisCommandLog();