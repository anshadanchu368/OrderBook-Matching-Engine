import { connectRabbitMQ } from "./rabbitConnection.js";
import { RabbitQueue, getOrderCommandQueueName } from "./rabbitConfig.js";

export class RabbitOrderCommandBus {
  /**
   * Publish a command to RabbitMQ.
   * If partitionId is provided, routes to partition-specific queue.
   * Otherwise uses legacy single queue.
   */
  async publish(command, partitionId) {
    const channel = await connectRabbitMQ();

    // Determine target queue
    const targetQueue = typeof partitionId === "number"
      ? getOrderCommandQueueName(partitionId)
      : getOrderCommandQueueName(0);

    const messageBuffer = Buffer.from(JSON.stringify(command));

    const wasQueued = channel.sendToQueue(
      targetQueue,
      messageBuffer,
      {
        persistent: true,
        contentType: "application/json",
      },
    );

    if (!wasQueued) {
      throw new Error("RabbitMQ write buffer is full");
    }

    return command;
  }
}