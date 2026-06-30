import fs from "node:fs";
import path from "node:path";

const outputPath = path.resolve(process.cwd(), "API_DOCUMENTATION.md");

const baseUrl = "http://localhost:3000/api/v1";

const endpoints = [
  {
    title: "Health Check",
    method: "GET",
    url: "http://localhost:3000/health",
    description: "Checks whether the API server is running.",
    requestBody: null,
    successResponse: {
      success: true,
      data: {
        status: "ok",
      },
    },
  },
  {
    title: "List Symbols",
    method: "GET",
    url: `${baseUrl}/symbols`,
    description: "Returns all symbols currently available in the book registry.",
    requestBody: null,
    successResponse: {
      success: true,
      data: {
        symbols: ["BTC-INR", "ETH-INR"],
      },
    },
  },
  {
    title: "Get Order Book Snapshot",
    method: "GET",
    url: `${baseUrl}/books/BTC-INR`,
    description: "Returns the current order book snapshot for a symbol.",
    requestBody: null,
    successResponse: {
      success: true,
      data: {
        symbol: "BTC-INR",
        bestBidPriceTicks: 9900,
        bestAskPriceTicks: 10100,
        lastTradePriceTicks: 10000,
        stopOrders: [],
        bids: [
          {
            priceTicks: 9900,
            totalQuantity: 10,
            orderCount: 1,
            headOrderId: "B1",
            tailOrderId: "B1",
          },
        ],
        asks: [
          {
            priceTicks: 10100,
            totalQuantity: 5,
            orderCount: 1,
            headOrderId: "S1",
            tailOrderId: "S1",
          },
        ],
      },
    },
  },
  {
    title: "Get Trades",
    method: "GET",
    url: `${baseUrl}/books/BTC-INR/trades`,
    description: "Returns all trades created for a symbol.",
    requestBody: null,
    successResponse: {
      success: true,
      data: {
        symbol: "BTC-INR",
        trades: [
          {
            symbol: "BTC-INR",
            priceTicks: 10000,
            quantity: 5,
            buyOrderId: "B1",
            sellOrderId: "S1",
            aggressorSide: "BUY",
            timestamp: 1710000000000,
          },
        ],
      },
    },
  },
  {
    title: "Place Limit Order",
    method: "POST",
    url: `${baseUrl}/books/BTC-INR/orders/limit`,
    description:
      "Places a limit order. It may match immediately or rest in the order book.",
    requestBody: {
      orderId: "B1",
      userId: "U1",
      side: "BUY",
      priceTicks: 10000,
      quantity: 10,
      timestamp: 1710000000000,
    },
    successResponse: {
      success: true,
      data: {
        order: {
          orderId: "B1",
          userId: "U1",
          symbol: "BTC-INR",
          side: "BUY",
          type: "LIMIT",
          priceTicks: 10000,
          quantity: 10,
          remainingQuantity: 10,
          status: "OPEN",
          timestamp: 1710000000000,
        },
        trades: [],
        triggeredOrders: [],
      },
    },
  },
  {
    title: "Place Market Order",
    method: "POST",
    url: `${baseUrl}/books/BTC-INR/orders/market`,
    description:
      "Places a market order. It matches against the best available opposite-side liquidity. Any unfilled quantity is cancelled.",
    requestBody: {
      orderId: "M1",
      userId: "U1",
      side: "BUY",
      quantity: 5,
      timestamp: 1710000000000,
    },
    successResponse: {
      success: true,
      data: {
        order: {
          orderId: "M1",
          userId: "U1",
          symbol: "BTC-INR",
          side: "BUY",
          type: "MARKET",
          priceTicks: null,
          quantity: 5,
          remainingQuantity: 0,
          status: "FILLED",
          timestamp: 1710000000000,
        },
        trades: [
          {
            symbol: "BTC-INR",
            priceTicks: 10000,
            quantity: 5,
            buyOrderId: "M1",
            sellOrderId: "S1",
            aggressorSide: "BUY",
            timestamp: 1710000000000,
          },
        ],
        triggeredOrders: [],
      },
    },
  },
  {
    title: "Place Stop Market Order",
    method: "POST",
    url: `${baseUrl}/books/BTC-INR/orders/stop-market`,
    description:
      "Places a stop-market order. It stays inactive until triggerPriceTicks is reached. Once triggered, it becomes a market order.",
    requestBody: {
      orderId: "SM1",
      userId: "U1",
      side: "SELL",
      triggerPriceTicks: 9900,
      quantity: 5,
      timestamp: 1710000000000,
    },
    successResponse: {
      success: true,
      data: {
        order: {
          orderId: "SM1",
          userId: "U1",
          symbol: "BTC-INR",
          side: "SELL",
          type: "STOP_MARKET",
          triggerPriceTicks: 9900,
          priceTicks: null,
          quantity: 5,
          remainingQuantity: 5,
          status: "OPEN",
          timestamp: 1710000000000,
        },
        trades: [],
        triggeredOrders: [],
      },
    },
  },
  {
    title: "Place Stop Limit Order",
    method: "POST",
    url: `${baseUrl}/books/BTC-INR/orders/stop-limit`,
    description:
      "Places a stop-limit order. It stays inactive until triggerPriceTicks is reached. Once triggered, it becomes a limit order at priceTicks.",
    requestBody: {
      orderId: "SL1",
      userId: "U1",
      side: "BUY",
      triggerPriceTicks: 10000,
      priceTicks: 10050,
      quantity: 5,
      timestamp: 1710000000000,
    },
    successResponse: {
      success: true,
      data: {
        order: {
          orderId: "SL1",
          userId: "U1",
          symbol: "BTC-INR",
          side: "BUY",
          type: "STOP_LIMIT",
          triggerPriceTicks: 10000,
          priceTicks: 10050,
          quantity: 5,
          remainingQuantity: 5,
          status: "OPEN",
          timestamp: 1710000000000,
        },
        trades: [],
        triggeredOrders: [],
      },
    },
  },
  {
    title: "Cancel Order",
    method: "DELETE",
    url: `${baseUrl}/books/BTC-INR/orders/B1`,
    description:
      "Cancels an active resting limit order or an inactive stop order by orderId.",
    requestBody: null,
    successResponse: {
      success: true,
      data: {
        order: {
          orderId: "B1",
          status: "CANCELLED",
        },
      },
    },
  },
];

function codeBlock(language, value) {
  return `\`\`\`${language}\n${value}\n\`\`\``;
}

function jsonBlock(value) {
  return codeBlock("json", JSON.stringify(value, null, 2));
}

function generateCurl(endpoint) {
  const lines = [`curl -X ${endpoint.method} ${endpoint.url}`];

  if (endpoint.requestBody) {
    lines.push(`  -H "Content-Type: application/json"`);
    lines.push(`  -d '${JSON.stringify(endpoint.requestBody, null, 2)}'`);
  }

  return lines.join(" \\\n");
}

const docs = `# LOB Matching Engine API Documentation

This document is generated for frontend developers.

## Base URLs

| Environment | URL |
|---|---|
| Local API | \`http://localhost:3000\` |
| API Prefix | \`http://localhost:3000/api/v1\` |

## Common Concepts

### Symbol

A symbol identifies an order book.

Example:

${codeBlock("txt", "BTC-INR")}

### Side

Allowed values:

${jsonBlock(["BUY", "SELL"])}

### Order Types

Allowed values:

${jsonBlock(["LIMIT", "MARKET", "STOP_MARKET", "STOP_LIMIT"])}

### Price Ticks

Prices are represented as integers using \`priceTicks\`.

Example:

${codeBlock("txt", "₹100.25 -> 10025 ticks")}

### Standard Success Response

${jsonBlock({
  success: true,
  data: {},
})}

### Standard Error Response

${jsonBlock({
  success: false,
  error: "error message",
})}

---

${endpoints
  .map((endpoint, index) => {
    return `## ${index + 1}. ${endpoint.title}

${endpoint.description}

| Field | Value |
|---|---|
| Method | \`${endpoint.method}\` |
| URL | \`${endpoint.url}\` |

### Request Body

${
  endpoint.requestBody
    ? jsonBlock(endpoint.requestBody)
    : codeBlock("txt", "No request body required")
}

### Example cURL

${codeBlock("bash", generateCurl(endpoint))}

### Success Response Example

${jsonBlock(endpoint.successResponse)}

---`;
  })
  .join("\n\n")}

## WebSocket Events

### Connection URL

${codeBlock("txt", "http://localhost:3000")}

### Subscribe to Book

Client emits:

${jsonBlock({
  event: "subscribe:book",
  payload: {
    symbol: "BTC-INR",
  },
})}

Server responds:

${jsonBlock({
  event: "subscribed:book",
  payload: {
    symbol: "BTC-INR",
    room: "book:BTC-INR",
  },
})}

### Book Update Event

Server emits when the book changes:

${jsonBlock({
  event: "book:update",
  payload: {
    type: "BOOK_UPDATED",
    symbol: "BTC-INR",
    data: {
      symbol: "BTC-INR",
      bestBidPriceTicks: 9900,
      bestAskPriceTicks: 10100,
      lastTradePriceTicks: 10000,
      stopOrders: [],
      bids: [],
      asks: [],
    },
    timestamp: 1710000000000,
  },
})}

### Trade Created Event

Server emits when trades are created:

${jsonBlock({
  event: "trade:created",
  payload: {
    type: "TRADE_CREATED",
    symbol: "BTC-INR",
    data: {
      symbol: "BTC-INR",
      priceTicks: 10000,
      quantity: 5,
      buyOrderId: "B1",
      sellOrderId: "S1",
      aggressorSide: "BUY",
      timestamp: 1710000000000,
    },
    timestamp: 1710000000000,
  },
})}
`;

fs.writeFileSync(outputPath, docs);

console.log(`API documentation generated at ${outputPath}`);