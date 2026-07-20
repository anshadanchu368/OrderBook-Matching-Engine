package service

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/redis/go-redis/v9"

	"lob-matching-engine/go-worker/internal/application"
	"lob-matching-engine/go-worker/internal/partition"
	"lob-matching-engine/go-worker/internal/storage"
)

func TestEndToEndCommandContract(t *testing.T) {
	redisURL := os.Getenv("E2E_REDIS_URL")
	rabbitURL := os.Getenv("E2E_RABBITMQ_URL")
	if redisURL == "" || rabbitURL == "" {
		t.Skip("E2E_REDIS_URL and E2E_RABBITMQ_URL are required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	redisOptions, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatal(err)
	}
	redisClient := redis.NewClient(redisOptions)
	defer redisClient.Close()
	if err := redisClient.FlushDB(ctx).Err(); err != nil {
		t.Fatal(err)
	}
	defer redisClient.FlushDB(context.Background())

	connection, err := amqp.Dial(rabbitURL)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	channel, err := connection.Channel()
	if err != nil {
		t.Fatal(err)
	}
	defer channel.Close()
	queueName := partition.QueueName(3)
	_, _ = channel.QueueDelete(queueName, false, false, false)
	defer channel.QueueDelete(queueName, false, false, false)

	config := Config{RedisURL: redisURL, RabbitURL: rabbitURL, WorkerID: "go-e2e-worker",
		PartitionID: 3, PartitionCount: 4}
	serviceCtx, stopService := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() { done <- Run(serviceCtx, config) }()

	probe, err := storage.New(redisURL)
	if err != nil {
		t.Fatal(err)
	}
	defer probe.Close()
	waitFor(t, ctx, func() bool {
		leader, _ := probe.HasLeadership(ctx, config.WorkerID, config.PartitionID)
		return leader
	})

	arguments := amqp.Table{"x-dead-letter-exchange": "order.commands.dlx", "x-dead-letter-routing-key": "order.commands.dlq"}
	if _, err := channel.QueueDeclare(queueName, true, false, false, false, arguments); err != nil {
		t.Fatal(err)
	}
	symbol := symbolForPartition(t, 3, 4)
	command := application.Command{CommandID: "GO-E2E-C1", Type: application.PlaceLimitOrder,
		Symbol: symbol, CreatedAt: 1,
		Payload: json.RawMessage(`{"orderId":"GO-E2E-B1","userId":"U1","side":"BUY","priceTicks":10000,"quantity":2,"timestamp":1}`)}
	body, err := json.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	if err := channel.PublishWithContext(ctx, "", queueName, false, false, amqp.Publishing{
		DeliveryMode: amqp.Persistent, ContentType: "application/json", Body: body,
	}); err != nil {
		t.Fatal(err)
	}

	waitFor(t, ctx, func() bool {
		status, _ := probe.GetCommandStatus(ctx, command.CommandID)
		return status != nil && status.Status == "PROCESSED"
	})
	snapshot, err := probe.RecoverySnapshot(ctx, symbol)
	if err != nil || snapshot == nil || len(snapshot.Bids) != 1 || snapshot.Bids[0].TotalQuantity != 2 {
		t.Fatalf("recovery snapshot=%#v err=%v", snapshot, err)
	}

	stopService()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Go worker did not stop")
	}
}

func symbolForPartition(t *testing.T, wanted, count int) string {
	t.Helper()
	for i := 0; i < 10_000; i++ {
		symbol := "GO-E2E-" + time.Unix(int64(i), 0).UTC().Format("150405")
		id, err := partition.ID(symbol, count)
		if err != nil {
			t.Fatal(err)
		}
		if id == wanted {
			return symbol
		}
	}
	t.Fatal("could not find symbol for partition")
	return ""
}

func waitFor(t *testing.T, ctx context.Context, condition func() bool) {
	t.Helper()
	for {
		if condition() {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(25 * time.Millisecond):
		}
	}
}
