import {
  assertPositiveNumber,
  assertPositiveInteger,
} from "./utils/assertions.js";

export class PriceLevel {
  constructor(price) {
    assertPositiveNumber("price", price);

    this.price = price;

    this.head = null;

    this.tail = null;

    this.totalQuantity = 0;

    this.orderCount = 0;
  }

  append(orderNode) {
    this.assertAppendable(orderNode);

    orderNode.priceLevel = this;

    if (this.isEmpty()) {
      this.head = orderNode;
      this.tail = orderNode;
    } else {
      this.tail.next = orderNode;
      orderNode.prev = this.tail;
      this.tail = orderNode;
    }

    this.totalQuantity += orderNode.remainingQuantity;
    this.orderCount += 1;
  }

  peek() {
    return this.head;
  }

  remove(orderNode) {
    this.assertBelongsToLevel(orderNode);

    const previousNode = orderNode.prev;
    const nextNode = orderNode.next;

    if (previousNode) {
      previousNode.next = nextNode;
    } else {
      this.head = nextNode;
    }

    if (nextNode) {
      nextNode.prev = previousNode;
    } else {
      this.tail = previousNode;
    }

    this.totalQuantity -= orderNode.remainingQuantity;
    this.orderCount -= 1;

    orderNode.detachLinks();
  }

  decreaseTotalQuantity(quantity) {
    assertPositiveInteger("quantity", quantity);

    if (quantity > this.totalQuantity) {
      throw new Error("cannot decrease more than total price level quantity");
    }

    this.totalQuantity -= quantity;
  }

  isEmpty() {
    return this.orderCount === 0;
  }

  snapshot() {
    return {
      price: this.price,
      totalQuantity: this.totalQuantity,
      orderCount: this.orderCount,
      headOrderId: this.head?.orderId ?? null,
      tailOrderId: this.tail?.orderId ?? null,
    };
  }

  toArray() {
    const orders = [];
    let currentNode = this.head;

    while (currentNode) {
      orders.push(currentNode.snapshot());
      currentNode = currentNode.next;
    }

    return orders;
  }

  assertAppendable(orderNode) {
    if (!orderNode) {
      throw new Error("orderNode is required");
    }

    if (orderNode.price !== this.price) {
      throw new Error("order price does not match price level");
    }

    if (orderNode.priceLevel !== null) {
      throw new Error("order already belongs to a price level");
    }
  }

  assertBelongsToLevel(orderNode) {
    if (!orderNode) {
      throw new Error("orderNode is required");
    }

    if (orderNode.priceLevel !== this) {
      throw new Error("order does not belong to this price level");
    }
  }
}
