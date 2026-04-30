import "./styles.css";

import {
  CreateStartUpPageContainer,
  type EvenAppBridge,
  type EvenHubEvent,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ListContainerProperty,
  ListItemContainerProperty,
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
  QUOTE_PAIR_SUFFIX,
  QUOTE_SYMBOL,
  pairFor,
  type Quote,
} from "./catalog";
import { fetchKlines, subscribeTicker, type Kline, type Tick } from "./binance";
import {
  formatPrice,
  formatPriceAxis,
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
// List page rebuild cadence — rebuilds reset the LVGL list's selection to
// index 0, so we keep this slow enough to feel non-jarring while still
// surfacing fresh prices when the user is idle on the watchlist.
const LIST_REBUILD_INTERVAL_MS = 10_000;
const NO_DATA_THRESHOLD_MS = 10_000;
const STALE_THRESHOLD_MS = 30_000;
const EMPTY_MESSAGE = "No coins selected. Open the app to add some.";

// The root list page is a single ListContainer. Reviewer feedback (Even Hub
// portal) confirmed text containers consume LVGL input events even with
// scrollable=0/isEventCapture=0, which blocks the page-level double-tap exit
// dialog. ListContainer is the SDK's intended navigation primitive — it
// reports selection via List_ItemEvent.currentSelectItemIndex and properly
// bubbles DOUBLE_CLICK_EVENT to the page so shutDownPageContainer(1) fires.
const LIST_X = 0;
const LIST_Y = 0;
const LIST_W = SCREEN_W;
// LVGL adds a few px of padding around each list item; with 9 items at the
// firmware's natural row height, taking the full screen height makes the
// startup-page validator return code 1 (invalid). 252 leaves enough margin.
const LIST_H = 252;

const CID_LIST = 1;
const CID_EMPTY = 1;

const CID_DETAIL_INFO = 1;
const CID_DETAIL_TABS = 2;
const CID_DETAIL_CHART_LEFT = 3;
const CID_DETAIL_CHART_RIGHT = 4;
const CID_DETAIL_YMAX = 5;
const CID_DETAIL_YMIN = 6;
const CID_DETAIL_XLEFT = 7;
const CID_DETAIL_XRIGHT = 8;

const INFO_X = 0;
const INFO_Y = 0;
const INFO_W = 388;
const INFO_H = 144;

const TABS_X = 396;
const TABS_Y = 0;
const TABS_W = 180;
const TABS_H = 144;

// Two chart image halves sit side-by-side starting at x=0. The right
// 100px strip of the screen is left uncovered for LVGL Y-axis labels —
// LVGL text rendered behind an image container is hidden by the image,
// so the labels MUST live outside any image's bounds. A 30px row is
// also reserved BELOW the chart for X-axis labels.
const AXIS_LBL_W = 176;
const AXIS_LBL_H = 30;
const CHART_TOTAL_W = SCREEN_W - AXIS_LBL_W; // 400
const CHART_HALF_W = CHART_TOTAL_W / 2;       // 200
const CHART_H = 114;                          // 144 - 30 (x-axis row below)
const CHART_Y = 144;
const AXIS_LBL_X = CHART_TOTAL_W;
const AXIS_LBL_TOP_Y = CHART_Y;
const AXIS_LBL_BOT_Y = CHART_Y + CHART_H - AXIS_LBL_H;
const X_AXIS_Y = CHART_Y + CHART_H;           // 258
const X_AXIS_H = AXIS_LBL_H;                  // 30
const X_LEFT_X = 4;
const X_LEFT_W = 160;
// "now" should end right under the chart's vertical right axis. The axis lives
// at canvas x = CHART_TOTAL_W - 8 (chart.ts uses PAD=8). LVGL is left-aligned
// only, so we position the container so its content starts at axis - text width.
const NOW_TEXT_W = 50;             // measured visually for the LVGL embedded font
const CHART_RIGHT_AXIS_X = CHART_TOTAL_W - 8;
const X_RIGHT_X = CHART_RIGHT_AXIS_X - NOW_TEXT_W;
const X_RIGHT_W = NOW_TEXT_W;

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

function xAxisLeftLabel(range: Range, klines: Kline[] | null): string {
  if (range === "24h") return "-24h";
  if (range === "1W") return "-7d";
  if (range === "1M") return "-30d";
  if (range === "1Y") return "-1y";
  if (klines && klines.length > 0) {
    return `${new Date(klines[0].openTime).getFullYear()}`;
  }
  return "";
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
let lastListItems: string[] = [];
let listRebuildPending = false;
let listRebuildInFlight = false;
let lastListInteractionTs = 0;
let lastDetailInfoText = "";
let lastYMaxText = "";
let lastYMinText = "";
let lastXLeftText = "";
let lastDetailTabsText = "";
let renderQueued = false;

// Single-flight chain for image pushes. The Display guide and SDK both forbid
// concurrent `updateImageRawData` calls; during mode transitions a stale klines
// fetch could otherwise race the chart-half pushes. Every image push goes
// through `queueImagePush` so they execute strictly in order.
let imagePushChain: Promise<void> = Promise.resolve();
function queueImagePush(task: () => Promise<unknown>): Promise<void> {
  const next = imagePushChain.then(() => task().then(() => undefined));
  imagePushChain = next.catch(() => undefined);
  return next;
}

function watchlistRow(
  sym: string,
  cells: Cells,
  label: string
): string {
  // Composite single-line item content. LVGL's proportional embedded font
  // means columns won't align pixel-perfectly, but consolidating into one
  // ListContainer is the only way to keep page-level double-tap exit working.
  // U+3000 ideographic spaces give a more visually consistent gap than ASCII.
  return `${sym}　${cells.price}　${cells.change}　${label}`.trim();
}

function watchlistItemNames(symbols: string[]): string[] {
  if (symbols.length === 0) return [EMPTY_MESSAGE];
  const now = Date.now();
  const locale = QUOTE_LOCALE[quote];
  const currencySymbol = QUOTE_SYMBOL[quote];
  const label = QUOTE_LABEL[quote];
  return symbols.map((s) => {
    const cells = cellsFor(s, now, locale, currencySymbol);
    return watchlistRow(s, cells, label);
  });
}

function watchlistList(symbols: string[]): ListContainerProperty {
  const itemName = watchlistItemNames(symbols);
  return new ListContainerProperty({
    xPosition: LIST_X,
    yPosition: LIST_Y,
    width: LIST_W,
    height: LIST_H,
    borderWidth: 0,
    paddingLength: PADDING,
    containerID: CID_LIST,
    containerName: "watchlist",
    isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: itemName.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName,
    }),
  });
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
  const currencyLabel = QUOTE_LABEL[quote];

  let line1: string;
  if (entry) {
    const stale = now - entry.ts > STALE_THRESHOLD_MS;
    const price = formatPrice(entry.tick.price, locale, currencySymbol);
    line1 = `${symbol} ${name}  ${price} ${currencyLabel}${stale ? " (stale)" : ""}`;
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
    line3 = `H: ${formatPrice(high, locale, currencySymbol)} ${currencyLabel}`;
    line4 = `L: ${formatPrice(low, locale, currencySymbol)} ${currencyLabel}`;
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
    new TextContainerProperty({
      xPosition: AXIS_LBL_X,
      yPosition: AXIS_LBL_TOP_Y,
      width: AXIS_LBL_W,
      height: AXIS_LBL_H,
      borderWidth: 0,
      paddingLength: 0,
      containerID: CID_DETAIL_YMAX,
      containerName: "ymax",
      isEventCapture: 0,
      content: "",
    }),
    new TextContainerProperty({
      xPosition: AXIS_LBL_X,
      yPosition: AXIS_LBL_BOT_Y,
      width: AXIS_LBL_W,
      height: AXIS_LBL_H,
      borderWidth: 0,
      paddingLength: 0,
      containerID: CID_DETAIL_YMIN,
      containerName: "ymin",
      isEventCapture: 0,
      content: "",
    }),
    new TextContainerProperty({
      xPosition: X_LEFT_X,
      yPosition: X_AXIS_Y,
      width: X_LEFT_W,
      height: X_AXIS_H,
      borderWidth: 0,
      paddingLength: 0,
      containerID: CID_DETAIL_XLEFT,
      containerName: "xleft",
      isEventCapture: 0,
      content: xAxisLeftLabel(range, currentKlines),
    }),
    new TextContainerProperty({
      xPosition: X_RIGHT_X,
      yPosition: X_AXIS_Y,
      width: X_RIGHT_W,
      height: X_AXIS_H,
      borderWidth: 0,
      paddingLength: 0,
      containerID: CID_DETAIL_XRIGHT,
      containerName: "xright",
      isEventCapture: 0,
      content: "now",
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

  // List mode: SDK 0.0.10 has no listContainerUpgrade, so we mark a rebuild
  // as needed. The rebuild loop coalesces ticks and refreshes the page at
  // most once per LIST_REBUILD_INTERVAL_MS — page rebuilds reset the list
  // selection back to index 0, so we keep the cadence loose.
  const items = watchlistItemNames(watchlist);
  let changed = items.length !== lastListItems.length;
  if (!changed) {
    for (let i = 0; i < items.length; i++) {
      if (items[i] !== lastListItems[i]) {
        changed = true;
        break;
      }
    }
  }
  if (changed) listRebuildPending = true;
}

async function pushAxisLabels(klines: Kline[]) {
  if (!bridge || !bridgeReady || mode !== "detail") return;
  let ymax = "";
  let ymin = "";
  if (klines.length >= 2) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const k of klines) {
      if (k.close < lo) lo = k.close;
      if (k.close > hi) hi = k.close;
    }
    const locale = QUOTE_LOCALE[quote];
    const sym = QUOTE_SYMBOL[quote];
    const label = QUOTE_LABEL[quote];
    ymax = `${formatPriceAxis(hi, locale, sym)} ${label}`;
    ymin = `${formatPriceAxis(lo, locale, sym)} ${label}`;
  }
  const xleft = xAxisLeftLabel(detailRange, klines.length > 0 ? klines : null);
  if (ymax !== lastYMaxText) {
    lastYMaxText = ymax;
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: CID_DETAIL_YMAX, content: ymax })
    );
  }
  if (ymin !== lastYMinText) {
    lastYMinText = ymin;
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: CID_DETAIL_YMIN, content: ymin })
    );
  }
  if (xleft !== lastXLeftText) {
    lastXLeftText = xleft;
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: CID_DETAIL_XLEFT, content: xleft })
    );
  }
}

async function pushChart(klines: Kline[]) {
  if (!bridge || !bridgeReady || mode !== "detail") return;
  try {
    const { left, right } = await renderChartHalves(
      klines,
      CHART_TOTAL_W,
      CHART_H
    );
    await pushAxisLabels(klines);
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
  lastDetailInfoText = "";
  lastDetailTabsText = "";
  lastYMaxText = "";
  lastYMinText = "";
  lastXLeftText = "";
  await rebuildDetail();
}

async function exitDetail() {
  if (mode !== "detail") return;
  mode = "list";
  klinesFetchToken++;
  currentKlines = null;
  lastDetailInfoText = "";
  lastDetailTabsText = "";
  lastYMaxText = "";
  lastYMinText = "";
  lastXLeftText = "";
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

let listRebuildIntervalId: ReturnType<typeof setInterval> | null = null;
function startListRebuildLoop() {
  if (listRebuildIntervalId !== null) return;
  listRebuildIntervalId = setInterval(() => {
    if (
      !listRebuildPending ||
      listRebuildInFlight ||
      mode !== "list" ||
      !bridge ||
      !bridgeReady
    ) {
      return;
    }
    // Defer rebuild while the user is actively scrolling — rebuilding resets
    // the LVGL cursor to index 0, which would yank them back to the top.
    if (Date.now() - lastListInteractionTs < LIST_REBUILD_INTERVAL_MS) return;
    listRebuildInFlight = true;
    listRebuildPending = false;
    rebuildListOnly()
      .catch((err) => console.error("list rebuild failed:", err))
      .finally(() => {
        listRebuildInFlight = false;
      });
  }, LIST_REBUILD_INTERVAL_MS);
}

async function rebuildListOnly() {
  if (!bridge || !bridgeReady || mode !== "list") return;
  const items = watchlistItemNames(watchlist);
  const list = new ListContainerProperty({
    xPosition: LIST_X,
    yPosition: LIST_Y,
    width: LIST_W,
    height: LIST_H,
    borderWidth: 0,
    paddingLength: PADDING,
    containerID: CID_LIST,
    containerName: "watchlist",
    isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: items,
    }),
  });
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 1,
      listObject: [list],
    })
  );
  lastListItems = items;
  // Selection resets to 0 on rebuild — that's the trade-off documented at
  // LIST_REBUILD_INTERVAL_MS and why we keep the cadence loose.
  selectedIndex = 0;
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
    // The ListContainer manages its own selection cursor; we just mirror it
    // into selectedIndex when the firmware reports the new index, then act
    // on click/double-click using that index.
    if (event.listEvent?.currentSelectItemIndex !== undefined) {
      selectedIndex = event.listEvent.currentSelectItemIndex;
    }
    // Any list event = active user — defer the next price-refresh rebuild so
    // the cursor doesn't jump back to 0 mid-navigation.
    lastListInteractionTs = Date.now();
    switch (t) {
      case OsEventTypeList.SCROLL_TOP_EVENT:
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        // List handles its own cursor — nothing to do beyond mirroring.
        break;
      case OsEventTypeList.CLICK_EVENT:
        if (watchlist.length > 0) {
          enterDetail().catch((err) =>
            console.error("enterDetail failed:", err)
          );
        }
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
  lastListItems = [];

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
    const list = watchlistList(symbols);
    await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        listObject: [list],
      })
    );
    selectedIndex = 0;
    lastListItems = watchlistItemNames(symbols);
    listRebuildPending = false;
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

function fallbackList(message: string): ListContainerProperty {
  // Use a ListContainer (not TextContainer) so the page-level double-tap
  // exit dialog still fires from this fail-open screen.
  return new ListContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: SCREEN_W,
    height: SCREEN_H,
    borderWidth: 0,
    paddingLength: PADDING,
    containerID: CID_EMPTY,
    containerName: "fallback",
    isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: 1,
      itemWidth: 0,
      isItemSelectBorderEn: 0,
      itemName: [message],
    }),
  });
}

async function bootGlass() {
  bridge = await waitForEvenAppBridge();
  const list = watchlistList(watchlist);
  const result = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      listObject: [list],
    })
  );

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
          listObject: [fallbackList(message)],
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
  lastListItems = watchlistItemNames(watchlist);
  listRebuildPending = false;

  bridge.onEvenHubEvent(handleGlassEvent);
  scheduleRender();
  startListRebuildLoop();
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
