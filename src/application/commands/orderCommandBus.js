import { RabbitOrderCommandBus } from "../../infrastructure/rabbitmq/RabbitOrderCommandBus.js";

export const orderCommandBus = new RabbitOrderCommandBus();
