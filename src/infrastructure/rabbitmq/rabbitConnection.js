import amqp from "amqplib";
import { RabbitExchange, RabbitQueue } from "./rabbitConfig.js";

let connection = null;
let channel = null;

export async function connectRabbitMQ() {
  if (channel) {
    return channel;
  }

  const rabbitUrl =
    process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672";

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