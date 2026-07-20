package matching

import "sort"

func (b *Book) RecoverySnapshot(lastCommandStreamID *string) RecoverySnapshot {
	return RecoverySnapshot{Symbol: b.symbol, Sequence: b.sequence,
		LastTradePriceTicks: cloneInt64(b.lastTradePriceTicks), LastCommandStreamID: lastCommandStreamID,
		Bids: b.recoverySide(b.bids, true), Asks: b.recoverySide(b.asks, false), StopOrders: b.stopSnapshots()}
}

func (b *Book) recoverySide(side map[int64]*priceLevel, bids bool) []RecoveryPriceLevel {
	levels := make([]RecoveryPriceLevel, 0, len(side))
	for _, level := range side {
		orders := make([]OrderSnapshot, 0, len(level.orders))
		for _, o := range level.orders {
			orders = append(orders, o.snapshot())
		}
		levels = append(levels, RecoveryPriceLevel{PriceTicks: level.priceTicks,
			TotalQuantity: level.totalQuantity, OrderCount: len(level.orders), Orders: orders})
	}
	sort.Slice(levels, func(i, j int) bool {
		if bids {
			return levels[i].PriceTicks > levels[j].PriceTicks
		}
		return levels[i].PriceTicks < levels[j].PriceTicks
	})
	return levels
}

func FromRecoverySnapshot(snapshot RecoverySnapshot) (*Book, error) {
	b, err := NewBook(snapshot.Symbol)
	if err != nil {
		return nil, err
	}
	b.sequence = snapshot.Sequence
	b.lastTradePriceTicks = cloneInt64(snapshot.LastTradePriceTicks)
	for _, level := range snapshot.Bids {
		b.restoreLevel(b.bids, level)
	}
	for _, level := range snapshot.Asks {
		b.restoreLevel(b.asks, level)
	}
	for _, value := range snapshot.StopOrders {
		stop := &stopOrder{orderID: value.OrderID, userID: value.UserID, symbol: value.Symbol,
			side: value.Side, typ: value.Type, triggerPriceTicks: value.TriggerPriceTicks,
			priceTicks: cloneInt64(value.PriceTicks), trailingAmountTicks: cloneInt64(value.TrailingAmountTicks),
			peakPriceTicks: cloneInt64(value.PeakPriceTicks), valleyPriceTicks: cloneInt64(value.ValleyPriceTicks),
			quantity: value.Quantity, remainingQuantity: value.RemainingQuantity, status: value.Status, timestamp: value.Timestamp}
		b.stopOrders[stop.orderID] = stop
		b.stopOrderIDs = append(b.stopOrderIDs, stop.orderID)
	}
	return b, nil
}

func (b *Book) restoreLevel(side map[int64]*priceLevel, snapshot RecoveryPriceLevel) {
	level := &priceLevel{priceTicks: snapshot.PriceTicks}
	for _, value := range snapshot.Orders {
		if value.RemainingQuantity <= 0 {
			continue
		}
		o := &order{orderID: value.OrderID, userID: value.UserID, symbol: value.Symbol,
			side: value.Side, typ: value.Type, priceTicks: cloneInt64(value.PriceTicks),
			initialQuantity: value.InitialQuantity, remainingQuantity: value.RemainingQuantity,
			status: value.Status, timestamp: value.Timestamp}
		level.append(o)
		b.orders[o.orderID] = o
	}
	if len(level.orders) > 0 {
		side[level.priceTicks] = level
	}
}
