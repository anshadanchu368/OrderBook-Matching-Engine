package worker

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"lob-matching-engine/go-worker/internal/application"
	"lob-matching-engine/go-worker/internal/matching"
	"lob-matching-engine/go-worker/internal/storage"
)

type fakeStore struct {
	leader, processed bool
	failAt            string
	calls             []string
	statuses          []storage.CommandStatus
}

func (f *fakeStore) fail(name string) error {
	f.calls = append(f.calls, name)
	if f.failAt == name {
		return errors.New(name + " failed")
	}
	return nil
}
func (f *fakeStore) HasLeadership(context.Context, string, int) (bool, error) {
	err := f.fail("leadership")
	return f.leader, err
}
func (f *fakeStore) IsCommandProcessed(context.Context, string, string) (bool, error) {
	err := f.fail("idempotency")
	return f.processed, err
}
func (f *fakeStore) AppendProcessedCommand(context.Context, application.Command) (string, error) {
	return "1-0", f.fail("command")
}
func (f *fakeStore) AppendEvents(context.Context, string, []matching.Event) error {
	return f.fail("events")
}
func (f *fakeStore) SaveReadModel(context.Context, string, matching.BookSnapshot, []matching.Trade) error {
	return f.fail("read-model")
}
func (f *fakeStore) SaveRecoverySnapshot(context.Context, string, matching.RecoverySnapshot) error {
	return f.fail("recovery")
}
func (f *fakeStore) SaveCommandStatus(_ context.Context, status storage.CommandStatus) error {
	f.statuses = append(f.statuses, status)
	return f.fail("status-" + status.Status)
}

func commandBody(t *testing.T, orderID string) []byte {
	t.Helper()
	command := application.Command{CommandID: "C1", Type: application.PlaceLimitOrder,
		Symbol: "BTC-INR", CreatedAt: 1, Payload: json.RawMessage(`{"orderId":"` + orderID + `","userId":"U1","side":"BUY","priceTicks":100,"quantity":2,"timestamp":1}`)}
	body, err := json.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestProcessorPersistsBeforeAckOutcome(t *testing.T) {
	store := &fakeStore{leader: true}
	processor := NewProcessor(store, application.NewRegistry(), "W1", 0, 3)
	outcome, err := processor.Handle(context.Background(), commandBody(t, "B1"))
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Disposition != Ack || len(outcome.PublishEvents) == 0 {
		t.Fatalf("outcome=%#v", outcome)
	}
	want := []string{"leadership", "idempotency", "leadership", "command", "events", "read-model", "recovery", "status-PROCESSED", "leadership"}
	if !reflect.DeepEqual(store.calls, want) {
		t.Fatalf("calls=%v want=%v", store.calls, want)
	}
}

func TestProcessorRequeuesWithoutLeadership(t *testing.T) {
	store := &fakeStore{}
	processor := NewProcessor(store, application.NewRegistry(), "W1", 0, 3)
	outcome, err := processor.Handle(context.Background(), commandBody(t, "B1"))
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Disposition != NackRequeue || !outcome.LeadershipLost {
		t.Fatalf("outcome=%#v", outcome)
	}
}

func TestProcessorRejectsDuplicateOrderAsPublishedEvent(t *testing.T) {
	store := &fakeStore{leader: true}
	registry := application.NewRegistry()
	processor := NewProcessor(store, registry, "W1", 0, 3)
	if _, err := processor.Handle(context.Background(), commandBody(t, "B1")); err != nil {
		t.Fatal(err)
	}
	store.calls = nil
	outcome, err := processor.Handle(context.Background(), commandBody(t, "B1"))
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Disposition != Ack || len(outcome.PublishEvents) != 1 || outcome.PublishEvents[0]["type"] != matching.OrderRejected {
		t.Fatalf("outcome=%#v", outcome)
	}
	if store.statuses[len(store.statuses)-1].Status != "REJECTED" {
		t.Fatalf("statuses=%#v", store.statuses)
	}
}
