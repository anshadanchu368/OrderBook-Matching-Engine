package matching

import (
	"encoding/json"
	"reflect"
	"testing"
)

func ticks(value int64) *int64 { return &value }

func newTestBook(t *testing.T) *Book {
	t.Helper()
	b, err := NewBookWithClock("BTC-INR", func() int64 { return 999 })
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func placeLimit(t *testing.T, b *Book, id string, side Side, price, quantity, timestamp int64) Result {
	t.Helper()
	result, err := b.PlaceLimit(OrderInput{OrderID: id, UserID: "U-" + id, Side: side,
		PriceTicks: ticks(price), Quantity: quantity, Timestamp: timestamp})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestLimitOrdersUsePriceTimePriority(t *testing.T) {
	b := newTestBook(t)
	placeLimit(t, b, "S1", Sell, 100, 3, 1)
	placeLimit(t, b, "S2", Sell, 100, 4, 2)
	result := placeLimit(t, b, "B1", Buy, 100, 5, 3)
	if len(result.Trades) != 2 {
		t.Fatalf("got %d trades", len(result.Trades))
	}
	if result.Trades[0].SellOrderID != "S1" || result.Trades[1].SellOrderID != "S2" {
		t.Fatalf("FIFO mismatch: %#v", result.Trades)
	}
	snapshot := b.Snapshot()
	if len(snapshot.Asks) != 1 || snapshot.Asks[0].TotalQuantity != 2 || *snapshot.Asks[0].HeadOrderID != "S2" {
		t.Fatalf("unexpected ask snapshot: %#v", snapshot.Asks)
	}
}

func TestMarketRemainderIsCancelledAndDoesNotRest(t *testing.T) {
	b := newTestBook(t)
	placeLimit(t, b, "S1", Sell, 100, 2, 1)
	result, err := b.PlaceMarket(OrderInput{OrderID: "B1", UserID: "U1", Side: Buy, Quantity: 5, Timestamp: 2})
	if err != nil {
		t.Fatal(err)
	}
	order := result.Order.(OrderSnapshot)
	if order.Status != Cancelled || order.RemainingQuantity != 3 {
		t.Fatalf("unexpected order: %#v", order)
	}
	if len(b.Snapshot().Bids) != 0 || len(b.Snapshot().Asks) != 0 {
		t.Fatal("market order rested")
	}
}

func TestStopMarketTriggersAfterTrade(t *testing.T) {
	b := newTestBook(t)
	placeLimit(t, b, "B0", Buy, 100, 1, 1)
	placeLimit(t, b, "S0", Sell, 100, 1, 2) // establishes last trade
	placeLimit(t, b, "S-LIQ", Sell, 110, 3, 3)
	stop, err := b.PlaceStopMarket(OrderInput{OrderID: "STOP-B", UserID: "U1", Side: Buy,
		TriggerPriceTicks: ticks(105), Quantity: 2, Timestamp: 4})
	if err != nil {
		t.Fatal(err)
	}
	if stop.Order.(StopOrderSnapshot).Status != Open {
		t.Fatal("stop did not open")
	}
	result := placeLimit(t, b, "B-TRIGGER", Buy, 110, 1, 5)
	if len(result.TriggeredOrders) != 1 || result.TriggeredOrders[0].OrderID != "STOP-B" {
		t.Fatalf("stop not triggered: %#v", result.TriggeredOrders)
	}
}

func TestTrailingStopTracksPeak(t *testing.T) {
	b := newTestBook(t)
	placeLimit(t, b, "B1", Buy, 100, 2, 1)
	placeLimit(t, b, "S1", Sell, 100, 1, 2)
	amount := int64(5)
	_, err := b.PlaceTrailingStopMarket(OrderInput{OrderID: "TS", UserID: "U1", Side: Sell,
		TrailingAmountTicks: &amount, Quantity: 1, Timestamp: 3})
	if err != nil {
		t.Fatal(err)
	}
	placeLimit(t, b, "B2", Buy, 110, 1, 4)
	placeLimit(t, b, "S2", Sell, 110, 1, 5)
	stops := b.Snapshot().StopOrders
	if len(stops) != 1 || stops[0].PeakPriceTicks == nil || *stops[0].PeakPriceTicks != 110 || stops[0].TriggerPriceTicks != 105 {
		t.Fatalf("unexpected trailing stop: %#v", stops)
	}
}

func TestRecoverySnapshotRoundTrip(t *testing.T) {
	b := newTestBook(t)
	placeLimit(t, b, "B1", Buy, 101, 4, 1)
	placeLimit(t, b, "B2", Buy, 100, 2, 2)
	streamID := "42-0"
	recovery := b.RecoverySnapshot(&streamID)
	restored, err := FromRecoverySnapshot(recovery)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(b.Snapshot(), restored.Snapshot()) {
		left, _ := json.Marshal(b.Snapshot())
		right, _ := json.Marshal(restored.Snapshot())
		t.Fatalf("snapshot mismatch\n%s\n%s", left, right)
	}
	result := placeLimit(t, restored, "S1", Sell, 100, 5, 3)
	if len(result.Trades) != 2 || result.Trades[0].BuyOrderID != "B1" {
		t.Fatalf("restored priority mismatch: %#v", result.Trades)
	}
}

func TestEventSequenceAndStopCancelReferenceBehavior(t *testing.T) {
	b := newTestBook(t)
	result := placeLimit(t, b, "B1", Buy, 100, 1, 1)
	for i, event := range result.Events {
		if event["sequence"] != int64(i+1) {
			t.Fatalf("sequence mismatch: %#v", event)
		}
	}
	stop, err := b.PlaceStopMarket(OrderInput{OrderID: "STOP", UserID: "U1", Side: Sell,
		TriggerPriceTicks: ticks(90), Quantity: 1, Timestamp: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(stop.Events) != 2 {
		t.Fatal("unexpected stop events")
	}
	cancelled, err := b.Cancel("STOP")
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := cancelled.Events[0]["sequence"]; exists {
		t.Fatal("stop cancellation unexpectedly stamped")
	}
}
