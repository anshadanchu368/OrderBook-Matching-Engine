import { Side } from "./engine/constants.js";
import { OrderNode } from "./engine/OrderNode.js";
import { PriceLevel } from "./engine/PriceLevel.js";

const priceLevel = new PriceLevel(100.5);

const order1 = new OrderNode({
  orderId: "B1",
  userId: "U1",
  symbol: "BTC-INR",
  side: Side.BUY,
  price: 100.5,
  quantity: 10,
  timestamp: 1,
});

const order2 = new OrderNode({
  orderId: "B2",
  userId: "U2",
  symbol: "BTC-INR",
  side: Side.BUY,
  price: 100.5,
  quantity: 5,
  timestamp: 2,
});

priceLevel.append(order1);
priceLevel.append(order2);

console.log("Price level snapshot:");
console.table(priceLevel.snapshot());

console.log("Orders in FIFO order:");
console.table(priceLevel.toArray());

const nextOrder = priceLevel.peek();

console.log("Next order to match:");
console.table(nextOrder.snapshot());