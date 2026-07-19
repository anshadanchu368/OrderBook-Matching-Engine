package matching

const (
	OrderAccepted        = "ORDER_ACCEPTED"
	OrderRested          = "ORDER_RESTED"
	OrderCancelled       = "ORDER_CANCELLED"
	OrderFilled          = "ORDER_FILLED"
	OrderPartiallyFilled = "ORDER_PARTIALLY_FILLED"
	TradeCreated         = "TRADE_CREATED"
	StopOrderAccepted    = "STOP_ORDER_ACCEPTED"
	StopOrderTriggered   = "STOP_ORDER_TRIGGERED"
	BookUpdated          = "BOOK_UPDATED"
)

func orderAcceptedEvent(o OrderSnapshot) Event {
	return Event{"type": OrderAccepted, "symbol": o.Symbol, "orderId": o.OrderID,
		"userId": o.UserID, "side": o.Side, "orderType": o.Type, "priceTicks": o.PriceTicks,
		"quantity": o.InitialQuantity, "remainingQuantity": o.RemainingQuantity, "timestamp": o.Timestamp}
}

func orderRestedEvent(o OrderSnapshot) Event {
	return Event{"type": OrderRested, "symbol": o.Symbol, "orderId": o.OrderID,
		"userId": o.UserID, "side": o.Side, "orderType": o.Type, "priceTicks": o.PriceTicks,
		"remainingQuantity": o.RemainingQuantity, "timestamp": o.Timestamp}
}

func orderCancelledEvent(o any) Event {
	switch value := o.(type) {
	case OrderSnapshot:
		return Event{"type": OrderCancelled, "symbol": value.Symbol, "orderId": value.OrderID,
			"userId": value.UserID, "side": value.Side, "orderType": value.Type,
			"priceTicks": value.PriceTicks, "remainingQuantity": value.RemainingQuantity,
			"status": value.Status, "timestamp": value.Timestamp}
	case StopOrderSnapshot:
		return Event{"type": OrderCancelled, "symbol": value.Symbol, "orderId": value.OrderID,
			"userId": value.UserID, "side": value.Side, "orderType": value.Type,
			"priceTicks": value.PriceTicks, "remainingQuantity": value.RemainingQuantity,
			"status": value.Status, "timestamp": value.Timestamp}
	}
	panic("unsupported order snapshot")
}

func orderFillEvent(o OrderSnapshot) Event {
	typ := OrderPartiallyFilled
	if o.RemainingQuantity == 0 {
		typ = OrderFilled
	}
	return Event{"type": typ, "symbol": o.Symbol, "orderId": o.OrderID, "userId": o.UserID,
		"side": o.Side, "orderType": o.Type, "priceTicks": o.PriceTicks,
		"quantity": o.InitialQuantity, "remainingQuantity": o.RemainingQuantity,
		"status": o.Status, "timestamp": o.Timestamp}
}

func tradeEvent(t Trade) Event {
	return Event{"type": TradeCreated, "symbol": t.Symbol, "priceTicks": t.PriceTicks,
		"quantity": t.Quantity, "buyOrderId": t.BuyOrderID, "sellOrderId": t.SellOrderID,
		"aggressorSide": t.AggressorSide, "timestamp": t.Timestamp}
}

func stopEvent(typ string, o StopOrderSnapshot) Event {
	return Event{"type": typ, "symbol": o.Symbol, "orderId": o.OrderID, "userId": o.UserID,
		"side": o.Side, "orderType": o.Type, "triggerPriceTicks": o.TriggerPriceTicks,
		"priceTicks": o.PriceTicks, "trailingAmountTicks": o.TrailingAmountTicks,
		"peakPriceTicks": o.PeakPriceTicks, "valleyPriceTicks": o.ValleyPriceTicks,
		"quantity": o.Quantity, "remainingQuantity": o.RemainingQuantity,
		"status": o.Status, "timestamp": o.Timestamp}
}

func bookUpdatedEvent(snapshot BookSnapshot, now int64) Event {
	return Event{"type": BookUpdated, "snapshot": snapshot, "timestamp": now}
}
