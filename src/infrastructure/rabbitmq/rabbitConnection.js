import amqp from "amqplib";
import { RabbitExchange, RabbitQueue } from "./rabbitConfig.js";

let connection = null;
let channel = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function connectRabbitMQ({ retries = 10, delayMs = 2000 } = {}) {
  if (channel) {
    return channel;
  }

  const rabbitUrl =
    process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672";

  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log("[rabbitmq] connecting", {
        attempt,
        retries,
      });

      connection = await amqp.connect(rabbitUrl);
      channel = await connection.createChannel();

      await channel.assertExchange(RabbitExchange.ORDER_COMMANDS_DLX, "direct", {
        durable: true,
      });

      await channel.assertQueue(RabbitQueue.ORDER_COMMANDS_DLQ, {
        durable: true,
      });

      await channel.bindQueue(
        RabbitQueue.ORDER_COMMANDS_DLQ,
        RabbitExchange.ORDER_COMMANDS_DLX,
        RabbitQueue.ORDER_COMMANDS_DLQ,
      );

      await channel.assertQueue(RabbitQueue.ORDER_COMMANDS, {
        durable: true,
        deadLetterExchange: RabbitExchange.ORDER_COMMANDS_DLX,
        deadLetterRoutingKey: RabbitQueue.ORDER_COMMANDS_DLQ,
      });

      console.log("RabbitMQ connected and queues asserted");

      return channel;
    } catch (error) {
      lastError = error;

      connection = null;
      channel = null;

      console.log("[rabbitmq] connection failed, retrying", {
        attempt,
        retries,
        message: error.message,
      });

      await sleep(delayMs);
    }
  }

  throw lastError;
}

export function getRabbitChannel() {
  if (!channel) {
    throw new Error("RabbitMQ channel is not initialized");
  }

  return channel;
}

export async function closeRabbitMQ() {
  if (channel) {
    await channel.close();
    channel = null;
  }

  if (connection) {
    await connection.close();
    connection = null;
  }
}