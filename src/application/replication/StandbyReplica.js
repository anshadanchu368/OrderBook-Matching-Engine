import { redisCommandLog } from "../../infrastructure/redis/RedisCommandLog.js";
import {
  recoverSymbolFromCommandLog,
  replayAllSymbolsFromCommandLog,
} from "../recovery/replayCommand.js";
import { executeOrderCommand } from "../commands/executeOrderCommand.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class StandbyReplica {
  constructor({ pollIntervalMs = 500 } = {}) {
    this.pollIntervalMs = pollIntervalMs;
    this.lastReplayedStreamIds = new Map();
    this.running = false;
    this.loopPromise = null;
  }

  async initialize() {
    const recoveryResults = await replayAllSymbolsFromCommandLog({ reset: true });
    this.lastReplayedStreamIds.clear();

    for (const result of recoveryResults) {
      this.lastReplayedStreamIds.set(
        result.symbol,
        result.lastCommandStreamId,
      );
    }

    return recoveryResults;
  }

  async discoverSymbols() {
    const symbols = await redisCommandLog.getSymbols();
    const discovered = [];

    for (const symbol of symbols) {
      if (this.lastReplayedStreamIds.has(symbol)) {
        continue;
      }

      const result = await recoverSymbolFromCommandLog(symbol);
      this.lastReplayedStreamIds.set(symbol, result.lastCommandStreamId);
      discovered.push(symbol);
    }

    if (discovered.length > 0) {
      console.log("[standby] discovered symbols", discovered);
    }
  }

  async replayAvailableCommands(symbol) {
    let replayed = 0;

    while (true) {
      const lastStreamId = this.lastReplayedStreamIds.get(symbol) ?? "0-0";
      const entries = await redisCommandLog.readNextProcessedCommands(
        symbol,
        lastStreamId,
        { blockMs: 0, count: 100 },
      );

      if (entries.length === 0) {
        return replayed;
      }

      for (const entry of entries) {
        executeOrderCommand(entry.command);
        this.lastReplayedStreamIds.set(symbol, entry.id);
        replayed += 1;
      }
    }
  }

  async catchUp() {
    await this.discoverSymbols();

    let replayed = 0;
    for (const symbol of this.lastReplayedStreamIds.keys()) {
      replayed += await this.replayAvailableCommands(symbol);
    }

    return replayed;
  }

  start(onPromotionCheck) {
    if (this.running) {
      return;
    }

    this.running = true;
    console.log("[standby] starting replica mode");

    this.loopPromise = (async () => {
      while (this.running) {
        try {
          const replayed = await this.catchUp();
          if (replayed > 0) {
            console.log("[standby] replayed commands; caught up", {
              replayedCommandCount: replayed,
            });
          }

          await onPromotionCheck();
        } catch (error) {
          console.error("[standby] replica iteration failed", {
            message: error.message,
          });
        }

        if (this.running) {
          await sleep(this.pollIntervalMs);
        }
      }
    })();
  }

  async stop() {
    this.running = false;
    await this.loopPromise;
    this.loopPromise = null;
  }
}
