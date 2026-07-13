import { connectRedis } from "./redisConnection.js";

export const LEADER_KEY = "matching:leader";
export const LEADER_LOCK_TTL_MS = 5_000;
export const LEADER_RENEW_INTERVAL_MS = 2_000;

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

export async function tryAcquireLeadership(workerId) {
  const redis = await connectRedis();
  const result = await redis.set(LEADER_KEY, workerId, {
    NX: true,
    PX: LEADER_LOCK_TTL_MS,
  });

  return result === "OK";
}

export async function renewLeadership(workerId) {
  const redis = await connectRedis();
  const result = await redis.eval(RENEW_SCRIPT, {
    keys: [LEADER_KEY],
    arguments: [workerId, String(LEADER_LOCK_TTL_MS)],
  });

  return result === 1;
}

export async function releaseLeadership(workerId) {
  const redis = await connectRedis();
  const result = await redis.eval(RELEASE_SCRIPT, {
    keys: [LEADER_KEY],
    arguments: [workerId],
  });

  return result === 1;
}

export async function getCurrentLeader() {
  const redis = await connectRedis();
  return redis.get(LEADER_KEY);
}

export async function hasLeadership(workerId) {
  return (await getCurrentLeader()) === workerId;
}

export function startLeadershipHeartbeat(workerId, onLeadershipLost) {
  let stopped = false;
  let renewalInProgress = false;

  const timer = setInterval(async () => {
    if (stopped || renewalInProgress) {
      return;
    }

    renewalInProgress = true;

    try {
      const renewed = await renewLeadership(workerId);

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
