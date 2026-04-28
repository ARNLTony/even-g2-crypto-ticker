const PRICE_CELL_WIDTH = 9;

export type Cells = {
  price: string;
  change: string;
};

export function formatPrice(
  price: number,
  locale: string,
  symbol = ""
): string {
  let digits: number;
  if (price >= 1) digits = 2;
  else if (price >= 0.01) digits = 4;
  else digits = 6;
  const num = price.toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${symbol}${num}`;
}

function padPrice(str: string): string {
  return str.padStart(PRICE_CELL_WIDTH, " ");
}

export function liveCells(
  price: number,
  change24hPct: number,
  stale: boolean,
  locale: string,
  symbol = ""
): Cells {
  const arrow = change24hPct >= 0 ? "▲" : "▼";
  const num = Math.abs(change24hPct)
    .toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .padStart(5, " ");
  return {
    price: padPrice(formatPrice(price, locale, symbol)),
    change: `${arrow} ${num}%${stale ? " *" : ""}`,
  };
}

export function loadingCells(): Cells {
  return { price: padPrice("..."), change: "" };
}

export function noDataCells(): Cells {
  return { price: padPrice("—"), change: "no data" };
}
