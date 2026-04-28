export type Coin = {
  symbol: string;
  name: string;
};

export type Quote =
  | "USD"
  | "EUR"
  | "ARS"
  | "JPY"
  | "TRY"
  | "BRL"
  | "PLN"
  | "USDT"
  | "USDC"
  | "FDUSD";

export const FIAT_QUOTES: Quote[] = [
  "USD",
  "EUR",
  "ARS",
  "JPY",
  "TRY",
  "BRL",
  "PLN",
];
export const STABLECOIN_QUOTES: Quote[] = ["USDT", "USDC", "FDUSD"];

export const QUOTES: Quote[] = [...FIAT_QUOTES, ...STABLECOIN_QUOTES];

export const QUOTE_LABEL: Record<Quote, string> = {
  USD: "USD",
  EUR: "EUR",
  ARS: "ARS",
  JPY: "JPY",
  TRY: "TRY",
  BRL: "BRL",
  PLN: "PLN",
  USDT: "USDT",
  USDC: "USDC",
  FDUSD: "FDUSD",
};

export const QUOTE_NAME: Record<Quote, string> = {
  USD: "US Dollar",
  EUR: "Euro",
  ARS: "Argentine Peso",
  JPY: "Japanese Yen",
  TRY: "Turkish Lira",
  BRL: "Brazilian Real",
  PLN: "Polish Złoty",
  USDT: "Tether USD",
  USDC: "USD Coin",
  FDUSD: "First Digital USD",
};

export const QUOTE_LOCALE: Record<Quote, string> = {
  USD: "en-US",
  EUR: "de-DE",
  ARS: "es-AR",
  JPY: "ja-JP",
  TRY: "tr-TR",
  BRL: "pt-BR",
  PLN: "pl-PL",
  USDT: "en-US",
  USDC: "en-US",
  FDUSD: "en-US",
};

export const QUOTE_SYMBOL: Record<Quote, string> = {
  USD: "",
  EUR: "",
  ARS: "",
  JPY: "",
  TRY: "",
  BRL: "",
  PLN: "",
  USDT: "",
  USDC: "",
  FDUSD: "",
};

// Binance pair suffix — USD is a display alias for USDT pairs since Binance
// has no native BTCUSD spot pair.
export const QUOTE_PAIR_SUFFIX: Record<Quote, string> = {
  USD: "USDT",
  EUR: "EUR",
  ARS: "ARS",
  JPY: "JPY",
  TRY: "TRY",
  BRL: "BRL",
  PLN: "PLN",
  USDT: "USDT",
  USDC: "USDC",
  FDUSD: "FDUSD",
};

export const DEFAULT_QUOTE: Quote = "USD";

export const MAX_COINS = 9;

export const DEFAULT_WATCHLIST = [
  "BTC",
  "ETH",
  "BNB",
  "SOL",
  "ADA",
  "DOGE",
  "ATOM",
  "POL",
  "XRP",
];

export const CATALOG: Coin[] = [
  { symbol: "BTC", name: "Bitcoin" },
  { symbol: "ETH", name: "Ethereum" },
  { symbol: "BNB", name: "BNB" },
  { symbol: "SOL", name: "Solana" },
  { symbol: "XRP", name: "XRP" },
  { symbol: "ADA", name: "Cardano" },
  { symbol: "DOGE", name: "Dogecoin" },
  { symbol: "AVAX", name: "Avalanche" },
  { symbol: "ATOM", name: "Cosmos" },
  { symbol: "DOT", name: "Polkadot" },
  { symbol: "POL", name: "Polygon" },
  { symbol: "LINK", name: "Chainlink" },
  { symbol: "UNI", name: "Uniswap" },
  { symbol: "LTC", name: "Litecoin" },
  { symbol: "BCH", name: "Bitcoin Cash" },
  { symbol: "NEAR", name: "Near" },
  { symbol: "APT", name: "Aptos" },
  { symbol: "ARB", name: "Arbitrum" },
  { symbol: "OP", name: "Optimism" },
  { symbol: "SUI", name: "Sui" },
  { symbol: "INJ", name: "Injective" },
  { symbol: "SEI", name: "Sei" },
  { symbol: "TIA", name: "Celestia" },
  { symbol: "RNDR", name: "Render" },
  { symbol: "FIL", name: "Filecoin" },
  { symbol: "TRX", name: "Tron" },
  { symbol: "XLM", name: "Stellar" },
  { symbol: "AAVE", name: "Aave" },
  { symbol: "MKR", name: "Maker" },
  { symbol: "ETC", name: "Ethereum Classic" },
];

export const VALID_SYMBOLS = new Set(CATALOG.map((c) => c.symbol));

export function pairFor(symbol: string, quote: Quote): string {
  return `${symbol}${QUOTE_PAIR_SUFFIX[quote]}`;
}
