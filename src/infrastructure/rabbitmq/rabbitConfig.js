export const RabbitQueue = Object.freeze({
  ORDER_COMMANDS: "order.commands.queue",
  ORDER_COMMANDS_DLQ: "order.commands.dlq",
});

export const RabbitExchange = Object.freeze({
  ORDER_COMMANDS_DLX: "order.commands.dlx",
});

/**
 * Get the queue name for a partition.
 */
export function getOrderCommandQueueName(partitionId) {
  return `order.commands.partition.${partitionId}`;
}
