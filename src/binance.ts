export type Tick = {
  symbol: string;
  price: number;
  change24hPct: number;
};

export type Kline = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export async function fetchKlines(
  pair: string,
  interval: string,
  limit: number
): Promise<Kline[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`klines ${pair} ${interval}: HTTP ${res.status}`);
  const json = (await res.json()) as unknown;
  if (!Array.isArray(json)) throw new Error("klines: malformed response");
  return json.map((row) => {
    const arr = row as unknown[];
    return {
      openTime: Number(arr[0]),
      open: parseFloat(arr[1] as string),
      high: parseFloat(arr[2] as string),
      low: parseFloat(arr[3] as string),
      close: parseFloat(arr[4] as string),
    };
  });
}

export type WsStatus = "connecting" | "open" | "closed";

export function subscribeTicker(
  pairs: string[],
  quote: string,
  onTick: (tick: Tick) => void,
  onStatus?: (status: WsStatus) => void
): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let backoff = 1000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const streams = pairs.map((s) => `${s.toLowerCase()}@ticker`).join("/");
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
  const quoteUpper = quote.toUpperCase();

  function stripQuote(pair: string): string {
    return pair.endsWith(quoteUpper)
      ? pair.slice(0, -quoteUpper.length)
      : pair;
  }

  function connect() {
    if (stopped) return;
    onStatus?.("connecting");
    ws = new WebSocket(url);

    ws.onopen = () => {
      backoff = 1000;
      onStatus?.("open");
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        const d = msg?.data;
        if (!d || typeof d.s !== "string") return;
        onTick({
          symbol: stripQuote(d.s),
          price: parseFloat(d.c),
          change24hPct: parseFloat(d.P),
        });
      } catch {
        // Ignore malformed frames
      }
    };

    ws.onclose = () => {
      onStatus?.("closed");
      if (stopped) return;
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    };

    ws.onerror = () => ws?.close();
  }

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}
