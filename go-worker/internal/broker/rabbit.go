package broker

import (
	"context"
	"fmt"
	"log"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"lob-matching-engine/go-worker/internal/matching"
	"lob-matching-engine/go-worker/internal/partition"
	"lob-matching-engine/go-worker/internal/worker"
)

const (
	deadLetterExchange = "order.commands.dlx"
	deadLetterQueue    = "order.commands.dlq"
)

type EventPublisher interface {
	PublishMarketEvents(context.Context, string, []matching.Event) error
}

type Rabbit struct {
	connection *amqp.Connection
	channel    *amqp.Channel
}

func Connect(ctx context.Context, url string, partitionCount int) (*Rabbit, error) {
	var lastErr error
	for attempt := 1; attempt <= 10; attempt++ {
		connection, err := amqp.Dial(url)
		if err == nil {
			channel, channelErr := connection.Channel()
			if channelErr == nil {
				rabbit := &Rabbit{connection: connection, channel: channel}
				if declareErr := rabbit.declare(partitionCount); declareErr == nil {
					return rabbit, nil
				} else {
					lastErr = declareErr
				}
				_ = channel.Close()
			} else {
				lastErr = channelErr
			}
			_ = connection.Close()
		} else {
			lastErr = err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return nil, lastErr
}

func (r *Rabbit) declare(partitionCount int) error {
	if err := r.channel.ExchangeDeclare(deadLetterExchange, "direct", true, false, false, false, nil); err != nil {
		return err
	}
	if _, err := r.channel.QueueDeclare(deadLetterQueue, true, false, false, false, nil); err != nil {
		return err
	}
	if err := r.channel.QueueBind(deadLetterQueue, deadLetterQueue, deadLetterExchange, false, nil); err != nil {
		return err
	}
	arguments := amqp.Table{"x-dead-letter-exchange": deadLetterExchange, "x-dead-letter-routing-key": deadLetterQueue}
	for id := 0; id < partitionCount; id++ {
		if _, err := r.channel.QueueDeclare(partition.QueueName(id), true, false, false, false, arguments); err != nil {
			return err
		}
	}
	return r.channel.Qos(1, 0, false)
}

func (r *Rabbit) Consume(ctx context.Context, partitionID int, processor *worker.Processor, publisher EventPublisher, leadershipLost func()) error {
	deliveries, err := r.channel.Consume(partition.QueueName(partitionID), "", false, false, false, false, nil)
	if err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case delivery, open := <-deliveries:
			if !open {
				return fmt.Errorf("RabbitMQ delivery channel closed")
			}
			outcome, handleErr := processor.Handle(ctx, delivery.Body)
			if handleErr != nil {
				log.Printf("[go-worker] command handling error: %v", handleErr)
			}
			switch outcome.Disposition {
			case worker.Ack:
				if err := delivery.Ack(false); err != nil {
					return err
				}
				if len(outcome.PublishEvents) > 0 {
					if err := publisher.PublishMarketEvents(context.Background(), outcome.Symbol, outcome.PublishEvents); err != nil {
						log.Printf("[go-worker] failed to publish market events: %v", err)
					}
				}
			case worker.NackRequeue:
				if err := delivery.Nack(false, true); err != nil {
					return err
				}
			case worker.Reject:
				if err := delivery.Nack(false, false); err != nil {
					return err
				}
			}
			if outcome.LeadershipLost {
				leadershipLost()
				return fmt.Errorf("leadership lost")
			}
		}
	}
}

func (r *Rabbit) Close() error {
	if r.channel != nil {
		_ = r.channel.Close()
	}
	if r.connection != nil {
		return r.connection.Close()
	}
	return nil
}
