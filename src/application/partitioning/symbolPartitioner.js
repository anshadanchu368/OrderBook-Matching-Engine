/**
 * Stable string hash function for deterministic symbol partitioning.
 * Based on djb2 algorithm - simple, fast, and deterministic across runs.
 */
function hashSymbol(symbol) {
  if (typeof symbol !== "string" || symbol.trim() === "") {
    throw new Error("symbol must be a non-empty string");
  }

  let hash = 5381;
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) + hash) ^ symbol.charCodeAt(i);
  }

  // Convert to positive integer
  return Math.abs(hash);
}

/**
 * Get the partition ID for a symbol.
 * Same symbol always returns same partition ID.
 */
export function getPartitionId(symbol, partitionCount) {
  if (typeof partitionCount !== "number" || partitionCount < 1 || !Number.isInteger(partitionCount)) {
    throw new Error("partitionCount must be a positive integer");
  }

  return hashSymbol(symbol) % partitionCount;
}

/**
 * Validate partition configuration.
 */
export function assertValidPartitionConfig({ partitionId, partitionCount }) {
  if (typeof partitionCount !== "number" || partitionCount < 1 || !Number.isInteger(partitionCount)) {
    throw new Error("partitionCount must be a positive integer");
  }

  if (typeof partitionId !== "number" || !Number.isInteger(partitionId) || partitionId < 0 || partitionId >= partitionCount) {
    throw new Error(`partitionId must be an integer >= 0 and < ${partitionCount}`);
  }
}

/**
 * Check if a symbol is assigned to a partition.
 */
export function isSymbolAssignedToPartition(symbol, partitionId, partitionCount) {
  return getPartitionId(symbol, partitionCount) === partitionId;
}

/**
 * Get the RabbitMQ queue name for a partition.
 */
export function getPartitionQueueName(partitionId) {
  return `order.commands.partition.${partitionId}`;
}

/**
 * Get the Redis leader lock key for a partition.
 */
export function getPartitionLeaderKey(partitionId) {
  return `matching:leader:partition:${partitionId}`;
}
