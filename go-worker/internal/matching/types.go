package matching

type Side string

const (
	Buy  Side = "BUY"
	Sell Side = "SELL"
)

type OrderType string

const (
	Limit              OrderType = "LIMIT"
	Market             OrderType = "MARKET"
	StopMarket         OrderType = "STOP_MARKET"
	StopLimit          OrderType = "STOP_LIMIT"
	TrailingStopMarket OrderType = "TRAILING_STOP_MARKET"
)

type OrderStatus string

const (
	Open            OrderStatus = "OPEN"
	PartiallyFilled OrderStatus = "PARTIALLY_FILLED"
	Filled          OrderStatus = "FILLED"
	Cancelled       OrderStatus = "CANCELLED"
	Triggered       OrderStatus = "TRIGGERED"
)

type OrderInput struct {
	OrderID             string `json:"orderId"`
	UserID              string `json:"userId"`
	Side                Side   `json:"side"`
	PriceTicks          *int64 `json:"priceTicks,omitempty"`
	TriggerPriceTicks   *int64 `json:"triggerPriceTicks,omitempty"`
	TrailingAmountTicks *int64 `json:"trailingAmountTicks,omitempty"`
	Quantity            int64  `json:"quantity"`
	Timestamp           int64  `json:"timestamp"`
}

type OrderSnapshot struct {
	OrderID           string      `json:"orderId"`
	UserID            string      `json:"userId"`
	Symbol            string      `json:"symbol"`
	Side              Side        `json:"side"`
	Type              OrderType   `json:"type"`
	PriceTicks        *int64      `json:"priceTicks"`
	InitialQuantity   int64       `json:"initialQuantity"`
	RemainingQuantity int64       `json:"remainingQuantity"`
	FilledQuantity    int64       `json:"filledQuantity"`
	Status            OrderStatus `json:"status"`
	Timestamp         int64       `json:"timestamp"`
}

type StopOrderSnapshot struct {
	OrderID             string      `json:"orderId"`
	UserID              string      `json:"userId"`
	Symbol              string      `json:"symbol"`
	Side                Side        `json:"side"`
	Type                OrderType   `json:"type"`
	TriggerPriceTicks   int64       `json:"triggerPriceTicks"`
	PriceTicks          *int64      `json:"priceTicks"`
	TrailingAmountTicks *int64      `json:"trailingAmountTicks"`
	PeakPriceTicks      *int64      `json:"peakPriceTicks"`
	ValleyPriceTicks    *int64      `json:"valleyPriceTicks"`
	Quantity            int64       `json:"quantity"`
	RemainingQuantity   int64       `json:"remainingQuantity"`
	Status              OrderStatus `json:"status"`
	Timestamp           int64       `json:"timestamp"`
}

type Trade struct {
	Symbol        string `json:"symbol"`
	PriceTicks    int64  `json:"priceTicks"`
	Quantity      int64  `json:"quantity"`
	BuyOrderID    string `json:"buyOrderId"`
	SellOrderID   string `json:"sellOrderId"`
	AggressorSide Side   `json:"aggressorSide"`
	Timestamp     int64  `json:"timestamp"`
}

type PriceLevelSnapshot struct {
	PriceTicks    int64   `json:"priceTicks"`
	TotalQuantity int64   `json:"totalQuantity"`
	OrderCount    int     `json:"orderCount"`
	HeadOrderID   *string `json:"headOrderId"`
	TailOrderID   *string `json:"tailOrderId"`
}

type BookSnapshot struct {
	Symbol              string               `json:"symbol"`
	Sequence            int64                `json:"sequence"`
	BestBidPriceTicks   *int64               `json:"bestBidPriceTicks"`
	BestAskPriceTicks   *int64               `json:"bestAskPriceTicks"`
	LastTradePriceTicks *int64               `json:"lastTradePriceTicks"`
	StopOrders          []StopOrderSnapshot  `json:"stopOrders"`
	Bids                []PriceLevelSnapshot `json:"bids"`
	Asks                []PriceLevelSnapshot `json:"asks"`
}

type RecoveryPriceLevel struct {
	PriceTicks    int64           `json:"priceTicks"`
	TotalQuantity int64           `json:"totalQuantity"`
	OrderCount    int             `json:"orderCount"`
	Orders        []OrderSnapshot `json:"orders"`
}

type RecoverySnapshot struct {
	Symbol              string               `json:"symbol"`
	Sequence            int64                `json:"sequence"`
	LastTradePriceTicks *int64               `json:"lastTradePriceTicks"`
	LastCommandStreamID *string              `json:"lastCommandStreamId"`
	Bids                []RecoveryPriceLevel `json:"bids"`
	Asks                []RecoveryPriceLevel `json:"asks"`
	StopOrders          []StopOrderSnapshot  `json:"stopOrders"`
}

type Event map[string]any

type Result struct {
	Order           any
	Trades          []Trade
	TriggeredOrders []StopOrderSnapshot
	Events          []Event
}
