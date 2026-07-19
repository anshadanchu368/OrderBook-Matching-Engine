package storage

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"lob-matching-engine/go-worker/internal/application"
	"lob-matching-engine/go-worker/internal/matching"
)

func integrationStore(t *testing.T) (*Store, context.Context) {
	t.Helper()
	url := os.Getenv("REDIS_TEST_URL")
	if url == "" {
		t.Skip("REDIS_TEST_URL not set")
	}
	store, err := New(url)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := store.Ping(ctx); err != nil {
		t.Fatal(err)
	}
	if err := store.client.FlushDB(ctx).Err(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.client.FlushDB(ctx).Err(); _ = store.Close() })
	return store, ctx
}

func testCommand(id string) application.Command {
	return application.Command{CommandID: id, Type: application.PlaceLimitOrder, Symbol: "BTC-INR", CreatedAt: 1,
		Payload: json.RawMessage(`{"orderId":"B1","userId":"U1","side":"BUY","priceTicks":100,"quantity":2,"timestamp":1}`)}
}

func TestRedisPersistenceContract(t *testing.T) {
	store, ctx := integrationStore(t)
	command := testCommand("C1")
	reason := "none"
	status := CommandStatus{CommandID: command.CommandID, Symbol: command.Symbol, Type: command.Type,
		Status: "PROCESSED", Reason: &reason, CreatedAt: 1, UpdatedAt: 2}
	if err := store.SaveCommandStatus(ctx, status); err != nil {
		t.Fatal(err)
	}
	gotStatus, err := store.GetCommandStatus(ctx, "C1")
	if err != nil || gotStatus.Status != "PROCESSED" {
		t.Fatalf("status: %#v, %v", gotStatus, err)
	}
	streamID, err := store.AppendProcessedCommand(ctx, command)
	if err != nil || streamID == "" {
		t.Fatalf("stream: %q, %v", streamID, err)
	}
	processed, err := store.IsCommandProcessed(ctx, command.Symbol, command.CommandID)
	if err != nil || !processed {
		t.Fatalf("processed=%v err=%v", processed, err)
	}
	entries, err := store.Commands(ctx, command.Symbol, "-", "+", 10)
	if err != nil || len(entries) != 1 || entries[0].Command.CommandID != "C1" {
		t.Fatalf("entries=%#v err=%v", entries, err)
	}
}

func TestRedisReadModelAndRecovery(t *testing.T) {
	store, ctx := integrationStore(t)
	registry := application.NewRegistry()
	command := testCommand("C1")
	book, result, err := registry.Execute(command)
	if err != nil {
		t.Fatal(err)
	}
	streamID, err := store.AppendProcessedCommand(ctx, command)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AppendEvents(ctx, command.Symbol, result.Events); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveReadModel(ctx, command.Symbol, book.Snapshot(), result.Trades); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveRecoverySnapshot(ctx, command.Symbol, book.RecoverySnapshot(&streamID)); err != nil {
		t.Fatal(err)
	}
	recoveredRegistry := application.NewRegistry()
	partitionID := nodePartition(t, command.Symbol, 3)
	recovery, err := store.RecoverPartition(ctx, recoveredRegistry, partitionID, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(recovery) != 1 || recovery[0].ReplayedCommandCount != 0 {
		t.Fatalf("recovery=%#v", recovery)
	}
	recovered, err := recoveredRegistry.GetOrCreate(command.Symbol)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Snapshot().Bids[0].TotalQuantity != 2 {
		t.Fatalf("snapshot=%#v", recovered.Snapshot())
	}
	if count, _ := store.client.XLen(ctx, eventStreamKey(command.Symbol)).Result(); count != int64(len(result.Events)) {
		t.Fatalf("event count=%d", count)
	}
}

func TestRedisLeadershipAndMarketEventContracts(t *testing.T) {
	store, ctx := integrationStore(t)
	acquired, err := store.AcquireLeadership(ctx, "W1", 0)
	if err != nil || !acquired {
		t.Fatalf("first acquire=%v err=%v", acquired, err)
	}
	acquired, err = store.AcquireLeadership(ctx, "W2", 0)
	if err != nil || acquired {
		t.Fatalf("second acquire=%v err=%v", acquired, err)
	}
	renewed, err := store.RenewLeadership(ctx, "W1", 0)
	if err != nil || !renewed {
		t.Fatalf("renewed=%v err=%v", renewed, err)
	}
	released, err := store.ReleaseLeadership(ctx, "W2", 0)
	if err != nil || released {
		t.Fatalf("wrong-owner release=%v err=%v", released, err)
	}

	subscriber := store.client.Subscribe(ctx, marketEventsChannel)
	defer subscriber.Close()
	if _, err := subscriber.Receive(ctx); err != nil {
		t.Fatal(err)
	}
	events := []matching.Event{{"type": matching.BookUpdated, "symbol": "BTC-INR", "sequence": int64(1)}}
	if err := store.PublishMarketEvents(ctx, "BTC-INR", events); err != nil {
		t.Fatal(err)
	}
	message, err := subscriber.ReceiveMessage(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var envelope struct {
		Symbol      string           `json:"symbol"`
		Events      []matching.Event `json:"events"`
		PublishedAt int64            `json:"publishedAt"`
	}
	if err := json.Unmarshal([]byte(message.Payload), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Symbol != "BTC-INR" || len(envelope.Events) != 1 || envelope.PublishedAt == 0 {
		t.Fatalf("envelope=%#v", envelope)
	}
	released, err = store.ReleaseLeadership(ctx, "W1", 0)
	if err != nil || !released {
		t.Fatalf("owner release=%v err=%v", released, err)
	}
}

func nodePartition(t *testing.T, symbol string, count int) int {
	t.Helper()
	// BTC-INR is partition zero under the Node djb2 implementation.
	if symbol != "BTC-INR" || count != 3 {
		t.Fatal("unexpected fixture")
	}
	return 0
}
