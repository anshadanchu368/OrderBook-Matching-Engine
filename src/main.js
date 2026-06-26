import { Side } from "./engine/Constants.js";
import { OrderBook } from "./engine/OrderBook.js";

const book = new OrderBook("BTC-INR");

console.log("\n--- Test 1: Cancel only order at price level ---");

book.placeLimitOrder({
  orderId: "B1",
  userId: "U1",
  side: Side.BUY,
  price: 100,
  quantity: 10,
  timestamp: 1,
});

console.log("Before cancel B1:");
console.log(JSON.stringify(book.snapshot(), null, 2));

const cancelledB1 = book.cancelOrder("B1");

console.log("Cancelled B1 snapshot:");
console.log(JSON.stringify(cancelledB1, null, 2));

console.log("After cancel B1:");
console.log(JSON.stringify(book.snapshot(), null, 2));

console.log("\n--- Test 2: Cancel one order, same price level still remains ---");

book.placeLimitOrder({
  orderId: "B2",
  userId: "U2",
  side: Side.BUY,
  price: 100,
  quantity: 10,
  timestamp: 2,
});

book.placeLimitOrder({
  orderId: "B3",
  userId: "U3",
  side: Side.BUY,
  price: 100,
  quantity: 5,
  timestamp: 3,
});

console.log("Before cancel B2:");
console.log(JSON.stringify(book.snapshot(), null, 2));

const cancelledB2 = book.cancelOrder("B2");

console.log("Cancelled B2 snapshot:");
console.log(JSON.stringify(cancelledB2, null, 2));

console.log("After cancel B2:");
console.log(JSON.stringify(book.snapshot(), null, 2));

console.log("\n--- Test 3: Cancel partially filled resting order ---");

book.placeLimitOrder({
  orderId: "S1",
  userId: "U4",
  side: Side.SELL,
  price: 101,
  quantity: 10,
  timestamp: 4,
});

book.placeLimitOrder({
  orderId: "B4",
  userId: "U5",
  side: Side.BUY,
  price: 101,
  quantity: 4,
  timestamp: 5,
});

console.log("After partial match:");
console.log(JSON.stringify(book.snapshot(), null, 2));

const cancelledS1 = book.cancelOrder("S1");

console.log("Cancelled S1 snapshot:");
console.log(JSON.stringify(cancelledS1, null, 2));

console.log("After cancel S1:");
console.log(JSON.stringify(book.snapshot(), null, 2));