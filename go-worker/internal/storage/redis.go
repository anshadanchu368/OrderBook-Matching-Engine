package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"

	"lob-matching-engine/go-worker/internal/application"
	"lob-matching-engine/go-worker/internal/matching"
	"lob-matching-engine/go-worker/internal/partition"
)

const (
	commandSymbolsKey    = "commands:symbols"
	bookSymbolsKey       = "books:symbols"
	marketEventsChannel  = "market:events"
	commandStatusTTL     = 10 * time.Minute
	maxCommandsPerSymbol = 100_000
	maxEventsPerSymbol   = 10_000
	recentTradesLimit    = 1_000
	leaderLockTTL        = 5 * time.Second
	LeaderRenewInterval  = 2 * time.Second
)

var renewLeaderScript = redis.NewScript(`
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
  end
  return 0
`)

var releaseLeaderScript = redis.NewScript(`
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`)

type Store struct {
	client *redis.Client
	now    func() int64
}

func New(url string) (*Store, error) {
	options, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	return &Store{client: redis.NewClient(options), now: func() int64 { return time.Now().UnixMilli() }}, nil
}

func (s *Store) Ping(ctx context.Context) error { return s.client.Ping(ctx).Err() }
func (s *Store) Close() error                   { return s.client.Close() }

func (s *Store) AcquireLeadership(ctx context.Context, workerID string, partitionID int) (bool, error) {
	return s.client.SetNX(ctx, partition.LeaderKey(partitionID), workerID, leaderLockTTL).Result()
}

func (s *Store) RenewLeadership(ctx context.Context, workerID string, partitionID int) (bool, error) {
	result, err := renewLeaderScript.Run(ctx, s.client, []string{partition.LeaderKey(partitionID)},
		workerID, strconv.FormatInt(leaderLockTTL.Milliseconds(), 10)).Int64()
	return result == 1, err
}

func (s *Store) ReleaseLeadership(ctx context.Context, workerID string, partitionID int) (bool, error) {
	result, err := releaseLeaderScript.Run(ctx, s.client, []string{partition.LeaderKey(partitionID)}, workerID).Int64()
	return result == 1, err
}

func (s *Store) HasLeadership(ctx context.Context, workerID string, partitionID int) (bool, error) {
	value, err := s.client.Get(ctx, partition.LeaderKey(partitionID)).Result()
	if err == redis.Nil {
		return false, nil
	}
	return value == workerID, err
}

func (s *Store) PublishMarketEvents(ctx context.Context, symbol string, events []matching.Event) error {
	if len(events) == 0 {
		return nil
	}
	payload, err := json.Marshal(map[string]any{"symbol": symbol, "events": events, "publishedAt": s.now()})
	if err != nil {
		return err
	}
	return s.client.Publish(ctx, marketEventsChannel, payload).Err()
}

type CommandStatus struct {
	CommandID string                  `json:"commandId"`
	Symbol    string                  `json:"symbol"`
	Type      application.CommandType `json:"type"`
	Status    string                  `json:"status"`
	Reason    *string                 `json:"reason"`
	CreatedAt int64                   `json:"createdAt"`
	UpdatedAt int64                   `json:"updatedAt"`
}

func (s *Store) SaveCommandStatus(ctx context.Context, status CommandStatus) error {
	payload, err := json.Marshal(status)
	if err != nil {
		return err
	}
	return s.client.Set(ctx, commandStatusKey(status.CommandID), payload, commandStatusTTL).Err()
}

func (s *Store) GetCommandStatus(ctx context.Context, commandID string) (*CommandStatus, error) {
	payload, err := s.client.Get(ctx, commandStatusKey(commandID)).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var status CommandStatus
	if err := json.Unmarshal(payload, &status); err != nil {
		return nil, err
	}
	return &status, nil
}

func (s *Store) IsCommandProcessed(ctx context.Context, symbol, commandID string) (bool, error) {
	return s.client.SIsMember(ctx, processedIDsKey(symbol), commandID).Result()
}

func (s *Store) AppendProcessedCommand(ctx context.Context, command application.Command) (string, error) {
	processedAt := s.now()
	stored := command
	stored.ProcessedAt = &processedAt
	commandJSON, err := json.Marshal(stored)
	if err != nil {
		return "", err
	}
	pipeline := s.client.TxPipeline()
	xadd := pipeline.XAdd(ctx, &redis.XAddArgs{Stream: commandStreamKey(command.Symbol), MaxLen: maxCommandsPerSymbol, Approx: true,
		Values: map[string]any{"commandId": command.CommandID, "symbol": command.Symbol, "type": string(command.Type),
			"payload": string(defaultJSON(command.Payload)), "createdAt": optionalInt(command.CreatedAt),
			"processedAt": strconv.FormatInt(processedAt, 10), "command": string(commandJSON)}})
	pipeline.SAdd(ctx, processedIDsKey(command.Symbol), command.CommandID)
	pipeline.SAdd(ctx, commandSymbolsKey, command.Symbol)
	if _, err := pipeline.Exec(ctx); err != nil {
		return "", err
	}
	return xadd.Val(), nil
}

type CommandEntry struct {
	ID      string
	Command application.Command
}

func (s *Store) Commands(ctx context.Context, symbol, start, end string, count int64) ([]CommandEntry, error) {
	entries, err := s.client.XRangeN(ctx, commandStreamKey(symbol), start, end, count).Result()
	if err != nil {
		return nil, err
	}
	return decodeCommands(entries)
}

func (s *Store) CommandsAfter(ctx context.Context, symbol, streamID string, count int64) ([]CommandEntry, error) {
	return s.Commands(ctx, symbol, "("+streamID, "+", count)
}

func decodeCommands(entries []redis.XMessage) ([]CommandEntry, error) {
	result := make([]CommandEntry, 0, len(entries))
	for _, entry := range entries {
		raw, ok := entry.Values["command"].(string)
		if !ok {
			return nil, fmt.Errorf("command stream entry %s has invalid command", entry.ID)
		}
		var command application.Command
		if err := json.Unmarshal([]byte(raw), &command); err != nil {
			return nil, err
		}
		result = append(result, CommandEntry{ID: entry.ID, Command: command})
	}
	return result, nil
}

func (s *Store) CommandSymbols(ctx context.Context) ([]string, error) {
	return s.client.SMembers(ctx, commandSymbolsKey).Result()
}

func (s *Store) AppendEvents(ctx context.Context, symbol string, events []matching.Event) error {
	if len(events) == 0 {
		return nil
	}
	pipeline := s.client.TxPipeline()
	for _, event := range events {
		payload, err := json.Marshal(event)
		if err != nil {
			return err
		}
		pipeline.XAdd(ctx, &redis.XAddArgs{Stream: eventStreamKey(symbol), MaxLen: maxEventsPerSymbol, Approx: true,
			Values: map[string]any{"type": fmt.Sprint(event["type"]), "symbol": eventSymbol(event, symbol),
				"sequence": eventSequence(event), "payload": string(payload)}})
	}
	_, err := pipeline.Exec(ctx)
	return err
}

func (s *Store) SaveReadModel(ctx context.Context, symbol string, snapshot matching.BookSnapshot, trades []matching.Trade) error {
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	pipeline := s.client.TxPipeline()
	pipeline.Set(ctx, bookSnapshotKey(symbol), payload, 0)
	pipeline.SAdd(ctx, bookSymbolsKey, symbol)
	if len(trades) > 0 {
		values := make([]any, 0, len(trades))
		for _, trade := range trades {
			encoded, err := json.Marshal(trade)
			if err != nil {
				return err
			}
			values = append(values, string(encoded))
		}
		pipeline.LPush(ctx, recentTradesKey(symbol), values...)
		pipeline.LTrim(ctx, recentTradesKey(symbol), 0, recentTradesLimit-1)
	}
	_, err = pipeline.Exec(ctx)
	return err
}

func (s *Store) SaveRecoverySnapshot(ctx context.Context, symbol string, snapshot matching.RecoverySnapshot) error {
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	return s.client.Set(ctx, recoverySnapshotKey(symbol), payload, 0).Err()
}

func (s *Store) RecoverySnapshot(ctx context.Context, symbol string) (*matching.RecoverySnapshot, error) {
	payload, err := s.client.Get(ctx, recoverySnapshotKey(symbol)).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var snapshot matching.RecoverySnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		return nil, err
	}
	return &snapshot, nil
}

type RecoveryResult struct {
	Symbol, Mode, LastCommandStreamID string
	ReplayedCommandCount              int
}

func (s *Store) RecoverPartition(ctx context.Context, registry *application.Registry, partitionID, partitionCount int) ([]RecoveryResult, error) {
	symbols, err := s.CommandSymbols(ctx)
	if err != nil {
		return nil, err
	}
	results := []RecoveryResult{}
	for _, symbol := range symbols {
		id, err := partition.ID(symbol, partitionCount)
		if err != nil {
			return nil, err
		}
		if id != partitionID {
			continue
		}
		result, err := s.recoverSymbol(ctx, registry, symbol)
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	return results, nil
}

func (s *Store) recoverSymbol(ctx context.Context, registry *application.Registry, symbol string) (RecoveryResult, error) {
	snapshot, err := s.RecoverySnapshot(ctx, symbol)
	if err != nil {
		return RecoveryResult{}, err
	}
	start := "-"
	mode := "full-replay"
	lastID := "0-0"
	if snapshot != nil && snapshot.LastCommandStreamID != nil {
		book, err := matching.FromRecoverySnapshot(*snapshot)
		if err != nil {
			return RecoveryResult{}, err
		}
		if err := registry.Set(symbol, book); err != nil {
			return RecoveryResult{}, err
		}
		start = "(" + *snapshot.LastCommandStreamID
		lastID = *snapshot.LastCommandStreamID
		mode = "snapshot-plus-incremental-replay"
	}
	entries, err := s.Commands(ctx, symbol, start, "+", 100_000)
	if err != nil {
		return RecoveryResult{}, err
	}
	for _, entry := range entries {
		if _, _, err := registry.Execute(entry.Command); err != nil {
			return RecoveryResult{}, err
		}
		lastID = entry.ID
	}
	return RecoveryResult{Symbol: symbol, Mode: mode, ReplayedCommandCount: len(entries), LastCommandStreamID: lastID}, nil
}

func commandStatusKey(id string) string        { return "command:" + id + ":status" }
func commandStreamKey(symbol string) string    { return "stream:" + symbol + ":commands" }
func processedIDsKey(symbol string) string     { return "commands:" + symbol + ":processed-ids" }
func eventStreamKey(symbol string) string      { return "stream:" + symbol + ":events" }
func bookSnapshotKey(symbol string) string     { return "book:" + symbol + ":snapshot" }
func recentTradesKey(symbol string) string     { return "book:" + symbol + ":recent-trades" }
func recoverySnapshotKey(symbol string) string { return "recovery:" + symbol + ":snapshot" }
func defaultJSON(payload json.RawMessage) []byte {
	if len(payload) == 0 {
		return []byte("{}")
	}
	return payload
}
func optionalInt(value int64) string {
	if value == 0 {
		return ""
	}
	return strconv.FormatInt(value, 10)
}
func eventSymbol(event matching.Event, fallback string) string {
	if value, ok := event["symbol"].(string); ok {
		return value
	}
	return fallback
}
func eventSequence(event matching.Event) string {
	switch value := event["sequence"].(type) {
	case int64:
		return strconv.FormatInt(value, 10)
	case int:
		return strconv.Itoa(value)
	default:
		return ""
	}
}
