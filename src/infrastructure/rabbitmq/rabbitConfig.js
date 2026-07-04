export const RabbitQueue = Object.freeze({
  ORDER_COMMANDS: "order.commands.queue",
  ORDER_COMMANDS_DLQ: "order.commands.dlq",
});

export const RabbitExchange = Object.freeze({
  ORDER_COMMANDS_DLX: "order.commands.dlx",
});
