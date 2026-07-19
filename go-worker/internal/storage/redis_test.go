package storage

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"lob-matching-engine/go-worker/internal/application"
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

func nodePartition(t *testing.T, symbol string, count int) int {
	t.Helper()
	// BTC-INR is partition zero under the Node djb2 implementation.
	if symbol != "BTC-INR" || count != 3 {
		t.Fatal("unexpected fixture")
	}
	return 0
}
