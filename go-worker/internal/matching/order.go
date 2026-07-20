package matching

import "fmt"

type order struct {
	orderID           string
	userID            string
	symbol            string
	side              Side
	typ               OrderType
	priceTicks        *int64
	initialQuantity   int64
	remainingQuantity int64
	status            OrderStatus
	timestamp         int64
}

func newOrder(symbol string, typ OrderType, input OrderInput) (*order, error) {
	if input.OrderID == "" {
		return nil, fmt.Errorf("orderId must be a non-empty string")
	}
	if input.UserID == "" {
		return nil, fmt.Errorf("userId must be a non-empty string")
	}
	if symbol == "" {
		return nil, fmt.Errorf("symbol must be a non-empty string")
	}
	if input.Side != Buy && input.Side != Sell {
		return nil, fmt.Errorf("invalid order side: %s", input.Side)
	}
	if input.Quantity <= 0 {
		return nil, fmt.Errorf("quantity must be a positive integer")
	}
	if input.Timestamp < 0 {
		return nil, fmt.Errorf("timestamp must be a non-negative integer")
	}
	if typ == Limit && (input.PriceTicks == nil || *input.PriceTicks <= 0) {
		return nil, fmt.Errorf("priceTicks must be a positive integer")
	}
	if typ == Market && input.PriceTicks != nil {
		return nil, fmt.Errorf("market order price must be null or undefined")
	}

	return &order{
		orderID: input.OrderID, userID: input.UserID, symbol: symbol,
		side: input.Side, typ: typ, priceTicks: cloneInt64(input.PriceTicks),
		initialQuantity: input.Quantity, remainingQuantity: input.Quantity,
		status: Open, timestamp: input.Timestamp,
	}, nil
}

func (o *order) active() bool { return o.status != Filled && o.status != Cancelled }

func (o *order) fill(quantity int64) error {
	if quantity <= 0 {
		return fmt.Errorf("fill quantity must be a positive integer")
	}
	if !o.active() {
		return fmt.Errorf("order %s is already %s", o.orderID, o.status)
	}
	if quantity > o.remainingQuantity {
		return fmt.Errorf("fill quantity exceeds remaining quantity")
	}
	o.remainingQuantity -= quantity
	if o.remainingQuantity == 0 {
		o.status = Filled
	} else {
		o.status = PartiallyFilled
	}
	return nil
}

func (o *order) cancel() error {
	if !o.active() {
		return fmt.Errorf("order %s is already %s", o.orderID, o.status)
	}
	o.status = Cancelled
	return nil
}

func (o *order) snapshot() OrderSnapshot {
	return OrderSnapshot{
		OrderID: o.orderID, UserID: o.userID, Symbol: o.symbol, Side: o.side,
		Type: o.typ, PriceTicks: cloneInt64(o.priceTicks), InitialQuantity: o.initialQuantity,
		RemainingQuantity: o.remainingQuantity, FilledQuantity: o.initialQuantity - o.remainingQuantity,
		Status: o.status, Timestamp: o.timestamp,
	}
}

type priceLevel struct {
	priceTicks    int64
	totalQuantity int64
	orders        []*order
}

func (l *priceLevel) append(o *order) {
	l.orders = append(l.orders, o)
	l.totalQuantity += o.remainingQuantity
}

func (l *priceLevel) remove(o *order) {
	for i, candidate := range l.orders {
		if candidate == o {
			l.totalQuantity -= o.remainingQuantity
			l.orders = append(l.orders[:i], l.orders[i+1:]...)
			return
		}
	}
}

func (l *priceLevel) snapshot() PriceLevelSnapshot {
	var head, tail *string
	if len(l.orders) > 0 {
		head = stringPtr(l.orders[0].orderID)
		tail = stringPtr(l.orders[len(l.orders)-1].orderID)
	}
	return PriceLevelSnapshot{l.priceTicks, l.totalQuantity, len(l.orders), head, tail}
}

func cloneInt64(value *int64) *int64 {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func int64Ptr(value int64) *int64    { return &value }
func stringPtr(value string) *string { return &value }
