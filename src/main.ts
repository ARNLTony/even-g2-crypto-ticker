import "./styles.css";

import {
  CreateStartUpPageContainer,
  type EvenAppBridge,
  type EvenHubEvent,
  ImageContainerProperty,
  ImageRawDataUpdate,
  OsEventTypeList,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from "@evenrealities/even_hub_sdk";

import {
  CATALOG,
  QUOTE_LABEL,
  QUOTE_LOCALE,
  QUOTE_NAME,
  QUOTE_PAIR_SUFFIX,
  QUOTE_SYMBOL,
  pairFor,
  type Quote,
} from "./catalog";
import { fetchKlines, subscribeTicker, type Kline, type Tick } from "./binance";
import {
  formatPrice,
  liveCells,
  loadingCells,
  noDataCells,
  type Cells,
} from "./format";
import { loadQuote, loadWatchlist, saveQuote, saveWatchlist } from "./storage";
import { mountSettings, type SettingsState } from "./settings";
import { renderChartHalves } from "./chart";

const SCREEN_W = 576;
const SCREEN_H = 288;
const PADDING = 2;
const RENDER_INTERVAL_MS = 1000;
const PERIODIC_REFRESH_MS = 5_000;
const NO_DATA_THRESHOLD_MS = 10_000;
const STALE_THRESHOLD_MS = 30_000;
const EMPTY_MESSAGE = "No coins selected. Open the app to add some.";

const COL_SYMBOL_X = 0;
const COL_SYMBOL_W = 96;
const COL_PRICE_X = 96;
const COL_PRICE_W = 160;
const COL_CHANGE_X = 256;
const COL_CHANGE_W = SCREEN_W - COL_CHANGE_X;
const COL_LIST_H = 268;

const FOOTER_IMG_W = 288;
const FOOTER_IMG_H = 20;
const FOOTER_IMG_X = Math.floor((SCREEN_W - FOOTER_IMG_W) / 2);
const FOOTER_IMG_Y = SCREEN_H - FOOTER_IMG_H;

const CID_SYMBOL = 1;
const CID_PRICE = 2;
const CID_CHANGE = 3;
const CID_LIST_FOOTER = 4;
const CID_EMPTY = 1;

const CID_DETAIL_INFO = 1;
const CID_DETAIL_TABS = 2;
const CID_DETAIL_CHART_LEFT = 3;
const CID_DETAIL_CHART_RIGHT = 4;

const INFO_X = 0;
const INFO_Y = 0;
const INFO_W = 388;
const INFO_H = 144;

const TABS_X = 396;
const TABS_Y = 0;
const TABS_W = 180;
const TABS_H = 144;

const CHART_HALF_W = 288;
const CHART_TOTAL_W = CHART_HALF_W * 2;
const CHART_H = 144;
const CHART_Y = 144;

type Range = "24h" | "1W" | "1M" | "1Y" | "ALL";
const RANGES: Range[] = ["24h", "1W", "1M", "1Y", "ALL"];
const RANGE_PARAMS: Record<Range, { interval: string; limit: number }> = {
  "24h": { interval: "1h", limit: 24 },
  "1W": { interval: "4h", limit: 42 },
  "1M": { interval: "1d", limit: 30 },
  "1Y": { interval: "1w", limit: 52 },
  "ALL": { interval: "1M", limit: 120 },
};

function periodSuffix(range: Range, klines: Kline[] | null): string {
  if (range === "24h") return "24h";
  if (range === "1W") return "7d";
  if (range === "1M") return "30d";
  if (range === "1Y") return "1y";
  if (klines && klines.length > 0) {
    return `since ${new Date(klines[0].openTime).getFullYear()}`;
  }
  return "all";
}

type Mode = "list" | "detail";
type Cached = { tick: Tick; ts: number };

let bridge: EvenAppBridge | null = null;
let bridgeReady = false;
let refreshIntervalId: ReturnType<typeof setInterval> | null = null;
let watchlist: string[] = [];
let quote: Quote = "USDT";
let selectedIndex = 0;
let mode: Mode = "list";
let detailRange: Range = "24h";
let currentKlines: Kline[] | null = null;
let klinesFetchToken = 0;
let unsubscribeWS: (() => void) | null = null;
const latest = new Map<string, Cached>();
const addedAt = new Map<string, number>();
let lastSymbolText = "";
let lastPriceText = "";
let lastChangeText = "";
let lastDetailInfoText = "";
let lastDetailTabsText = "";
let renderQueued = false;

// Single-flight chain for image pushes. The Display guide and SDK both forbid
// concurrent `updateImageRawData` calls; during mode transitions a stale klines
// fetch could otherwise race a `pushListFooter` rebuild. Every image push goes
// through `queueImagePush` so they execute strictly in order.
let imagePushChain: Promise<void> = Promise.resolve();
function queueImagePush(task: () => Promise<unknown>): Promise<void> {
  const next = imagePushChain.then(() => task().then(() => undefined));
  imagePushChain = next.catch(() => undefined);
  return next;
}

function symbolColumn(symbols: string[], idx: number): string {
  const PAD = "　";
  return symbols
    .map((s, i) => (i === idx ? `「${s}」` : `${PAD}${s}${PAD}`))
    .join("\n");
}

function emptyContainer(): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: SCREEN_W,
    height: SCREEN_H,
    borderWidth: 0,
    paddingLength: PADDING,
    containerID: CID_EMPTY,
    containerName: "empty",
    isEventCapture: 1,
    content: EMPTY_MESSAGE,
  });
}

function columnContainers(symbols: string[]): {
  text: TextContainerProperty[];
  image: ImageContainerProperty[];
} {
  const initial = symbols.map(() => loadingCells());
  const symbolText = symbolColumn(symbols, 0);
  const priceText = initial.map((c) => c.price).join("\n");
  const changeText = initial.map((c) => c.change).join("\n");

  const text: TextContainerProperty[] = [
    new TextContainerProperty({
      xPosition: COL_SYMBOL_X,
      yPosition: 0,
      width: COL_SYMBOL_W,
      height: COL_LIST_H,
      borderWidth: 0,
      paddingLength: PADDING,
      containerID: CID_SYMBOL,
      containerName: "symbols",
      isEventCapture: 1,
      content: symbolText,
    }),
    new TextContainerProperty({
      xPosition: COL_PRICE_X,
      yPosition: 0,
      width: COL_PRICE_W,
      height: COL_LIST_H,
      borderWidth: 0,
      paddingLength: PADDING,
      containerID: CID_PRICE,
      containerName: "prices",
      isEventCapture: 0,
      content: priceText,
    }),
    new TextContainerProperty({
      xPosition: COL_CHANGE_X,
      yPosition: 0,
      width: COL_CHANGE_W,
      height: COL_LIST_H,
      borderWidth: 0,
      paddingLength: PADDING,
      containerID: CID_CHANGE,
      containerName: "changes",
      isEventCapture: 0,
      content: changeText,
    }),
  ];

  const image: ImageContainerProperty[] = [
    new ImageContainerProperty({
      xPosition: FOOTER_IMG_X,
      yPosition: FOOTER_IMG_Y,
      width: FOOTER_IMG_W,
      height: FOOTER_IMG_H,
      containerID: CID_LIST_FOOTER,
      containerName: "list_footer",
    }),
  ];

  return { text, image };
}

function footerText(): string {
  return `${QUOTE_LABEL[quote]} ${QUOTE_NAME[quote]}  ·  Data from Binance`;
}

async function renderFooterImage(text: string): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = FOOTER_IMG_W;
  canvas.height = FOOTER_IMG_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new Uint8Array(0);

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, FOOTER_IMG_W, FOOTER_IMG_H);
  ctx.fillStyle = "#ffffff";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, FOOTER_IMG_W / 2, FOOTER_IMG_H / 2);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png")
  );
  if (!blob) return new Uint8Array(0);
  return new Uint8Array(await blob.arrayBuffer());
}

async function pushListFooter() {
  if (!bridge || !bridgeReady || mode !== "list") return;
  if (watchlist.length === 0) return;
  try {
    const bytes = await renderFooterImage(footerText());
    await queueImagePush(() =>
      bridge!.updateImageRawData(
        new ImageRawDataUpdate({
          containerID: CID_LIST_FOOTER,
          imageData: Array.from(bytes),
        })
      )
    );
  } catch (err) {
    console.error("pushListFooter failed:", err);
  }
}

function detailInfoText(
  symbol: string,
  klines: Kline[] | null,
  range: Range,
  locale: string,
  currencySymbol: string,
  now: number
): string {
  const coin = CATALOG.find((c) => c.symbol === symbol);
  const rawName = coin ? coin.name : symbol;
  // Truncate long coin names (e.g. "Ethereum Classic") so line 1 doesn't wrap
  // the info container. Symbol and price stay verbatim.
  const NAME_MAX = 12;
  const name =
    rawName.length > NAME_MAX ? rawName.slice(0, NAME_MAX - 1) + "…" : rawName;
  const entry = latest.get(symbol);

  let line1: string;
  if (entry) {
    const stale = now - entry.ts > STALE_THRESHOLD_MS;
    const price = formatPrice(entry.tick.price, locale, currencySymbol);
    line1 = `${symbol} ${name}  ${price}${stale ? " (stale)" : ""}`;
  } else {
    line1 = `${symbol} ${name}`;
  }

  let pct: number | null = null;
  if (range === "24h" && entry) {
    pct = entry.tick.change24hPct;
  } else if (klines && klines.length > 0) {
    const first = klines[0].open;
    const last = entry?.tick.price ?? klines[klines.length - 1].close;
    if (first !== 0) pct = ((last - first) / first) * 100;
  }

  let line2: string;
  if (pct !== null) {
    const arrow = pct >= 0 ? "▲" : "▼";
    const ch = Math.abs(pct).toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    line2 = `${arrow} ${ch}% ${periodSuffix(range, klines)}`;
  } else {
    line2 = "loading...";
  }

  let line3: string;
  let line4: string;
  if (klines && klines.length > 0) {
    let high = -Infinity;
    let low = Infinity;
    for (const k of klines) {
      if (k.high > high) high = k.high;
      if (k.low < low) low = k.low;
    }
    line3 = `H: ${formatPrice(high, locale, currencySymbol)}`;
    line4 = `L: ${formatPrice(low, locale, currencySymbol)}`;
  } else {
    line3 = "H: ...";
    line4 = "L: ...";
  }

  return [line1, line2, line3, line4].join("\n");
}

function tabsVertical(selected: Range): string {
  const PAD = "　";
  return RANGES.map((r) =>
    r === selected ? `「${r}」` : `${PAD}${r}${PAD}`
  ).join("\n");
}

function detailContainers(
  symbol: string,
  range: Range
): {
  text: TextContainerProperty[];
  image: ImageContainerProperty[];
} {
  const locale = QUOTE_LOCALE[quote];
  const currencySymbol = QUOTE_SYMBOL[quote];
  const text: TextContainerProperty[] = [
    new TextContainerProperty({
      xPosition: INFO_X,
      yPosition: INFO_Y,
      width: INFO_W,
      height: INFO_H,
      borderWidth: 0,
      paddingLength: PADDING,
      containerID: CID_DETAIL_INFO,
      containerName: "info",
      isEventCapture: 0,
      content: detailInfoText(
        symbol,
        currentKlines,
        range,
        locale,
        currencySymbol,
        Date.now()
      ),
    }),
    new TextContainerProperty({
      xPosition: TABS_X,
      yPosition: TABS_Y,
      width: TABS_W,
      height: TABS_H,
      borderWidth: 0,
      paddingLength: PADDING,
      containerID: CID_DETAIL_TABS,
      containerName: "tabs",
      isEventCapture: 1,
      content: tabsVertical(range),
    }),
  ];

  const image: ImageContainerProperty[] = [
    new ImageContainerProperty({
      xPosition: 0,
      yPosition: CHART_Y,
      width: CHART_HALF_W,
      height: CHART_H,
      containerID: CID_DETAIL_CHART_LEFT,
      containerName: "chart_left",
    }),
    new ImageContainerProperty({
      xPosition: CHART_HALF_W,
      yPosition: CHART_Y,
      width: CHART_HALF_W,
      height: CHART_H,
      containerID: CID_DETAIL_CHART_RIGHT,
      containerName: "chart_right",
    }),
  ];

  return { text, image };
}

function cellsFor(
  sym: string,
  now: number,
  locale: string,
  currencySymbol: string
): Cells {
  const entry = latest.get(sym);
  if (entry) {
    const stale = now - entry.ts > STALE_THRESHOLD_MS;
    return liveCells(
      entry.tick.price,
      entry.tick.change24hPct,
      stale,
      locale,
      currencySymbol
    );
  }
  const added = addedAt.get(sym) ?? now;
  if (now - added < NO_DATA_THRESHOLD_MS) return loadingCells();
  return noDataCells();
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(flushRender, RENDER_INTERVAL_MS);
}

async function flushRender() {
  renderQueued = false;
  if (!bridge || !bridgeReady) return;

  if (mode === "detail") {
    if (watchlist.length === 0) return;
    const symbol = watchlist[selectedIndex];
    const locale = QUOTE_LOCALE[quote];
    const currencySymbol = QUOTE_SYMBOL[quote];
    const content = detailInfoText(
      symbol,
      currentKlines,
      detailRange,
      locale,
      currencySymbol,
      Date.now()
    );
    if (content === lastDetailInfoText) return;
    lastDetailInfoText = content;
    try {
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: CID_DETAIL_INFO, content })
      );
    } catch (err) {
      console.error("detail info upgrade failed:", err);
    }
    return;
  }

  if (watchlist.length === 0) return;
  const now = Date.now();
  const locale = QUOTE_LOCALE[quote];
  const currencySymbol = QUOTE_SYMBOL[quote];
  const cells = watchlist.map((s) =>
    cellsFor(s, now, locale, currencySymbol)
  );
  const priceText = cells.map((c) => c.price).join("\n");
  const changeText = cells.map((c) => c.change).join("\n");

  if (priceText !== lastPriceText) {
    lastPriceText = priceText;
    try {
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: CID_PRICE, content: priceText })
      );
    } catch (err) {
      console.error("price upgrade failed:", err);
    }
  }

  if (changeText !== lastChangeText) {
    lastChangeText = changeText;
    try {
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: CID_CHANGE,
          content: changeText,
        })
      );
    } catch (err) {
      console.error("change upgrade failed:", err);
    }
  }
}

async function pushSymbolColumn() {
  if (!bridge || !bridgeReady || watchlist.length === 0) return;
  const content = symbolColumn(watchlist, selectedIndex);
  if (content === lastSymbolText) return;
  lastSymbolText = content;
  try {
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: CID_SYMBOL, content })
    );
  } catch (err) {
    console.error("symbol upgrade failed:", err);
  }
}

function moveSelection(delta: number) {
  if (watchlist.length === 0) return;
  const next = Math.max(
    0,
    Math.min(watchlist.length - 1, selectedIndex + delta)
  );
  if (next === selectedIndex) return;
  selectedIndex = next;
  pushSymbolColumn();
}

async function pushChart(klines: Kline[]) {
  if (!bridge || !bridgeReady || mode !== "detail") return;
  try {
    const locale = QUOTE_LOCALE[quote];
    const { left, right } = await renderChartHalves(
      klines,
      detailRange,
      CHART_TOTAL_W,
      CHART_H,
      locale,
      QUOTE_LABEL[quote]
    );
    await queueImagePush(() =>
      bridge!.updateImageRawData(
        new ImageRawDataUpdate({
          containerID: CID_DETAIL_CHART_LEFT,
          imageData: Array.from(left),
        })
      )
    );
    await queueImagePush(() =>
      bridge!.updateImageRawData(
        new ImageRawDataUpdate({
          containerID: CID_DETAIL_CHART_RIGHT,
          imageData: Array.from(right),
        })
      )
    );
  } catch (err) {
    console.error("pushChart failed:", err);
  }
}

async function loadKlinesForCurrent() {
  if (mode !== "detail" || watchlist.length === 0) return;
  const symbol = watchlist[selectedIndex];
  const range = detailRange;
  const myToken = ++klinesFetchToken;
  const params = RANGE_PARAMS[range];
  try {
    const klines = await fetchKlines(
      pairFor(symbol, quote),
      params.interval,
      params.limit
    );
    if (
      klinesFetchToken !== myToken ||
      mode !== "detail" ||
      watchlist[selectedIndex] !== symbol ||
      detailRange !== range
    ) {
      return;
    }
    currentKlines = klines;
    const locale = QUOTE_LOCALE[quote];
    const currencySymbol = QUOTE_SYMBOL[quote];
    const info = detailInfoText(
      symbol,
      klines,
      range,
      locale,
      currencySymbol,
      Date.now()
    );
    if (info !== lastDetailInfoText && bridge && bridgeReady) {
      lastDetailInfoText = info;
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: CID_DETAIL_INFO,
          content: info,
        })
      );
    }
    await pushChart(klines);
  } catch (err) {
    console.error("loadKlines failed:", err);
  }
}

async function rebuildDetail() {
  if (!bridge || !bridgeReady || watchlist.length === 0) return;
  const symbol = watchlist[selectedIndex];
  const { text, image } = detailContainers(symbol, detailRange);
  try {
    await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: text.length + image.length,
        textObject: text,
        imageObject: image,
      })
    );
    const locale = QUOTE_LOCALE[quote];
    const currencySymbol = QUOTE_SYMBOL[quote];
    lastDetailInfoText = detailInfoText(
      symbol,
      currentKlines,
      detailRange,
      locale,
      currencySymbol,
      Date.now()
    );
    lastDetailTabsText = tabsVertical(detailRange);
  } catch (err) {
    console.error("rebuildDetail failed:", err);
  }
  loadKlinesForCurrent();
}

async function enterDetail() {
  if (mode === "detail" || watchlist.length === 0) return;
  mode = "detail";
  detailRange = "24h";
  currentKlines = null;
  await rebuildDetail();
}

async function exitDetail() {
  if (mode !== "detail") return;
  mode = "list";
  klinesFetchToken++;
  currentKlines = null;
  lastDetailInfoText = "";
  lastDetailTabsText = "";
  await rebuildGlass(watchlist);
}

async function cycleRange(delta: number) {
  if (mode !== "detail") return;
  const i = RANGES.indexOf(detailRange);
  const next = RANGES[(i + delta + RANGES.length) % RANGES.length];
  if (next === detailRange) return;
  detailRange = next;
  currentKlines = null;

  const tabsContent = tabsVertical(detailRange);
  if (tabsContent !== lastDetailTabsText && bridge && bridgeReady) {
    lastDetailTabsText = tabsContent;
    try {
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: CID_DETAIL_TABS,
          content: tabsContent,
        })
      );
    } catch (err) {
      console.error("tabs upgrade failed:", err);
    }
  }

  if (bridge && bridgeReady && watchlist.length > 0) {
    const symbol = watchlist[selectedIndex];
    const locale = QUOTE_LOCALE[quote];
    const currencySymbol = QUOTE_SYMBOL[quote];
    const info = detailInfoText(
      symbol,
      null,
      detailRange,
      locale,
      currencySymbol,
      Date.now()
    );
    if (info !== lastDetailInfoText) {
      lastDetailInfoText = info;
      try {
        await bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: CID_DETAIL_INFO,
            content: info,
          })
        );
      } catch (err) {
        console.error("info reset upgrade failed:", err);
      }
    }
  }

  loadKlinesForCurrent();
}

function extractEventType(event: EvenHubEvent): number | undefined {
  const explicit =
    event.textEvent?.eventType ??
    event.sysEvent?.eventType ??
    event.listEvent?.eventType;
  if (explicit !== undefined) return explicit;
  // Protobuf zero-value omission: eventType=0 (CLICK_EVENT) gets stripped from JSON.
  // If any event channel is present without eventType, treat as CLICK_EVENT.
  if (event.sysEvent || event.textEvent || event.listEvent) {
    return OsEventTypeList.CLICK_EVENT;
  }
  return undefined;
}

function pauseForBackground() {
  if (unsubscribeWS) {
    unsubscribeWS();
    unsubscribeWS = null;
  }
  stopRefreshInterval();
}

function resumeFromBackground() {
  resubscribe(watchlist, quote);
  startRefreshInterval();
}

function startRefreshInterval() {
  if (refreshIntervalId !== null) return;
  refreshIntervalId = setInterval(scheduleRender, PERIODIC_REFRESH_MS);
}

function stopRefreshInterval() {
  if (refreshIntervalId === null) return;
  clearInterval(refreshIntervalId);
  refreshIntervalId = null;
}

function handleGlassEvent(event: EvenHubEvent) {
  const t = extractEventType(event);
  if (t === undefined) return;
  console.log("[glass event]", { mode, type: t });

  // Lifecycle events fire regardless of mode — pause/resume work on background.
  switch (t) {
    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
      pauseForBackground();
      return;
    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      resumeFromBackground();
      return;
  }

  if (mode === "list") {
    switch (t) {
      case OsEventTypeList.SCROLL_TOP_EVENT:
        moveSelection(-1);
        break;
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        moveSelection(1);
        break;
      case OsEventTypeList.CLICK_EVENT:
        enterDetail().catch((err) =>
          console.error("enterDetail failed:", err)
        );
        break;
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        // Root-page exit per Even Hub UX guidelines:
        // shutDownPageContainer(1) shows the host's exit-confirm dialog.
        bridge
          ?.shutDownPageContainer(1)
          .catch((err) =>
            console.error("shutDownPageContainer failed:", err)
          );
        break;
    }
    return;
  }

  switch (t) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      cycleRange(-1).catch((err) => console.error("cycleRange failed:", err));
      break;
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      cycleRange(1).catch((err) => console.error("cycleRange failed:", err));
      break;
    case OsEventTypeList.CLICK_EVENT:
      // Single-tap advances to the next range, mirroring the typical G2 app
      // convention. (Up/Down still cycle in either direction.)
      cycleRange(1).catch((err) => console.error("cycleRange failed:", err));
      break;
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      exitDetail().catch((err) => console.error("exitDetail failed:", err));
      break;
  }
}

function resubscribe(symbols: string[], q: Quote) {
  if (unsubscribeWS) {
    unsubscribeWS();
    unsubscribeWS = null;
  }

  const now = Date.now();
  const set = new Set(symbols);

  for (const sym of symbols) {
    if (!addedAt.has(sym)) addedAt.set(sym, now);
  }
  for (const sym of [...addedAt.keys()]) {
    if (!set.has(sym)) {
      addedAt.delete(sym);
      latest.delete(sym);
    }
  }
  lastPriceText = "";
  lastChangeText = "";

  if (symbols.length === 0) return;

  const pairs = symbols.map((s) => pairFor(s, q));

  unsubscribeWS = subscribeTicker(pairs, QUOTE_PAIR_SUFFIX[q], (tick) => {
    latest.set(tick.symbol, { tick, ts: Date.now() });
    scheduleRender();
  });
}

async function rebuildGlass(symbols: string[]) {
  if (!bridge || !bridgeReady) return;
  try {
    if (symbols.length === 0) {
      await bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 1,
          textObject: [emptyContainer()],
        })
      );
      selectedIndex = 0;
      lastSymbolText = "";
      return;
    }
    const { text, image } = columnContainers(symbols);
    await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: text.length + image.length,
        textObject: text,
        imageObject: image,
      })
    );
    selectedIndex = 0;
    lastSymbolText = symbolColumn(symbols, 0);
    pushListFooter();
  } catch (err) {
    console.error("rebuildPageContainer failed:", err);
  }
}

function sameArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function applyState(next: SettingsState) {
  const wlChanged = !sameArray(watchlist, next.watchlist);
  const qChanged = quote !== next.quote;
  if (!wlChanged && !qChanged) return;

  if (wlChanged) {
    watchlist = [...next.watchlist];
    saveWatchlist(watchlist);
  }
  if (qChanged) {
    quote = next.quote;
    saveQuote(quote);
    latest.clear();
    addedAt.clear();
  }

  resubscribe(watchlist, quote);

  if (mode === "detail") {
    if (watchlist.length === 0) {
      mode = "list";
      currentKlines = null;
      await rebuildGlass(watchlist);
    } else {
      if (selectedIndex >= watchlist.length) selectedIndex = 0;
      currentKlines = null;
      await rebuildDetail();
    }
  } else {
    await rebuildGlass(watchlist);
  }
}

function fallbackContainer(message: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: SCREEN_W,
    height: SCREEN_H,
    borderWidth: 0,
    paddingLength: PADDING,
    containerID: CID_EMPTY,
    containerName: "fallback",
    isEventCapture: 1,
    content: message,
  });
}

async function bootGlass() {
  bridge = await waitForEvenAppBridge();
  let result: StartUpPageCreateResult;
  if (watchlist.length === 0) {
    result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [emptyContainer()],
      })
    );
  } else {
    const { text, image } = columnContainers(watchlist);
    result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: text.length + image.length,
        textObject: text,
        imageObject: image,
      })
    );
  }

  if (result !== StartUpPageCreateResult.success) {
    // Hard fail-open: log the documented status code and replace the page
    // with a single-text container so the user sees something rather than a
    // blank screen. We still mark the bridge ready so subsequent rebuilds
    // (e.g. from settings changes) can run.
    console.error(
      "createStartUpPageContainer returned non-success code:",
      result
    );
    const message = `App could not start (code ${result}). Try restarting.`;
    try {
      await bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 1,
          textObject: [fallbackContainer(message)],
        })
      );
    } catch (err) {
      console.error("fallback rebuildPageContainer failed:", err);
    }
    bridgeReady = true;
    bridge.onEvenHubEvent(handleGlassEvent);
    return;
  }

  bridgeReady = true;
  selectedIndex = 0;
  lastSymbolText =
    watchlist.length === 0 ? "" : symbolColumn(watchlist, 0);

  bridge.onEvenHubEvent(handleGlassEvent);
  scheduleRender();
  pushListFooter();
}

function bootSettings() {
  const root = document.getElementById("app");
  if (!root) return;
  mountSettings(
    root,
    { watchlist, quote },
    {
      onChange: (next) => {
        applyState(next).catch((err) =>
          console.error("applyState failed:", err)
        );
      },
    }
  );
}

watchlist = loadWatchlist();
quote = loadQuote();
bootSettings();
resubscribe(watchlist, quote);
bootGlass().catch((err) => console.error("bridge boot failed:", err));
startRefreshInterval();
