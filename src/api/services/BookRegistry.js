import { OrderBook } from "../../engine/OrderBook.js";

export class BookRegistry {
  constructor() {
    this.booksBySymbol = new Map();
  }

  getOrCreateBook(symbol) {
    this.validateSymbol(symbol);

    if (!this.booksBySymbol.has(symbol)) {
      this.booksBySymbol.set(symbol, new OrderBook(symbol));
    }

    return this.booksBySymbol.get(symbol);
  }

  getBook(symbol) {
    this.validateSymbol(symbol);

    return this.booksBySymbol.get(symbol) ?? null;
  }

  listSymbols() {
    return [...this.booksBySymbol.keys()];
  }

  validateSymbol(symbol) {
    if (typeof symbol !== "string" || symbol.trim() === "") {
      throw new Error("symbol must be a non-empty string");
    }
  }

  reset() {
  this.booksBySymbol.clear();
}
}

export const bookRegistry = new BookRegistry();