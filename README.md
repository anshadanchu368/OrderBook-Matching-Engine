# OrderBook-Matching-Engine
A distributed, horizontally sharded LOB matching engine dividing infrastructure into an asynchronous I/O Control Plane (Node.js/TypeScript) for edge ingress and a high-performance Data Plane (Go) for order matching. The architecture eliminates vertical scaling bottlenecks by utilizing RabbitMQ exchange routing keys to partition asset pairs, enforces zero-data-loss failover via Redis-backed active-standby leader election, and mitigates execution layer thread contention via lock-free circular ring buffers (Disruptor pattern).

This project implements a realistic exchange-style matching architecture with:

- price-time priority matching
- asynchronous command processing
- RabbitMQ partition queues
- Redis command/event streams
- Redis-backed recovery snapshots
- warm standby failover
- partition-specific leader election
- WebSocket market data fanout

The goal of this project is to explore how matching engines, event-driven systems, fault-tolerant in-memory state machines, and high-throughput backend architectures are designed.

---

## Project Status

This project is currently an educational and portfolio-grade matching engine.

It is **not intended for real-money trading or production exchange usage yet**.

Current focus:

- correctness
- system design
- recovery
- partitioning
- failover
- benchmark preparation

Future focus:

- observability
- deployment
- latency benchmarking
- fencing tokens
- dynamic symbol migration
- lower-latency event pipeline design

---

## Core Architecture

```text
Client
  ↓
API Service
  ↓
Symbol Partition Router
  ↓
RabbitMQ Partition Queue
  ↓
Partition Leader Matching Worker
  ↓
In-memory OrderBook
  ↓
Redis command/event/snapshot/status storage
  ↓
Redis Pub/Sub
  ↓
WebSocket Service
  ↓
Subscribed Clients
```

Each symbol is deterministically assigned to a partition:

```text
partitionId = hash(symbol) % PARTITION_COUNT
```

This guarantees that all commands for the same symbol always go to the same partition.

---

## Why Symbol Partitioning?

A limit order book has one important correctness rule:

```text
Commands for the same symbol must be processed sequentially.
```

For example:

```text
BTC-INR order 1
BTC-INR order 2
BTC-INR order 3
```

These must all be processed by the same worker in the correct order.

But different symbols have independent order books:

```text
BTC-INR book ≠ ETH-INR book
ETH-INR book ≠ SOL-INR book
```

So different symbols can safely be processed in parallel.

This project uses fixed symbol partitioning:

```text
symbol
  ↓
hash(symbol)
  ↓
hash(symbol) % PARTITION_COUNT
  ↓
partition id
  ↓
RabbitMQ partition queue
  ↓
partition leader worker
```

Example with `PARTITION_COUNT=3`:

```text
BTC-INR → partition 0 → order.commands.partition.0
ETH-INR → partition 1 → order.commands.partition.1
SOL-INR → partition 2 → order.commands.partition.2
```

Each partition has:

```text
one RabbitMQ queue
one active matching worker
one standby replica
one Redis leader lock
```

---

## Services

The system is split into multiple services:

```text
api
websocket
matching-worker-0
matching-worker-1
matching-worker-2
matching-standby-0
matching-standby-1
matching-standby-2
redis
rabbitmq
```

### API Service

The API service is stateless.

Responsibilities:

- receive HTTP order requests
- validate request payload
- create `commandId`
- store command status as `QUEUED`
- calculate symbol partition
- publish command to the correct RabbitMQ partition queue
- expose read endpoints for snapshots, trades, symbols, and command status

The API does **not** directly mutate the order book.

---

### Matching Worker

Each matching worker owns one partition.

Responsibilities:

- acquire partition-specific Redis leader lock
- consume one RabbitMQ partition queue
- own in-memory `BookRegistry` / `OrderBook` state
- execute matching logic
- write command stream entries
- write domain event stream entries
- save read-model snapshots
- save recovery snapshots
- update command status
- publish live market events through Redis Pub/Sub

Only the active leader for a partition is allowed to consume that partition’s queue.

---

### Standby Worker

Each partition has a standby replica.

Responsibilities:

- stay out of RabbitMQ while in standby mode
- discover symbols assigned to its partition
- load recovery snapshots
- replay Redis command streams
- maintain warm in-memory replica state
- monitor partition leader lock
- promote itself if the active leader dies

The standby does not write snapshots, command status, or market events while in standby mode.

---

### WebSocket Service

The WebSocket service receives live market events through Redis Pub/Sub and broadcasts updates to subscribed clients.

Clients subscribe by symbol.

Example:

```text
Client A subscribes to BTC-INR
Client B subscribes to ETH-INR
Client C subscribes to BTC-INR
```

A `BTC-INR` event is sent only to Client A and Client C.

---

## Matching Engine Features

### Order Types

- Limit orders
- Market orders
- Cancel orders
- Stop-market orders
- Stop-limit orders
- Trailing stop-market orders

### Matching Behavior

- Price-time priority
- FIFO queue per price level
- Partial fills
- Full fills
- Resting orders
- Trade generation
- Per-symbol sequence numbers
- Integer price ticks to avoid floating point issues

---

## In-Memory Data Model

Each symbol has its own `OrderBook`.

```text
OrderBook
  bids: Map<priceTicks, PriceLevel>
  asks: Map<priceTicks, PriceLevel>
  ordersById: Map<orderId, OrderNode>
```

Each `PriceLevel` stores orders in FIFO order using a doubly linked list.

```text
PriceLevel
  head → OrderNode → OrderNode → OrderNode
  tail
```

This preserves price-time priority.

---

## Redis Data Model

Redis is used for recovery, read models, command status, recent trades, and live fanout.

### Command Stream

```text
stream:<symbol>:commands
```

Stores processed commands for replay and recovery.

Used by:

- worker recovery
- standby replication
- incremental replay
- idempotency handling

---

### Event Stream

```text
stream:<symbol>:events
```

Stores domain events for audit/history.

Examples:

- `ORDER_ACCEPTED`
- `ORDER_RESTED`
- `ORDER_FILLED`
- `ORDER_PARTIALLY_FILLED`
- `ORDER_CANCELLED`
- `TRADE_EXECUTED`
- `BOOK_UPDATED`
- `ORDER_REJECTED`

---

### Book Snapshot

```text
book:<symbol>:snapshot
```

Used by the API to serve the current order book state.

---

### Recovery Snapshot

```text
recovery:<symbol>:snapshot
```

Stores exact engine recovery state, including:

- symbol
- sequence number
- last trade price
- active bid orders
- active ask orders
- stop orders
- trailing stop state
- last command stream checkpoint

This allows faster recovery without replaying the entire command stream from the beginning.

---

### Recent Trades

```text
book:<symbol>:recent-trades
```

Stores recent trades for API reads.

---

### Command Status

```text
command:<commandId>:status
```

Tracks command lifecycle.

Possible statuses:

```text
QUEUED
PROCESSED
REJECTED
FAILED
```

---

## RabbitMQ Queues

Partition command queues:

```text
order.commands.partition.0
order.commands.partition.1
order.commands.partition.2
```

Dead letter queue:

```text
order.commands.dlq
```

The previous global queue is no longer used in the partitioned command path.

```text
order.commands.queue
```

It may still exist from old local state, but it should have:

```text
consumers = 0
messages = 0
```

---

## Leader Election

Each partition has its own Redis leader lock.

```text
matching:leader:partition:0
matching:leader:partition:1
matching:leader:partition:2
```

Only the worker holding the lock for a partition can consume that partition’s RabbitMQ queue.

Leader lock behavior:

```text
try acquire lock
  ↓
if acquired:
  become partition leader
  start RabbitMQ consumer
  renew lock with heartbeat

if not acquired:
  run as standby
  replay command streams
  wait for promotion
```

If a leader dies, its lock expires. The standby for that partition can acquire the lock and promote itself.

---

## Correctness Guarantees

- Same symbol always routes to the same partition
- Same-symbol commands are processed sequentially
- Different symbols can be processed in parallel
- Each partition queue has only one active consumer
- Standby replay is limited to symbols assigned to its partition
- Wrong-partition commands are rejected
- Order book state can be recovered from Redis command streams and recovery snapshots
- API remains stateless
- Matching workers are the only services that mutate live order book memory

---

## Current Completed Milestones

- Matching engine core
- Price-time priority order matching
- Limit order support
- Market order support
- Cancel order support
- Stop-market order support
- Stop-limit order support
- Trailing stop-market order support
- REST API
- WebSocket market data feed
- RabbitMQ async command queue
- Redis read model
- Redis command status tracking
- Redis command streams
- Redis event streams
- Recovery snapshots
- Full replay recovery
- Incremental recovery
- Warm standby failover
- Redis leader election
- Fixed symbol partitioning
- Partition-specific leader locks
- Partition-aware standby replay

---

## Tech Stack

- Node.js
- Express
- Socket.IO
- RabbitMQ
- Redis
- Redis Streams
- Redis Pub/Sub
- Docker
- Docker Compose

---

## Running Locally

Start all services:

```bash
docker compose up -d --build
```

Check running containers:

```bash
docker compose ps
```

Check RabbitMQ queues:

```bash
docker compose exec rabbitmq rabbitmqctl list_queues name consumers messages
```

Expected partition queues:

```text
order.commands.partition.0    1    0
order.commands.partition.1    1    0
order.commands.partition.2    1    0
```

Check Redis leader locks:

```bash
docker compose exec redis redis-cli KEYS "matching:leader:partition:*"
```

Expected:

```text
matching:leader:partition:0
matching:leader:partition:1
matching:leader:partition:2
```

---

## Example API Usage

### Place a Limit Buy Order

```bash
curl -X POST http://localhost:3000/api/v1/books/BTC-INR/orders/limit \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "BUY-001",
    "userId": "USER-001",
    "side": "BUY",
    "priceTicks": 5000000,
    "quantity": 10,
    "timestamp": 1710000000000
  }'
```

Example response:

```json
{
  "success": true,
  "data": {
    "status": "QUEUED",
    "commandId": "example-command-id",
    "commandType": "PLACE_LIMIT_ORDER",
    "symbol": "BTC-INR",
    "orderId": "BUY-001"
  }
}
```

---

### Check Command Status

```bash
curl http://localhost:3000/api/v1/commands/<commandId>/status
```

Expected status after processing:

```text
PROCESSED
```

---

### Get Order Book Snapshot

```bash
curl http://localhost:3000/api/v1/books/BTC-INR
```

---

### Get Recent Trades

```bash
curl http://localhost:3000/api/v1/books/BTC-INR/trades
```

---

## Manual Matching Test

Place a resting buy order:

```bash
curl -X POST http://localhost:3000/api/v1/books/BTC-INR/orders/limit \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "TEST-BUY-001",
    "userId": "USER-001",
    "side": "BUY",
    "priceTicks": 5000000,
    "quantity": 10
  }'
```

Place a matching sell order:

```bash
curl -X POST http://localhost:3000/api/v1/books/BTC-INR/orders/limit \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "TEST-SELL-001",
    "userId": "USER-002",
    "side": "SELL",
    "priceTicks": 5000000,
    "quantity": 10
  }'
```

Check trades:

```bash
curl http://localhost:3000/api/v1/books/BTC-INR/trades
```

---

## Manual Failover Test

Stop one partition leader:

```bash
docker compose stop matching-worker-0
```

The standby for that partition should promote and start consuming:

```text
matching-standby-0 → promoted to active
```

Verify queues:

```bash
docker compose exec rabbitmq rabbitmqctl list_queues name consumers messages
```

Expected:

```text
order.commands.partition.0    1    0
order.commands.partition.1    1    0
order.commands.partition.2    1    0
```

Only partition 0 should fail over. Other partitions should continue normally.

---

## System Design Decisions

### Why API Does Not Mutate the Order Book

The API is kept stateless so that it can scale independently.

It only validates, creates commands, and routes them to RabbitMQ.

The matching worker is the single writer for order book state.

---

### Why RabbitMQ Is Used

RabbitMQ is used as the command queue between the API and matching workers.

It provides:

- async command buffering
- backpressure boundary
- manual acknowledgements
- dead letter queue support
- partition queue routing

---

### Why Redis Streams Are Used

Redis Streams store processed commands and domain events.

Command streams allow:

- replay
- recovery
- standby replication
- incremental catch-up

Event streams allow:

- audit trail
- debugging
- historical inspection

---

### Why Recovery Snapshots Exist

Replaying every command from the beginning becomes expensive over time.

Recovery snapshots act as checkpoints.

Startup recovery becomes:

```text
load latest recovery snapshot
  ↓
replay commands after snapshot.lastCommandStreamId
  ↓
resume processing
```

---

### Why Fixed Partitioning Was Implemented First

Fixed partitioning gives horizontal scaling while keeping ownership simple.

Dynamic partitioning and live symbol migration are intentionally deferred because they require:

- routing table versioning
- queue draining
- symbol freeze
- snapshot handoff
- ownership transfer
- stale route rejection

---

## Planned Improvements

- Deployment and benchmark baseline
- Structured logging
- Metrics and observability
- p50 / p95 / p99 latency measurement
- Fencing tokens for stronger leader safety
- DLQ inspection tooling
- Backpressure handling
- Docker production profile
- Nginx reverse proxy deployment
- AWS EC2 benchmark environment
- Dynamic symbol migration
- Go/Rust low-latency matching prototype
- LMAX Disruptor-style event pipeline

---

## Future Low-Latency Direction

A future version may explore a lower-latency event pipeline inspired by the LMAX Disruptor pattern.

Potential direction:

```text
Command Gateway
  ↓
Preallocated Ring Buffer
  ↓
Sequencer
  ↓
Matching Consumer
  ↓
Journal Consumer
  ↓
Market Data Consumer
```

Goals:

- reduce allocations
- preserve event sequencing
- improve cache locality
- separate matching, journaling, and market-data publishing
- benchmark against the current RabbitMQ/Redis-based implementation

---

## Disclaimer

This project is for learning, experimentation, and portfolio demonstration.

It is not production-ready for real-money trading.

Real exchange infrastructure requires significantly more work around:

- security
- risk checks
- persistence guarantees
- auditability
- observability
- compliance
- deterministic recovery
- latency benchmarking
- operational hardening
