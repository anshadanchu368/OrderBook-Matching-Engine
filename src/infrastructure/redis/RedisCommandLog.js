import { connectRedis } from "./redisConnection.js";

const DEFAULT_MAX_COMMANDS_PER_SYMBOL = 100_000;
const COMMAND_LOG_SYMBOLS_KEY = "commands:symbols";


function commandLogStreamKey(symbol) {
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
    const streamKey = commandLogStreamKey(command.symbol);
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

    const entries = await redis.xRange(commandLogStreamKey(symbol), start, end, {
      COUNT: count,
    });

    return entries.map((entry) => ({
      id: entry.id,
      command: JSON.parse(entry.message.command),
    }));
  }

  async getProcessedCommandsAfter(symbol, streamId, { count = 100_000 } = {}) {
  const redis = await connectRedis();

  const streamKey = commandLogStreamKey(symbol);

  const entries = await redis.xRange(streamKey, `(${streamId}`, "+", {
    COUNT: count,
  });

  return entries.map((entry) => ({
    id: entry.id,
    command: JSON.parse(entry.message.command),
  }));
}

  async readNextProcessedCommands(
    symbol,
    lastStreamId,
    { blockMs = 5_000, count = 100 } = {},
  ) {
    const redis = await connectRedis();
    const options = { COUNT: count };

    if (blockMs > 0) {
      options.BLOCK = blockMs;
    }

    const streams = await redis.xRead(
      [{ key: commandLogStreamKey(symbol), id: lastStreamId }],
      options,
    );

    if (!streams) {
      return [];
    }

    return streams.flatMap((stream) =>
      stream.messages.map((entry) => ({
        id: entry.id,
        command: JSON.parse(entry.message.command),
      })),
    );
  }

  async getLatestCommandStreamId(symbol) {
    const redis = await connectRedis();
    const entries = await redis.xRevRange(commandLogStreamKey(symbol), "+", "-", {
      COUNT: 1,
    });

    return entries[0]?.id ?? "0-0";
  }

  async getCommandCount(symbol) {
    const redis = await connectRedis();

    return redis.xLen(commandLogStreamKey(symbol));
  }
}

export const redisCommandLog = new RedisCommandLog();
