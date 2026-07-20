package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"lob-matching-engine/go-worker/internal/application"
	"lob-matching-engine/go-worker/internal/matching"
	"lob-matching-engine/go-worker/internal/partition"
	"lob-matching-engine/go-worker/internal/storage"
)

type Disposition int

const (
	Ack Disposition = iota
	NackRequeue
	Reject
)

type Outcome struct {
	Disposition    Disposition
	Symbol         string
	PublishEvents  []matching.Event
	LeadershipLost bool
}

type Persistence interface {
	IsCommandProcessed(context.Context, string, string) (bool, error)
	AppendProcessedCommand(context.Context, application.Command) (string, error)
	AppendEvents(context.Context, string, []matching.Event) error
	SaveReadModel(context.Context, string, matching.BookSnapshot, []matching.Trade) error
	SaveRecoverySnapshot(context.Context, string, matching.RecoverySnapshot) error
	SaveCommandStatus(context.Context, storage.CommandStatus) error
	HasLeadership(context.Context, string, int) (bool, error)
}

type Processor struct {
	store                       Persistence
	registry                    *application.Registry
	workerID                    string
	partitionID, partitionCount int
	now                         func() int64
}

func NewProcessor(store Persistence, registry *application.Registry, workerID string, partitionID, partitionCount int) *Processor {
	return &Processor{store: store, registry: registry, workerID: workerID,
		partitionID: partitionID, partitionCount: partitionCount, now: func() int64 { return time.Now().UnixMilli() }}
}

func (p *Processor) Handle(ctx context.Context, body []byte) (Outcome, error) {
	var command application.Command
	if err := json.Unmarshal(body, &command); err != nil {
		return Outcome{Disposition: Reject}, err
	}
	commandPartition, err := partition.ID(command.Symbol, p.partitionCount)
	if err != nil {
		return Outcome{Disposition: Reject}, err
	}
	if commandPartition != p.partitionID {
		return Outcome{Disposition: Reject}, fmt.Errorf("partition mismatch for %s: expected %d, got %d", command.Symbol, p.partitionID, commandPartition)
	}
	leader, err := p.store.HasLeadership(ctx, p.workerID, p.partitionID)
	if err != nil || !leader {
		return Outcome{Disposition: NackRequeue, LeadershipLost: true}, err
	}
	processed, err := p.store.IsCommandProcessed(ctx, command.Symbol, command.CommandID)
	if err != nil {
		return p.reject(ctx, command, err)
	}
	if processed {
		err := p.saveStatus(ctx, command, "PROCESSED", nil)
		return Outcome{Disposition: Ack, Symbol: command.Symbol}, err
	}
	book, result, err := p.registry.Execute(command)
	if err != nil {
		return p.reject(ctx, command, err)
	}
	leader, err = p.store.HasLeadership(ctx, p.workerID, p.partitionID)
	if err != nil || !leader {
		return Outcome{Disposition: NackRequeue, LeadershipLost: true}, err
	}
	streamID, err := p.store.AppendProcessedCommand(ctx, command)
	if err == nil {
		err = p.store.AppendEvents(ctx, command.Symbol, result.Events)
	}
	if err == nil {
		err = p.store.SaveReadModel(ctx, command.Symbol, book.Snapshot(), result.Trades)
	}
	if err == nil {
		err = p.store.SaveRecoverySnapshot(ctx, command.Symbol, book.RecoverySnapshot(&streamID))
	}
	if err == nil {
		err = p.saveStatus(ctx, command, "PROCESSED", nil)
	}
	if err != nil {
		return p.reject(ctx, command, err)
	}
	stillLeader, leadershipErr := p.store.HasLeadership(ctx, p.workerID, p.partitionID)
	return Outcome{Disposition: Ack, Symbol: command.Symbol, PublishEvents: result.Events,
		LeadershipLost: leadershipErr != nil || !stillLeader}, nil
}

func (p *Processor) reject(ctx context.Context, command application.Command, cause error) (Outcome, error) {
	reason := cause.Error()
	if err := p.saveStatus(ctx, command, "REJECTED", &reason); err != nil {
		return Outcome{Disposition: Reject}, err
	}
	var payload struct {
		OrderID string `json:"orderId"`
	}
	_ = json.Unmarshal(command.Payload, &payload)
	event := matching.RejectedEvent(command.Symbol, command.CommandID, payload.OrderID, string(command.Type), reason, p.now())
	return Outcome{Disposition: Ack, Symbol: command.Symbol, PublishEvents: []matching.Event{event}}, nil
}

func (p *Processor) saveStatus(ctx context.Context, command application.Command, status string, reason *string) error {
	return p.store.SaveCommandStatus(ctx, storage.CommandStatus{CommandID: command.CommandID,
		Symbol: command.Symbol, Type: command.Type, Status: status, Reason: reason,
		CreatedAt: command.CreatedAt, UpdatedAt: p.now()})
}
