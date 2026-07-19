package main

import (
	"context"
	"fmt"
	"log"
	"os/signal"
	"syscall"

	"lob-matching-engine/go-worker/internal/service"
)

func main() {
	fmt.Println("Go matching worker starting")
	config, err := service.ConfigFromEnv()
	if err != nil {
		log.Fatalf("[go-worker] invalid configuration: %v", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := service.Run(ctx, config); err != nil && ctx.Err() == nil {
		log.Fatalf("[go-worker] stopped: %v", err)
	}
}
