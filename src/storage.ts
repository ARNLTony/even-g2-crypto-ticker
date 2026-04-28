import {
  DEFAULT_QUOTE,
  DEFAULT_WATCHLIST,
  MAX_COINS,
  QUOTES,
  VALID_SYMBOLS,
  type Quote,
} from "./catalog";

const KEY_WATCHLIST = "ticker.watchlist";
const KEY_QUOTE = "ticker.quote";

export function loadWatchlist(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY_WATCHLIST);
    if (!raw) return [...DEFAULT_WATCHLIST];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const filtered = parsed.filter(
        (s): s is string => typeof s === "string" && VALID_SYMBOLS.has(s)
      );
      if (filtered.length > 0) return filtered.slice(0, MAX_COINS);
    }
  } catch {
    // fall through
  }
  return [...DEFAULT_WATCHLIST];
}

export function saveWatchlist(list: string[]): void {
  window.localStorage.setItem(
    KEY_WATCHLIST,
    JSON.stringify(list.slice(0, MAX_COINS))
  );
}

export function loadQuote(): Quote {
  const raw = window.localStorage.getItem(KEY_QUOTE);
  if (raw && (QUOTES as string[]).includes(raw)) return raw as Quote;
  return DEFAULT_QUOTE;
}

export function saveQuote(quote: Quote): void {
  window.localStorage.setItem(KEY_QUOTE, quote);
}
