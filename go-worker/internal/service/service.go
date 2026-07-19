package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"lob-matching-engine/go-worker/internal/application"
	"lob-matching-engine/go-worker/internal/broker"
	"lob-matching-engine/go-worker/internal/partition"
	"lob-matching-engine/go-worker/internal/storage"
	"lob-matching-engine/go-worker/internal/worker"
)

type Config struct {
	RedisURL, RabbitURL, WorkerID string
	PartitionID, PartitionCount   int
}

func ConfigFromEnv() (Config, error) {
	partitionID, err := strconv.Atoi(env("PARTITION_ID", "0"))
	if err != nil {
		return Config{}, err
	}
	partitionCount, err := strconv.Atoi(env("PARTITION_COUNT", "1"))
	if err != nil {
		return Config{}, err
	}
	if err := partition.Validate(partitionID, partitionCount); err != nil {
		return Config{}, err
	}
	workerID := os.Getenv("WORKER_ID")
	if workerID == "" {
		workerID = generatedWorkerID()
	}
	return Config{RedisURL: env("REDIS_URL", "redis://localhost:6379"),
		RabbitURL: env("RABBITMQ_URL", "amqp://guest:guest@localhost:5672"), WorkerID: workerID,
		PartitionID: partitionID, PartitionCount: partitionCount}, nil
}

func Run(ctx context.Context, config Config) error {
	store, err := storage.New(config.RedisURL)
	if err != nil {
		return err
	}
	defer store.Close()
	if err := store.Ping(ctx); err != nil {
		return err
	}
	if err := waitForLeadership(ctx, store, config); err != nil {
		return err
	}
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, _ = store.ReleaseLeadership(releaseCtx, config.WorkerID, config.PartitionID)
	}()
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go heartbeat(runCtx, cancel, store, config)
	registry := application.NewRegistry()
	recovery, err := store.RecoverPartition(runCtx, registry, config.PartitionID, config.PartitionCount)
	if err != nil {
		return err
	}
	log.Printf("[go-worker] recovery completed: %#v", recovery)
	rabbit, err := broker.Connect(runCtx, config.RabbitURL, config.PartitionCount)
	if err != nil {
		return err
	}
	defer rabbit.Close()
	processor := worker.NewProcessor(store, registry, config.WorkerID, config.PartitionID, config.PartitionCount)
	log.Printf("[go-worker] consuming %s", partition.QueueName(config.PartitionID))
	return rabbit.Consume(runCtx, config.PartitionID, processor, store, cancel)
}

func waitForLeadership(ctx context.Context, store *storage.Store, config Config) error {
	for {
		acquired, err := store.AcquireLeadership(ctx, config.WorkerID, config.PartitionID)
		if err != nil {
			return err
		}
		if acquired {
			log.Printf("[go-worker] leadership acquired for partition %d", config.PartitionID)
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func heartbeat(ctx context.Context, cancel context.CancelFunc, store *storage.Store, config Config) {
	ticker := time.NewTicker(storage.LeaderRenewInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			renewed, err := store.RenewLeadership(ctx, config.WorkerID, config.PartitionID)
			if err != nil {
				log.Printf("[go-worker] leadership renewal error: %v", err)
				continue
			}
			if !renewed {
				log.Printf("[go-worker] leadership lost")
				cancel()
				return
			}
		}
	}
}

func generatedWorkerID() string {
	host, _ := os.Hostname()
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("%s:%d", host, time.Now().UnixNano())
	}
	return host + ":" + hex.EncodeToString(bytes)
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
