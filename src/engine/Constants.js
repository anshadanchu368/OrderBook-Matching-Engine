export const Side =Object.freeze({
    BUY:"BUY",
    SELL:"SELL"
})

export const OrderType = Object.freeze({
    LIMIT:"LIMIT",
    MARKET:"MARKET",
    STOP_MARKET:"STOP_MARKET",
    STOP_LIMIT:"STOP_LIMIT",
    TRAILING_STOP_MARKET: "TRAILING_STOP_MARKET",
})

export const OrderStatus = Object.freeze({
    OPEN:"OPEN",
    PARTIALLY_FILLED:"PARTIALLY_FILLED",
    FILLED:"FILLED",
    CANCELLED:"CANCELLED",
    TRIGGERED:"TRIGGERED",
    TRAILING_STOP_MARKET: "TRAILING_STOP_MARKET",
})

const VALID_SIDES = new Set(Object.values(Side));
const VALID_ORDER_TYPES = new Set(Object.values(OrderType));
const VALID_ORDER_STATUSES = new Set(Object.values(OrderStatus));

export function isValidSide(side){
    return VALID_SIDES.has(side)
}  

export function isValidOrderType(orderType){
    return VALID_ORDER_TYPES.has(orderType)
}

export function isValidOrderStatus(orderStatus){
    return VALID_ORDER_STATUSES.has(orderStatus)
}
