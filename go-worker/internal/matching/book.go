package matching

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

type stopOrder struct {
	orderID, userID, symbol                                           string
	side                                                              Side
	typ                                                               OrderType
	triggerPriceTicks                                                 int64
	priceTicks, trailingAmountTicks, peakPriceTicks, valleyPriceTicks *int64
	quantity, remainingQuantity                                       int64
	status                                                            OrderStatus
	timestamp                                                         int64
}

type Clock func() int64

type Book struct {
	symbol              string
	bids, asks          map[int64]*priceLevel
	orders              map[string]*order
	stopOrders          map[string]*stopOrder
	stopOrderIDs        []string
	trades              []Trade
	lastTradePriceTicks *int64
	sequence            int64
	now                 Clock
}

func NewBook(symbol string) (*Book, error) {
	return NewBookWithClock(symbol, func() int64 { return time.Now().UnixMilli() })
}

func NewBookWithClock(symbol string, now Clock) (*Book, error) {
	if strings.TrimSpace(symbol) == "" {
		return nil, fmt.Errorf("symbol must be a non-empty string")
	}
	return &Book{symbol: symbol, bids: map[int64]*priceLevel{}, asks: map[int64]*priceLevel{},
		orders: map[string]*order{}, stopOrders: map[string]*stopOrder{}, now: now}, nil
}

func (b *Book) Symbol() string { return b.symbol }

func (b *Book) assertAvailable(orderID string) error {
	if _, ok := b.orders[orderID]; ok {
		return fmt.Errorf("order already exists: %s", orderID)
	}
	if _, ok := b.stopOrders[orderID]; ok {
		return fmt.Errorf("order already exists: %s", orderID)
	}
	return nil
}

func (b *Book) PlaceLimit(input OrderInput) (Result, error) {
	if err := b.assertAvailable(input.OrderID); err != nil {
		return Result{}, err
	}
	incoming, err := newOrder(b.symbol, Limit, input)
	if err != nil {
		return Result{}, err
	}
	trades := b.match(incoming, false)
	events := []Event{orderAcceptedEvent(incoming.snapshot())}
	for _, trade := range trades {
		events = append(events, tradeEvent(trade))
	}
	events = append(events, orderFillEvent(incoming.snapshot()))
	if incoming.active() && incoming.remainingQuantity > 0 {
		b.addResting(incoming)
		b.orders[incoming.orderID] = incoming
		events = append(events, orderRestedEvent(incoming.snapshot()))
	}
	triggered, err := b.processStops(trades)
	if err != nil {
		return Result{}, err
	}
	events = append(events, bookUpdatedEvent(b.Snapshot(), b.now()))
	events = append(events, triggered.Events...)
	return Result{Order: incoming.snapshot(), Trades: appendTrades(trades, triggered.Trades),
		TriggeredOrders: triggered.TriggeredOrders, Events: b.stamp(events)}, nil
}

func (b *Book) PlaceMarket(input OrderInput) (Result, error) {
	if err := b.assertAvailable(input.OrderID); err != nil {
		return Result{}, err
	}
	incoming, err := newOrder(b.symbol, Market, input)
	if err != nil {
		return Result{}, err
	}
	trades := b.match(incoming, true)
	if incoming.remainingQuantity > 0 && incoming.active() {
		_ = incoming.cancel()
	}
	events := []Event{orderAcceptedEvent(incoming.snapshot())}
	for _, trade := range trades {
		events = append(events, tradeEvent(trade))
	}
	events = append(events, orderFillEvent(incoming.snapshot()))
	triggered, err := b.processStops(trades)
	if err != nil {
		return Result{}, err
	}
	events = append(events, triggered.Events...)
	events = append(events, bookUpdatedEvent(b.Snapshot(), b.now()))
	return Result{Order: incoming.snapshot(), Trades: appendTrades(trades, triggered.Trades),
		TriggeredOrders: triggered.TriggeredOrders, Events: b.stamp(events)}, nil
}

func (b *Book) PlaceStopMarket(input OrderInput) (Result, error) {
	return b.placeStop(input, StopMarket)
}

func (b *Book) PlaceStopLimit(input OrderInput) (Result, error) {
	return b.placeStop(input, StopLimit)
}

func (b *Book) PlaceTrailingStopMarket(input OrderInput) (Result, error) {
	if b.lastTradePriceTicks == nil {
		return Result{}, fmt.Errorf("cannot place trailing stop before first trade")
	}
	if input.TrailingAmountTicks == nil || *input.TrailingAmountTicks <= 0 {
		return Result{}, fmt.Errorf("trailingAmountTicks must be a positive integer")
	}
	if input.Side != Buy && input.Side != Sell {
		return Result{}, fmt.Errorf("invalid order side: %s", input.Side)
	}
	trigger := *b.lastTradePriceTicks
	var peak, valley *int64
	if input.Side == Sell {
		peak = cloneInt64(b.lastTradePriceTicks)
		trigger -= *input.TrailingAmountTicks
	}
	if input.Side == Buy {
		valley = cloneInt64(b.lastTradePriceTicks)
		trigger += *input.TrailingAmountTicks
	}
	input.TriggerPriceTicks = &trigger
	result, err := b.placeStopWithExtrema(input, TrailingStopMarket, peak, valley)
	return result, err
}

func (b *Book) placeStop(input OrderInput, typ OrderType) (Result, error) {
	return b.placeStopWithExtrema(input, typ, nil, nil)
}

func (b *Book) placeStopWithExtrema(input OrderInput, typ OrderType, peak, valley *int64) (Result, error) {
	if err := b.assertAvailable(input.OrderID); err != nil {
		return Result{}, err
	}
	if input.OrderID == "" {
		return Result{}, fmt.Errorf("orderId must be a non-empty string")
	}
	if input.UserID == "" {
		return Result{}, fmt.Errorf("userId must be a non-empty string")
	}
	if input.Side != Buy && input.Side != Sell {
		return Result{}, fmt.Errorf("invalid order side: %s", input.Side)
	}
	if input.TriggerPriceTicks == nil {
		return Result{}, fmt.Errorf("triggerPriceTicks must be a positive integer")
	}
	if input.Quantity <= 0 {
		return Result{}, fmt.Errorf("quantity must be a positive integer")
	}
	if typ == StopLimit && (input.PriceTicks == nil || *input.PriceTicks <= 0) {
		return Result{}, fmt.Errorf("priceTicks must be a positive integer")
	}
	stop := &stopOrder{orderID: input.OrderID, userID: input.UserID, symbol: b.symbol,
		side: input.Side, typ: typ, triggerPriceTicks: *input.TriggerPriceTicks,
		priceTicks: cloneInt64(input.PriceTicks), trailingAmountTicks: cloneInt64(input.TrailingAmountTicks),
		peakPriceTicks: cloneInt64(peak), valleyPriceTicks: cloneInt64(valley), quantity: input.Quantity,
		remainingQuantity: input.Quantity, status: Open, timestamp: input.Timestamp}
	b.stopOrders[stop.orderID] = stop
	b.stopOrderIDs = append(b.stopOrderIDs, stop.orderID)
	snapshot := stop.snapshot()
	events := b.stamp([]Event{stopEvent(StopOrderAccepted, snapshot), bookUpdatedEvent(b.Snapshot(), b.now())})
	return Result{Order: snapshot, Trades: []Trade{}, TriggeredOrders: []StopOrderSnapshot{}, Events: events}, nil
}

func (b *Book) Cancel(orderID string) (Result, error) {
	if stop, ok := b.stopOrders[orderID]; ok {
		stop.status = Cancelled
		b.deleteStop(orderID)
		snapshot := stop.snapshot()
		// Node reference currently does not sequence stop cancellation events.
		return Result{Order: snapshot, Trades: []Trade{}, TriggeredOrders: []StopOrderSnapshot{},
			Events: []Event{orderCancelledEvent(snapshot), bookUpdatedEvent(b.Snapshot(), b.now())}}, nil
	}
	o, ok := b.orders[orderID]
	if !ok {
		return Result{}, fmt.Errorf("order not found: %s", orderID)
	}
	if !o.active() {
		return Result{}, fmt.Errorf("order %s is already %s", orderID, o.status)
	}
	side := b.asks
	if o.side == Buy {
		side = b.bids
	}
	level := side[*o.priceTicks]
	level.remove(o)
	_ = o.cancel()
	delete(b.orders, orderID)
	if len(level.orders) == 0 {
		delete(side, *o.priceTicks)
	}
	snapshot := o.snapshot()
	return Result{Order: snapshot, Trades: []Trade{}, TriggeredOrders: []StopOrderSnapshot{},
		Events: b.stamp([]Event{orderCancelledEvent(snapshot), bookUpdatedEvent(b.Snapshot(), b.now())})}, nil
}

func (b *Book) match(incoming *order, ignorePrice bool) []Trade {
	trades := []Trade{}
	for incoming.remainingQuantity > 0 {
		price, ok := b.bestOpposite(incoming.side)
		if !ok {
			break
		}
		if !ignorePrice && ((incoming.side == Buy && price > *incoming.priceTicks) || (incoming.side == Sell && price < *incoming.priceTicks)) {
			break
		}
		side := b.bids
		if incoming.side == Buy {
			side = b.asks
		}
		level := side[price]
		resting := level.orders[0]
		quantity := incoming.remainingQuantity
		if resting.remainingQuantity < quantity {
			quantity = resting.remainingQuantity
		}
		_ = incoming.fill(quantity)
		_ = resting.fill(quantity)
		level.totalQuantity -= quantity
		trade := Trade{Symbol: b.symbol, PriceTicks: *resting.priceTicks, Quantity: quantity,
			AggressorSide: incoming.side, Timestamp: incoming.timestamp}
		if incoming.side == Buy {
			trade.BuyOrderID = incoming.orderID
			trade.SellOrderID = resting.orderID
		} else {
			trade.BuyOrderID = resting.orderID
			trade.SellOrderID = incoming.orderID
		}
		trades = append(trades, trade)
		b.trades = append(b.trades, trade)
		if resting.status == Filled {
			level.remove(resting)
			delete(b.orders, resting.orderID)
		}
		if len(level.orders) == 0 {
			delete(side, price)
		}
	}
	return trades
}

func (b *Book) bestOpposite(incomingSide Side) (int64, bool) {
	side := b.bids
	findMin := false
	if incomingSide == Buy {
		side = b.asks
		findMin = true
	}
	var best int64
	found := false
	for price := range side {
		if !found || (findMin && price < best) || (!findMin && price > best) {
			best, found = price, true
		}
	}
	return best, found
}

func (b *Book) addResting(o *order) {
	side := b.asks
	if o.side == Buy {
		side = b.bids
	}
	price := *o.priceTicks
	level := side[price]
	if level == nil {
		level = &priceLevel{priceTicks: price}
		side[price] = level
	}
	level.append(o)
}

type stopResult struct {
	Trades          []Trade
	TriggeredOrders []StopOrderSnapshot
	Events          []Event
}

func (b *Book) processStops(initial []Trade) (stopResult, error) {
	result := stopResult{Trades: []Trade{}, TriggeredOrders: []StopOrderSnapshot{}, Events: []Event{}}
	if len(initial) == 0 {
		return result, nil
	}
	latest := initial
	for cycles := 1; len(latest) > 0; cycles++ {
		if cycles > 1000 {
			return result, fmt.Errorf("stop order trigger cycle limit exceeded")
		}
		b.lastTradePriceTicks = int64Ptr(latest[len(latest)-1].PriceTicks)
		b.updateTrailingStops()
		eligible := b.eligibleStops()
		if len(eligible) == 0 {
			break
		}
		latest = []Trade{}
		for _, stop := range eligible {
			b.deleteStop(stop.orderID)
			stop.status = Triggered
			snapshot := stop.snapshot()
			result.Events = append(result.Events, stopEvent(StopOrderTriggered, snapshot))
			triggeredOrder, trades, err := b.executeStop(stop)
			if err != nil {
				return result, err
			}
			result.TriggeredOrders = append(result.TriggeredOrders, snapshot)
			latest = append(latest, trades...)
			result.Trades = append(result.Trades, trades...)
			for _, trade := range trades {
				result.Events = append(result.Events, tradeEvent(trade))
			}
			if triggeredOrder != nil {
				orderSnapshot := triggeredOrder.snapshot()
				result.Events = append(result.Events, orderFillEvent(orderSnapshot))
				if orderSnapshot.Status == Open && orderSnapshot.RemainingQuantity > 0 {
					result.Events = append(result.Events, orderRestedEvent(orderSnapshot))
				}
			}
		}
	}
	return result, nil
}

func (b *Book) executeStop(stop *stopOrder) (*order, []Trade, error) {
	typ := Market
	if stop.typ == StopLimit {
		typ = Limit
	}
	input := OrderInput{OrderID: stop.orderID, UserID: stop.userID, Side: stop.side,
		PriceTicks: cloneInt64(stop.priceTicks), Quantity: stop.remainingQuantity, Timestamp: b.now()}
	o, err := newOrder(b.symbol, typ, input)
	if err != nil {
		return nil, nil, err
	}
	trades := b.match(o, typ == Market)
	if typ == Market && o.remainingQuantity > 0 && o.active() {
		_ = o.cancel()
	}
	if typ == Limit && o.active() && o.remainingQuantity > 0 {
		b.addResting(o)
		b.orders[o.orderID] = o
	}
	return o, trades, nil
}

func (b *Book) updateTrailingStops() {
	if b.lastTradePriceTicks == nil {
		return
	}
	for _, id := range b.stopOrderIDs {
		o := b.stopOrders[id]
		if o == nil || o.typ != TrailingStopMarket {
			continue
		}
		if o.side == Sell && (o.peakPriceTicks == nil || *b.lastTradePriceTicks > *o.peakPriceTicks) {
			o.peakPriceTicks = cloneInt64(b.lastTradePriceTicks)
			o.triggerPriceTicks = *o.peakPriceTicks - *o.trailingAmountTicks
		}
		if o.side == Buy && (o.valleyPriceTicks == nil || *b.lastTradePriceTicks < *o.valleyPriceTicks) {
			o.valleyPriceTicks = cloneInt64(b.lastTradePriceTicks)
			o.triggerPriceTicks = *o.valleyPriceTicks + *o.trailingAmountTicks
		}
	}
}

func (b *Book) eligibleStops() []*stopOrder {
	eligible := []*stopOrder{}
	if b.lastTradePriceTicks == nil {
		return eligible
	}
	for _, id := range b.stopOrderIDs {
		o := b.stopOrders[id]
		if o == nil {
			continue
		}
		if (o.side == Buy && *b.lastTradePriceTicks >= o.triggerPriceTicks) || (o.side == Sell && *b.lastTradePriceTicks <= o.triggerPriceTicks) {
			eligible = append(eligible, o)
		}
	}
	return eligible
}

func (b *Book) deleteStop(orderID string) {
	delete(b.stopOrders, orderID)
	for i, id := range b.stopOrderIDs {
		if id == orderID {
			b.stopOrderIDs = append(b.stopOrderIDs[:i], b.stopOrderIDs[i+1:]...)
			return
		}
	}
}

func (s *stopOrder) snapshot() StopOrderSnapshot {
	return StopOrderSnapshot{OrderID: s.orderID, UserID: s.userID, Symbol: s.symbol, Side: s.side,
		Type: s.typ, TriggerPriceTicks: s.triggerPriceTicks, PriceTicks: cloneInt64(s.priceTicks),
		TrailingAmountTicks: cloneInt64(s.trailingAmountTicks), PeakPriceTicks: cloneInt64(s.peakPriceTicks),
		ValleyPriceTicks: cloneInt64(s.valleyPriceTicks), Quantity: s.quantity,
		RemainingQuantity: s.remainingQuantity, Status: s.status, Timestamp: s.timestamp}
}

func (b *Book) stamp(events []Event) []Event {
	for _, event := range events {
		b.sequence++
		event["sequence"] = b.sequence
		if _, ok := event["symbol"]; !ok {
			event["symbol"] = b.symbol
		}
		if event["type"] == BookUpdated {
			snapshot := event["snapshot"].(BookSnapshot)
			snapshot.Sequence = b.sequence
			event["snapshot"] = snapshot
		}
	}
	return events
}

func appendTrades(first, second []Trade) []Trade {
	result := make([]Trade, 0, len(first)+len(second))
	result = append(result, first...)
	return append(result, second...)
}

func (b *Book) Snapshot() BookSnapshot {
	return BookSnapshot{Symbol: b.symbol, Sequence: b.sequence, BestBidPriceTicks: b.bestPrice(b.bids, false),
		BestAskPriceTicks: b.bestPrice(b.asks, true), LastTradePriceTicks: cloneInt64(b.lastTradePriceTicks),
		StopOrders: b.stopSnapshots(), Bids: b.sideSnapshot(b.bids, true), Asks: b.sideSnapshot(b.asks, false)}
}

func (b *Book) bestPrice(side map[int64]*priceLevel, ascending bool) *int64 {
	var value int64
	found := false
	for price := range side {
		if !found || (ascending && price < value) || (!ascending && price > value) {
			value, found = price, true
		}
	}
	if !found {
		return nil
	}
	return &value
}

func (b *Book) sideSnapshot(side map[int64]*priceLevel, bids bool) []PriceLevelSnapshot {
	levels := make([]PriceLevelSnapshot, 0, len(side))
	for _, level := range side {
		levels = append(levels, level.snapshot())
	}
	sort.Slice(levels, func(i, j int) bool {
		if bids {
			return levels[i].PriceTicks > levels[j].PriceTicks
		}
		return levels[i].PriceTicks < levels[j].PriceTicks
	})
	return levels
}

func (b *Book) stopSnapshots() []StopOrderSnapshot {
	result := make([]StopOrderSnapshot, 0, len(b.stopOrderIDs))
	for _, id := range b.stopOrderIDs {
		if o := b.stopOrders[id]; o != nil {
			result = append(result, o.snapshot())
		}
	}
	return result
}
