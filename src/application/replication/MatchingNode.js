import { randomUUID } from "node:crypto";
import os from "node:os";
import { connectRedis } from "../../infrastructure/redis/redisConnection.js";
import { connectRabbitMQ } from "../../infrastructure/rabbitmq/rabbitConnection.js";
import {
  getCurrentLeader,
  hasLeadership,
  releaseLeadership,
  startLeadershipHeartbeat,
  tryAcquireLeadership,
} from "../../infrastructure/redis/RedisLeaderElection.js";
import { startOrderCommandWorker } from "../../workers/orderCommanderWorker.js";
import { StandbyReplica } from "./StandbyReplica.js";

export class MatchingNode {
  constructor({ workerId = `${os.hostname()}:${randomUUID()}` } = {}) {
    this.workerId = workerId;
    this.replica = new StandbyReplica();
    this.consumerHandle = null;
    this.heartbeatHandle = null;
    this.active = false;
    this.transitioning = false;
    this.leadershipLostDuringTransition = false;
    this.stopping = false;
  }

  async start() {
    console.log("[matching-node] starting", { workerId: this.workerId });

    await connectRedis();
    console.log("[matching-node] redis connected");

    const recoveryResults = await this.replica.initialize();
    console.log("[matching-node] recovery completed", recoveryResults);

    const promoted = await this.attemptPromotion();
    if (!promoted) {
      this.startStandbyMode();
    }
  }

  startStandbyMode() {
    if (this.stopping || this.active) {
      return;
    }

    this.replica.start(() => {
      void this.checkForPromotion();
    });
  }

  async checkForPromotion() {
    if (this.active || this.transitioning || this.stopping) {
      return;
    }

    const currentLeader = await getCurrentLeader();
    if (currentLeader) {
      return;
    }

    console.log("[failover] attempting promotion");
    await this.attemptPromotion();
  }

  async attemptPromotion() {
    if (this.active || this.transitioning || this.stopping) {
      return false;
    }

    this.transitioning = true;
    this.leadershipLostDuringTransition = false;
    console.log("[leader] attempting acquisition", { workerId: this.workerId });

    try {
      const acquired = await tryAcquireLeadership(this.workerId);
      if (!acquired) {
        console.log("[failover] promotion failed", {
          leader: await getCurrentLeader(),
        });
        return false;
      }

      console.log("[leader] acquired", { workerId: this.workerId });
      console.log("[failover] leadership acquired");

      await this.replica.stop();

      // Renewal starts immediately so a long catch-up cannot let the lock expire.
      this.heartbeatHandle = startLeadershipHeartbeat(this.workerId, () =>
        this.handleLeadershipLost(),
      );

      const replayedCommandCount = await this.replica.catchUp();
      console.log("[standby] caught up", { replayedCommandCount });

      if (!(await hasLeadership(this.workerId))) {
        throw new Error("leadership lost during promotion catch-up");
      }

      await connectRabbitMQ();
      this.consumerHandle = await startOrderCommandWorker({
        hasLeadership: () => hasLeadership(this.workerId),
        onLeadershipLost: () => this.handleLeadershipLost(),
      });

      if (
        this.leadershipLostDuringTransition ||
        !(await hasLeadership(this.workerId))
      ) {
        await this.consumerHandle.stop();
        this.consumerHandle = null;
        throw new Error("leadership lost while starting consumer");
      }

      this.active = true;
      console.log("[failover] promoted to active", { workerId: this.workerId });
      return true;
    } catch (error) {
      console.error("[failover] promotion failed", { message: error.message });
      this.heartbeatHandle?.stop();
      this.heartbeatHandle = null;

      try {
        await releaseLeadership(this.workerId);
      } catch (releaseError) {
        console.error("[leader] failed to release leadership", {
          message: releaseError.message,
        });
      }

      return false;
    } finally {
      this.transitioning = false;

      if (!this.active && !this.stopping) {
        this.startStandbyMode();
      }
    }
  }

  async handleLeadershipLost() {
    if (this.transitioning) {
      this.leadershipLostDuringTransition = true;
      return;
    }

    if (this.stopping) {
      return;
    }

    this.transitioning = true;
    this.active = false;
    console.error("[leader] lost leadership");

    try {
      this.heartbeatHandle?.stop();
      this.heartbeatHandle = null;

      await this.consumerHandle?.stop();
      this.consumerHandle = null;
      console.log("[leader] lost leadership, stopped consumer");

      // Rebuild from the durable source before resuming replica mode in case
      // leadership was lost while a command was in flight.
      await this.replica.initialize();
    } finally {
      this.transitioning = false;
      this.startStandbyMode();
    }
  }

  async stop() {
    this.stopping = true;
    this.heartbeatHandle?.stop();
    await this.consumerHandle?.stop();
    await this.replica.stop();

    try {
      await releaseLeadership(this.workerId);
    } catch (error) {
      console.error("[leader] failed to release leadership", {
        message: error.message,
      });
    }
  }
}
