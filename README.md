<img src="docs/icon.png" alt="Crypto Ticker icon" width="96" align="right" />

# Crypto Ticker — Even Realities G2

Live cryptocurrency prices and charts for the Even G2 smart glasses, built as an Even Hub web app.

The app runs as HTML/JS inside the Even Realities companion app's WebView. The phone-side UI is a settings/picker screen. The glass-side UI is a list of selected coins with live Binance WebSocket prices and a tappable detail page that includes a 1D/1W/1M/1Y line chart fetched from Binance REST klines.

## Screenshots

| Glasses — list | Glasses — detail | Companion app |
|:--:|:--:|:--:|
| ![List view](docs/Splash.png) | ![Detail view](docs/Details.png) | ![Companion picker](docs/Companion.png) |
| 9 live coins, currency footer | Chart with axes + range tabs | Currency dropdown + watchlist editor |

## Quick start

Two terminals.

**Vite dev server:**
```bash
cd crypto-ticker
npm install
npm run dev
```
Serves at `http://localhost:5174/`.

**Simulator** (separate window):
```bash
npx evenhub-simulator http://localhost:5174 --glow
```
Opens two panes: `Browser` (the phone-side settings UI) and `Glasses Display` (the lens render).

To open DevTools in the Browser pane: right-click → Inspect, or F12.

## Glass-side UX

**List mode (default — root page):**
| Action | Effect |
|---|---|
| `Up` / `Down` | Move `「 」` cursor through the watchlist |
| `Click` | Enter detail view for selected coin |
| `Double Click` | Show host exit-confirm dialog (`shutDownPageContainer(1)`) — closes the app |

**Detail mode:**
| Action | Effect |
|---|---|
| `Up` / `Down` | Cycle range tabs `[1D]` → `[1W]` → `[1M]` → `[1Y]` |
| `Double Click` | Return to list |

> Note: the simulator's `Click` button does not dispatch `CLICK_EVENT` — only `DOUBLE_CLICK_EVENT` reliably fires. The handler accepts both, but treat double-click as the primary action.

## Phone-side picker (Browser pane)

- **Currency toggle:** `USD` (uses Binance USDT pairs, en-US formatting) or `EUR` (uses native Binance EUR pairs, de-DE formatting)
- **Watchlist:** up to 8 of 30 catalog coins; reorder with ↑/↓ buttons; drop with ×; add unselected with `+`
- Settings persist in `window.localStorage` under `ticker.watchlist` and `ticker.quote`

## Architecture

### Container layout — list mode (3 text containers)

```
┌─────────────────────────────────────────────┐
│ > BTC      76,200      ▼ 2.10%              │
│   ETH       2,275      ▼ 1.97%              │
│   ...                                       │
└─────────────────────────────────────────────┘
  x=0..96    x=96..236   x=236..576
  symbols    prices      changes
```

Columns align by absolute container x-position. The cursor `>` is part of the symbol column's content, redrawn on scroll.

### Container layout — detail mode (2 text + 1 image)

```
┌──────────────────────────┬──────────────────┐
│ BTC Bitcoin  76,308      │                  │
│ ▼ 2.05% 24h              │   /\   /\        │  Y-max  77,815
│ H 78,265                 │  /  \_/  \_      │
│ L 75,925                 │              \   │  Y-min  76,229
│                          │                  │
│ [1D]                     │  -24h        now │
│  1W                      │                  │
│  1M                      │                  │
│  1Y                      │                  │
└──────────────────────────┴──────────────────┘
  x=0..280  info+stats     x=288..576  chart image (288×144 PNG)
  x=0..96   tabs (vertical, isEventCapture=1)
```

### Data flow

```
Binance WS  ─── tick ───►  latest map ──► flushRender ──► textContainerUpgrade
(streams)                       │                                    │
                                ▼                                    ▼
Binance REST  ─── klines ─►  pushChart ─► canvas ─► PNG ─► updateImageRawData ──► glasses
(detail mode only)                                                              (BLE)
```

### State machine

- `mode: "list" | "detail"` — drives event routing and which containers exist
- `selectedIndex` — current cursor row in list / current coin in detail
- `detailRange: "1D" | "1W" | "1M" | "1Y"` — current tab, drives klines fetch
- `quote: "USDT" | "EUR"` — drives WS pair and number locale
- `klinesFetchToken` — monotonically increasing; protects against stale REST responses overwriting newer ones

## File map

```
crypto-ticker/
├── app.json              Even Hub manifest (package_id, network whitelist)
├── package.json          Vite + SDK + simulator + CLI deps
├── tsconfig.json
├── vite.config.ts        Dev server port 5174
├── index.html            Mounts /src/main.ts; <div id="app"> for picker
└── src/
    ├── main.ts           Orchestrator: bridge bootstrap, state, event handler
    ├── catalog.ts        30-coin list, Quote types, pairFor() helper
    ├── storage.ts        loadWatchlist / saveWatchlist / loadQuote / saveQuote
    ├── format.ts         formatPrice (locale-aware), liveCells / loadingCells / noDataCells
    ├── binance.ts        subscribeTicker (WS), fetchKlines (REST)
    ├── chart.ts          renderChartImage: canvas → PNG with axes
    ├── settings.ts       Phone-side picker UI (currency toggle + watchlist)
    └── styles.css        Dark mobile-style theme for picker
```

## Hardware caveats

This app has been validated **only in the simulator**. Open questions for real G2 hardware:

1. **Image format.** The SDK class is `ImageRawDataUpdate` ("raw") and design docs mention 4-bit greyscale, but the simulator decodes `imageData` as a standard image format (PNG works). Real hardware behavior — through the Flutter companion app → BLE → glasses firmware — is unconfirmed. If PNG fails on hardware, the fallback path is to pack pixels into a `(w*h)/2`-byte buffer (2 pixels per byte, high nibble = leftmost, value 0–15 = intensity).
2. **BLE timing.** Current updates send full container content (~80–200 chars per text upgrade, ~1–3 KB per chart push). On hardware, BLE fragmentation may add latency. The dual-arm BLE protocol (left → ACK → right) is handled by the SDK.
3. **Single tap.** `CLICK_EVENT` doesn't fire in the simulator. On the actual touchpad, single-tap behavior may differ.
4. **Glow + pixel ridges.** The lens micro-LED renders text with visible pixel ridges; what looks crisp in the simulator may look more retro on hardware.

## Distribution

- **Sideload:** `evenhub login` then `evenhub pack app.json dist` produces a `.ehpk`. Upload via the developer portal to flash to your own G2.
- **Publish:** application-based via the Even Hub Early Developer Program (`https://hub.evenrealities.com`). Revenue share / publishing fees not publicly disclosed.

## Data sources

All market data comes from **[Binance](https://www.binance.com/)** public APIs (no key required, no auth):

| What | Endpoint | Why |
|---|---|---|
| Live ticker prices + 24h change | WebSocket `wss://stream.binance.com:9443/stream?streams=...@ticker` | Sub-second updates pushed for every selected pair |
| Historical klines (chart) | REST `GET https://api.binance.com/api/v3/klines` | Closing prices over the selected time range (24h / 1W / 1M / 1Y / ALL) |

The app whitelists only these two Binance endpoints in `app.json`'s `network` permission. No personal data is sent. No analytics, no telemetry.

Binance is the trademark of Binance Holdings Ltd. This project is an unofficial third-party client that reads public price data; it has no affiliation with or endorsement from Binance.

## Resources

- Even Hub docs: https://hub.evenrealities.com/docs
- SDK: `@evenrealities/even_hub_sdk`
- Simulator: `@evenrealities/evenhub-simulator`
- CLI: `@evenrealities/evenhub-cli`
- Discord: https://discord.gg/GsuDkKDXDe
- Even Realities GitHub: https://github.com/even-realities
- Binance API docs: https://developers.binance.com/docs/binance-spot-api-docs

## Known issues

- Visual scroll glitch when moving cursor in list mode (LVGL redraw artifact, deferred)
- Simulator does not visually preview image containers identically to hardware; chart appearance on real G2 unknown
- Long coin names (e.g. "Ethereum Classic") may overflow the info container's first line in detail mode and wrap

## License & privacy

- License: [MIT](LICENSE)
- Privacy policy: [docs/PRIVACY.md](docs/PRIVACY.md) — no personal data collected; only public Binance APIs are contacted
