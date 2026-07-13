import { connectRedis } from "./redisConnection.js";

export const LEADER_KEY = "matching:leader";
export const LEADER_LOCK_TTL_MS = 5_000;
export const LEADER_RENEW_INTERVAL_MS = 2_000;

/**
 * Get partition-specific leader key.
 * If partitionId is not provided, returns global leader key for backward compatibility.
 */
function getLeaderKey(partitionId) {
  if (typeof partitionId === "number") {
    return `matching:leader:partition:${partitionId}`;
  }
  return LEADER_KEY;
}

const RENEW_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
  end
  return 0
`;

const RELEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

export async function tryAcquireLeadership(workerId, partitionId) {
  const redis = await connectRedis();
  const leaderKey = getLeaderKey(partitionId);
  const result = await redis.set(leaderKey, workerId, {
    NX: true,
    PX: LEADER_LOCK_TTL_MS,
  });

  return result === "OK";
}

export async function renewLeadership(workerId, partitionId) {
  const redis = await connectRedis();
  const leaderKey = getLeaderKey(partitionId);
  const result = await redis.eval(RENEW_SCRIPT, {
    keys: [leaderKey],
    arguments: [workerId, String(LEADER_LOCK_TTL_MS)],
  });

  return result === 1;
}

export async function releaseLeadership(workerId, partitionId) {
  const redis = await connectRedis();
  const leaderKey = getLeaderKey(partitionId);
  const result = await redis.eval(RELEASE_SCRIPT, {
    keys: [leaderKey],
    arguments: [workerId],
  });

  return result === 1;
}

export async function getCurrentLeader(partitionId) {
  const redis = await connectRedis();
  const leaderKey = getLeaderKey(partitionId);
  return redis.get(leaderKey);
}

export async function hasLeadership(workerId, partitionId) {
  return (await getCurrentLeader(partitionId)) === workerId;
}

export function startLeadershipHeartbeat(workerId, onLeadershipLost, partitionId) {
  let stopped = false;
  let renewalInProgress = false;

  const timer = setInterval(async () => {
    if (stopped || renewalInProgress) {
      return;
    }

    renewalInProgress = true;

    try {
      const renewed = await renewLeadership(workerId, partitionId);

      if (!renewed) {
        console.error("[leader] renewal failed");
        stopped = true;
        clearInterval(timer);
        await onLeadershipLost();
      } else {
        console.log("[leader] renewal successful");
      }
    } catch (error) {
      console.error("[leader] renewal failed", { message: error.message });
      // A transient Redis error does not prove ownership was lost. The next
      // renewal will retry; message processing independently checks ownership.
    } finally {
      renewalInProgress = false;
    }
  }, LEADER_RENEW_INTERVAL_MS);

  timer.unref?.();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
