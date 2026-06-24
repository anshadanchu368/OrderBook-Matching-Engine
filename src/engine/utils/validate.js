import { isValidSide } from "../constants.js";


const assert = (conditon, message) =>  {
    if(!conditon) throw new Error(message);
}

export function validateOrderInput({orderId, userId, symbol, side, price, quantity}){
    assert(orderId, "orderId is required");
    assert(userId, "userId is required");
    assert(symbol, "symbol is required");
    assert(isValidSide(side), "side is required");
    assert(Number.isFinite(price) && price > 0, "price must be a positive number");
    assert(Number.isInteger(quantity) && quantity > 0, "quantity must be a positive integer");
}