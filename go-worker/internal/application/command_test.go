package application

import (
	"encoding/json"
	"testing"
)

func TestRegistryExecutesNodeCommandContract(t *testing.T) {
	payload := json.RawMessage(`{"orderId":"B1","userId":"U1","side":"BUY","priceTicks":100,"quantity":2,"timestamp":1}`)
	registry := NewRegistry()
	book, result, err := registry.Execute(Command{CommandID: "C1", Type: PlaceLimitOrder, Symbol: "BTC-INR", Payload: payload, CreatedAt: 1})
	if err != nil {
		t.Fatal(err)
	}
	if book.Symbol() != "BTC-INR" || len(result.Events) != 4 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if got := book.Snapshot().Bids[0].TotalQuantity; got != 2 {
		t.Fatalf("quantity = %d", got)
	}
}

func TestRegistryRejectsUnsupportedCommand(t *testing.T) {
	_, _, err := NewRegistry().Execute(Command{Type: "UNKNOWN", Symbol: "BTC-INR", Payload: json.RawMessage(`{}`)})
	if err == nil || err.Error() != "unsupported order command type: UNKNOWN" {
		t.Fatalf("unexpected error: %v", err)
	}
}
