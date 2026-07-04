import { connectRabbitMQ } from "./rabbitConnection.js";
import { RabbitQueue } from "./rabbitConfig.js";

export class RabbitOrderCommandBus {
  async publish(command) {
    const channel = await connectRabbitMQ();

    const messageBuffer = Buffer.from(JSON.stringify(command));

    const wasQueued = channel.sendToQueue(
      RabbitQueue.ORDER_COMMANDS,
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