package application

import (
	"encoding/json"
	"fmt"

	"lob-matching-engine/go-worker/internal/matching"
)

type CommandType string

const (
	PlaceLimitOrder              CommandType = "PLACE_LIMIT_ORDER"
	PlaceMarketOrder             CommandType = "PLACE_MARKET_ORDER"
	PlaceStopMarketOrder         CommandType = "PLACE_STOP_MARKET_ORDER"
	PlaceStopLimitOrder          CommandType = "PLACE_STOP_LIMIT_ORDER"
	PlaceTrailingStopMarketOrder CommandType = "PLACE_TRAILING_STOP_MARKET_ORDER"
	CancelOrder                  CommandType = "CANCEL_ORDER"
)

type Command struct {
	CommandID   string          `json:"commandId"`
	Type        CommandType     `json:"type"`
	Symbol      string          `json:"symbol"`
	Payload     json.RawMessage `json:"payload"`
	CreatedAt   int64           `json:"createdAt"`
	ProcessedAt *int64          `json:"processedAt,omitempty"`
}

type CancelPayload struct {
	OrderID string `json:"orderId"`
}

type Registry struct{ books map[string]*matching.Book }

func NewRegistry() *Registry { return &Registry{books: map[string]*matching.Book{}} }

func (r *Registry) GetOrCreate(symbol string) (*matching.Book, error) {
	if book := r.books[symbol]; book != nil {
		return book, nil
	}
	book, err := matching.NewBook(symbol)
	if err != nil {
		return nil, err
	}
	r.books[symbol] = book
	return book, nil
}

func (r *Registry) Set(symbol string, book *matching.Book) error {
	if book == nil || book.Symbol() != symbol {
		return fmt.Errorf("book symbol mismatch: %s", symbol)
	}
	r.books[symbol] = book
	return nil
}

func (r *Registry) Reset() { r.books = map[string]*matching.Book{} }

func (r *Registry) Execute(command Command) (*matching.Book, matching.Result, error) {
	book, err := r.GetOrCreate(command.Symbol)
	if err != nil {
		return nil, matching.Result{}, err
	}
	if command.Type == CancelOrder {
		var payload CancelPayload
		if err := json.Unmarshal(command.Payload, &payload); err != nil {
			return book, matching.Result{}, err
		}
		result, err := book.Cancel(payload.OrderID)
		return book, result, err
	}
	var input matching.OrderInput
	if err := json.Unmarshal(command.Payload, &input); err != nil {
		return book, matching.Result{}, err
	}
	var result matching.Result
	switch command.Type {
	case PlaceLimitOrder:
		result, err = book.PlaceLimit(input)
	case PlaceMarketOrder:
		result, err = book.PlaceMarket(input)
	case PlaceStopMarketOrder:
		result, err = book.PlaceStopMarket(input)
	case PlaceStopLimitOrder:
		result, err = book.PlaceStopLimit(input)
	case PlaceTrailingStopMarketOrder:
		result, err = book.PlaceTrailingStopMarket(input)
	default:
		err = fmt.Errorf("unsupported order command type: %s", command.Type)
	}
	return book, result, err
}
