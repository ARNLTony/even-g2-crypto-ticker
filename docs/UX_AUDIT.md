# Crypto Ticker — Even Hub UX/UI Compliance Audit

**Audit date:** 2026-04-28
**Audited build:** `app.json` `version: 0.1.0`, `min_sdk_version: 0.0.7`, `edition: 202601`
**Reviewer scope:** Compare app behaviour and code against the Even Hub developer documentation at `https://hub.evenrealities.com/docs/*` and the public Figma design guidelines.
**Trigger:** App was rejected from the Even Hub store; the only stated rejection reason (root-page double-tap → `shutDownPageContainer(1)`) has been fixed. This audit looks for *other* issues prior to resubmission.

---

## Executive summary

The app is functionally complete and most of its glass-side architecture (page lifecycle, single event-capturing container per page, manifest network permission shape, HTTPS/WSS endpoints, paddingLength range, container counts under the 4-image / 8-other ceiling) is compliant with the documented platform contract. The phone-side picker is well structured for a WebView companion UI.

However, there are **three blocking violations** that will almost certainly fail re-review:

1. **Image containers exceed the documented dimension limits.** The Display guide states `Width: 20–200 px, Height: 20–100 px`. The app declares chart halves at **288 × 144** and a list footer at **288 × 20**. Both exceed the height cap (footer exceeds the *width* cap as well). The simulator may render them, but this is a hard documented limit.
2. **Image data is sent as PNG bytes, not 4-bit greyscale.** The Display guide states image containers expect `4-bit greyscale` data. `updateImageRawData`'s documented failure code `imageToGray4Failed` strongly implies the host expects raw greyscale (or a format it can convert), not arbitrary PNG. The app sends `canvas.toBlob('image/png')` bytes. The `README.md` already calls this out as an unverified hardware risk; ship-blocking until validated on hardware.
3. **No app pause on background.** The docs explicitly say "resume updates or refresh data" on `FOREGROUND_ENTER_EVENT` and "pause any timers or ongoing work" on `FOREGROUND_EXIT_EVENT`. The app handles neither; the WebSocket and the 5-second `setInterval` keep running after the user backgrounds the app, draining BLE traffic and battery.

Beyond these, several smaller items are flagged below — most are minor or "doc is silent" cases the user should clarify in Discord before resubmission.

---

## Findings by category

### 1. Touchpad input handling

**Status:** ⚠️ Minor issues

**Doc rules:**
- `CLICK_EVENT (0)`, `SCROLL_TOP_EVENT (1)`, `SCROLL_BOTTOM_EVENT (2)`, `DOUBLE_CLICK_EVENT (3)`, plus lifecycle events `FOREGROUND_ENTER_EVENT (4)`, `FOREGROUND_EXIT_EVENT (5)`, `ABNORMAL_EXIT_EVENT (6)`.
- Input-events guide: *"Only one container per page can capture events."*
- Page-lifecycle guide: `shutDownPageContainer(0)` = immediate exit; `shutDownPageContainer(1)` = "exit confirmation dialog".

**Code (`src/main.ts:695-737`):**
```ts
function handleGlassEvent(event: EvenHubEvent) {
  const t = extractEventType(event);
  if (t === undefined) return;
  if (mode === "list") {
    switch (t) {
      case OsEventTypeList.SCROLL_TOP_EVENT:    moveSelection(-1); break;
      case OsEventTypeList.SCROLL_BOTTOM_EVENT: moveSelection(1);  break;
      case OsEventTypeList.CLICK_EVENT:         enterDetail()...   break;
      case OsEventTypeList.DOUBLE_CLICK_EVENT:  bridge?.shutDownPageContainer(1)...
    }
    return;
  }
  switch (t) {
    case OsEventTypeList.SCROLL_TOP_EVENT:    cycleRange(-1)...
    case OsEventTypeList.SCROLL_BOTTOM_EVENT: cycleRange(1)...
    case OsEventTypeList.DOUBLE_CLICK_EVENT:  exitDetail()...
  }
}
```

- ✅ Root double-tap is `shutDownPageContainer(1)`, matching the rejection-fix.
- ✅ Up/Down/Click are wired in list mode; Up/Down/Double-click are wired in detail.
- ⚠️ **`CLICK_EVENT` in detail mode is silently dropped.** The README notes Click is "reserved" in detail, but a user pressing single-tap will get no feedback. Consider either using it (e.g., toggle a "favorite" or jump back to "24h") or at minimum logging a no-op for diagnostics. Docs are silent on whether unhandled gestures must be acknowledged, but UX-wise the user is left guessing.
- ⚠️ **`extractEventType()` workaround for protobuf zero-value omission is undocumented.** Code at `src/main.ts:681-693` infers `CLICK_EVENT (0)` when no `eventType` is present. This is a reasonable workaround for the simulator quirk you mentioned, but it will mis-fire if the SDK ever delivers an event channel with truly no event type for an unrelated reason. Add a comment with a SDK-version reference or guard it on the simulator.
- ❌ **`FOREGROUND_ENTER_EVENT` and `FOREGROUND_EXIT_EVENT` are unhandled.** Covered in section 9 (Performance/battery).

**Recommendation:**
- Decide whether `CLICK_EVENT` in detail mode should do something (suggest: cycle range forward, mirroring "Click to advance" on most G2 apps) or document its no-op nature in README.
- Add `case FOREGROUND_EXIT_EVENT:` to pause WS + interval, and `case FOREGROUND_ENTER_EVENT:` to resume. See section 9.

---

### 2. Container layout & limits

**Status:** ❌ Violation (image dimension limits)

**Doc rules (Display guide):**
- *"Maximum 4 image containers and 8 other containers per page (mixed types allowed)."*
- *"Exactly one container must have `isEventCapture: 1`."*
- Shared properties: `xPosition (0–576)`, `yPosition (0–288)`, `width (0–576)`, `height (0–288)`, `containerName (max 16 chars)`, `paddingLength (0–32)`.
- Image containers: **`Width: 20–200 px, Height: 20–100 px`**.

**Code:**
- List mode: 3 text containers + 1 image container = 4 total. Within limits.
- Detail mode: 2 text containers + 2 image containers = 4 total. Within limits.
- Empty mode: 1 text container. Within limits.
- `isEventCapture: 1` is set on exactly one container in each mode (`CID_SYMBOL` in list, `CID_DETAIL_TABS` in detail, `CID_EMPTY` in empty). ✅
- All `containerName` values ≤ 16 chars (`list_footer`, `chart_left`, `chart_right`, `symbols`, `prices`, `changes`, `info`, `tabs`, `empty`). ✅
- `paddingLength: 2` everywhere — within `0–32`. ✅
- Coordinates within `0–576 / 0–288`. ✅
- ❌ **`FOOTER_IMG_W = 288, FOOTER_IMG_H = 20`** (`src/main.ts:55-57`) — width 288 exceeds the 200 px max.
- ❌ **`CHART_HALF_W = 288, CHART_H = 144`** (`src/main.ts:81-84`) — width 288 exceeds 200 px; height 144 exceeds 100 px.

**Recommendation:**
- Either:
  - **Resize to comply:** chart halves at 200 × 100 (two of them = 400 × 100 footprint), and a footer at 200 × 20 — and reflow the layout, **or**
  - **Confirm with Even** in Discord whether the 20–200 / 20–100 rule is a documented soft guidance or an enforced firmware limit. The simulator clearly accepts 288 × 144, which is why this hasn't blown up; but published apps go through the Flutter app → BLE → firmware path, and that may reject.
- The chart approach of "one canvas, two halves" is sensible *if* the size limit is real — split into 200 × 100 left + 200 × 100 right and accept the smaller plot area, or use 3 × (~190 wide) tiles.

---

### 3. Text rendering

**Status:** ✅ Compliant, with one convention deviation already known to be intentional

**Doc rules:**
- `createStartUpPageContainer` content: ≤ 1,000 chars.
- `textContainerUpgrade` content: ≤ 2,000 chars.
- *"Text wraps at container width"*; firmware handles internal scrolling iff `isEventCapture: 1`.
- *"The glasses use a single LVGL font baked into firmware. No font selection, no font size control, not monospaced."*
- Design guide: *"Prefix text with `>` as a cursor indicator."*

**Code:**
- 9 watchlist entries × ~25 chars/line = ~225 chars per column container. Well under 1,000 / 2,000 limits. ✅
- Detail info container: 4 lines × ≤ 40 chars ≈ 160 chars. ✅
- Tabs container: 5 lines × ≤ 6 chars ≈ 35 chars. ✅
- ⚠️ **Cursor convention deviation.** Code at `src/main.ts:131` uses `「BTC」` (CJK corner brackets) with CJK em-space `　` padding rather than the documented `>` prefix. You've flagged this as deliberate (proportional font + ASCII space won't align), so it's a defensible exception, but it's not what the docs prescribe. **Reviewer-facing risk:** a strict QA reviewer may flag "did not follow design-guideline cursor pattern". Consider adding a one-liner in a `STORE_NOTES.md` (or in the store description) explaining the alignment workaround.
- ⚠️ Long coin names (e.g., `Ethereum Classic` at line 1 of detail info) may wrap, as your README already acknowledges. Docs say *"Text wraps at container width"* — that's expected behavior, not a violation, but it does break the "4-line layout" assumption of `detailInfoText`. Consider truncating `name` to e.g. 14 chars or using only the symbol on line 1.

**Recommendation:**
- Document the cursor choice in README/store notes.
- Consider truncating `name` in detail info, or split the detail layout so line 1 is `BTC  76,308` and line 2 is `Bitcoin`.

---

### 4. Image containers

**Status:** ❌ Violation (size limits + pixel format)

**Doc rules:**
- Image containers: *"Width: 20–200 px, Height: 20–100 px"*, *"4-bit greyscale"*.
- *"Cannot send during `createStartUpPageContainer` — create a placeholder container, then update via `updateImageRawData`."*
- *"Do not call ... concurrently — wait for one to complete before sending the next."*
- Return statuses include `imageSizeInvalid` and `imageToGray4Failed`.

**Code:**
- ✅ Image containers are declared with no `imageData` in `columnContainers()` and `detailContainers()`; data is pushed afterwards via `updateImageRawData`. Compliant with the placeholder rule.
- ✅ `pushChart` awaits the left half before pushing the right half (`src/main.ts:506-533`). Compliant with no-concurrent rule.
- ⚠️ **However, `pushListFooter` and `pushChart` are not coordinated.** If a `flushRender` and a `pushChart` race during a mode transition, two `updateImageRawData` calls could overlap. Today the only producers are `pushChart` (sequential) and `pushListFooter` (only in list mode), so the practical risk is low — but `applyState()` triggers `rebuildGlass` → `pushListFooter` while a stale `loadKlinesForCurrent` may still be in flight (token check protects state, not BLE ordering). Add a single mutex around all `updateImageRawData` calls.
- ❌ **288 × 144 (chart halves) and 288 × 20 (footer) exceed the documented size envelope.** See section 2.
- ❌ **PNG bytes are not 4-bit greyscale.** `chart.ts:147` and `main.ts:233` both call `canvas.toBlob('image/png')`. The simulator decodes via the Rust `image` crate (which is happy with PNG); hardware path is unverified. The presence of `imageToGray4Failed` in the documented return statuses suggests the host attempts the conversion itself, but that does not mean PNG is the input format; it could expect a raw greyscale buffer.

**Recommendation:**
- **Top priority:** ask Even in Discord whether `updateImageRawData` accepts PNG, and whether the 200×100 dimension cap is firmware-enforced. Until answered, treat both as ship-blockers.
- **Belt-and-suspenders:** add a packed-4-bit fallback path: `canvas.getImageData()` → quantize R-channel to 4 bits → pack 2 px per byte (high nibble = leftmost). Switch on a feature flag so you can ship the safer format if PNG is rejected. Your README already names this exact fallback.
- Add a global image-send mutex.

---

### 5. Page lifecycle

**Status:** ⚠️ Minor issues

**Doc rules:**
- `createStartUpPageContainer` "called exactly once at startup".
- `rebuildPageContainer` for layout changes; "all state is lost, brief flicker on hardware".
- `textContainerUpgrade` for in-place text updates; faster, flicker-free.
- `shutDownPageContainer(0|1)` returns boolean.
- `updateImageRawData` cannot be sent during startup; cannot be concurrent.

**Code:**
- ✅ `bootGlass()` calls `createStartUpPageContainer` exactly once with no image data.
- ✅ `rebuildGlass()` and `rebuildDetail()` use `rebuildPageContainer` for mode/layout transitions.
- ✅ `flushRender`, `pushSymbolColumn`, `cycleRange` use `textContainerUpgrade`.
- ✅ `containerTotalNum` matches `text.length + image.length` in both rebuild paths.
- ⚠️ **`bootGlass()` does not handle `createStartUpPageContainer`'s return code.** Docs list 4 possible codes (0=ok, 1=invalid, 2=oversize, 3=OOM). The app fires-and-forgets. If the page is oversize on hardware (relevant given the image-size question), the user gets a blank screen with no fallback.
- ⚠️ **No handling for `ABNORMAL_EXIT_EVENT` or `FOREGROUND_EXIT_EVENT`.** Docs explicitly recommend *"pause any timers or ongoing work"* on background; *"unexpected disconnect"* on `ABNORMAL_EXIT_EVENT`. The current code keeps the WebSocket open forever and the 5 s polling interval running.
- ⚠️ **No teardown on shutdown.** When `shutDownPageContainer(1)` is called and the user confirms exit, the WS and `setInterval(scheduleRender, PERIODIC_REFRESH_MS)` keep running until the WebView is killed. The bridge is not necessarily torn down at the same moment.

**Recommendation:**
- Capture and log the result code from `createStartUpPageContainer`; if 2 or 3, render a minimal fallback page.
- Add lifecycle handlers (see section 9 for the snippet).

---

### 6. Network / permissions

**Status:** ✅ Mostly compliant; ⚠️ one whitelist nit

**Doc rules (Networking guide):**
- *"One whitelist entry per origin. Use the full origin (`https://api.example.com`) — bare hostnames or wildcards are not supported."*
- *"HTTPS is required in production."*
- *"Every domain in the whitelist must actually be used. App review flags unused entries."*
- CORS must be served by the remote API; whitelist is not a CORS bypass.

**Code (`app.json`):**
```json
"permissions": [{
  "name": "network",
  "desc": "Streams live cryptocurrency prices from Binance.",
  "whitelist": [
    "wss://stream.binance.com",
    "https://api.binance.com"
  ]
}]
```

**Actual code contacts:**
- `binance.ts:51` → `wss://stream.binance.com:9443/stream?streams=...`
- `binance.ts:20` → `https://api.binance.com/api/v3/klines?...`

- ✅ HTTPS/WSS only — compliant.
- ✅ Both whitelist entries are used. No unused entries to flag.
- ⚠️ **Origin mismatch on the WSS entry.** The whitelist says `wss://stream.binance.com` (no port) but the code connects to `wss://stream.binance.com:9443`. The Networking guide says *"Use the full origin"*. Browsers usually treat `wss://host` and `wss://host:9443` as different origins. Whether the Even-side permission check is strict or lenient about the explicit port is undocumented; if it is strict origin matching, this could fail at production-time even though the simulator works.
  - **Fix:** change the entry to `wss://stream.binance.com:9443` to match exactly.
- ⚠️ **`desc` field on the permission is undocumented.** The Networking-guide example only shows `{name, whitelist}`. The extra `desc` should be harmless but isn't part of the documented schema; if the manifest validator is strict, it could be flagged. Easy fix: remove or move into a top-level `description`.

**Recommendation:**
- Change the WSS whitelist to `wss://stream.binance.com:9443`.
- Remove the `desc` field (or wait for Even to clarify whether it's tolerated).

---

### 7. Accessibility / readability

**Status:** ⚠️ Several minor concerns

**Doc rules (Design guidelines):**
- *"576 x 288 px — this is a very small canvas. Every pixel matters."*
- *"4-bit greyscale — design in shades of grey; the hardware renders them as shades of green."*
- *"No background fill"*; only borders and text/image content provide structure.
- *"Test on hardware — the green-tinted greyscale rendering on the glasses differs from your monitor."*

**Code observations:**
- ⚠️ **Stale-data marker is a single asterisk.** `format.ts:44` appends `" *"` to the change cell when stale; `main.ts:271` does the same on the detail price line. On a tiny green-on-black display, a lone `*` is easy to miss. Consider a more obvious indicator like `(stale)` or replacing the value with `—` after a longer threshold.
- ⚠️ **No-data state shows `—` and `"no data"`.** This is fine; ✅ no concern there.
- ⚠️ **Loading state shows `...` only.** Docs are silent on loading-state conventions; consider whether a more explicit "fetching…" or a brief animated dot pattern would help glanceability.
- ⚠️ **Up/down arrows `▲ ▼` rely on Unicode glyphs in the firmware font.** Display guide *"Recommended special characters"* explicitly lists `▲△▼▽`, so these will render. ✅ But your bracket cursor `「 」` and CJK em-space `　` are not on the recommended list. The docs warn: *"Characters outside the font are silently skipped."* If `「`, `」`, or `　` are skipped on the actual firmware font, your list view will lose the cursor entirely. **Validate on hardware.**
- ⚠️ **Footer rendered as image** because text containers can't shrink the font (already known/intentional). Doc-silent on whether image-as-text is acceptable; usually fine as long as size limits hold (they don't — see section 4).
- ⚠️ **Chart axis labels at 16 px** (`chart.ts:107`). Pretty small on a 100 px-tall image after scaling. On hardware the green pixel ridges may make this fuzzy. Test on device or bump to 18 px.
- ⚠️ **Chart line at `lineWidth: 2` plus `#ffffff`** is fine for legibility.

**Recommendation:**
- Verify `「`, `」`, `　` (CJK em-space) render in the firmware LVGL font. If they don't, fall back to leading `>` per docs and pad with multiple ASCII spaces (tabular alignment will be slightly off but the cursor will be visible).
- Make the stale indicator more obvious.
- Test chart text sizes on hardware.

---

### 8. Companion (phone-side) UX

**Status:** ✅ Compliant by absence of doc rules

**Doc rules:** None of the pages I read prescribe phone-side UI conventions for the WebView body. The architecture page only says: *"the phone runs the Even Realities App (Flutter), which hosts your plugin inside a WebView."*

**Code:**
- `settings.ts` + `styles.css` render a clean dark-themed picker with `meta viewport-fit=cover`, semantic HTML, ARIA labels on buttons, and dark-mode-aware CSS variables. ✅
- The picker covers exactly the configured state: currency dropdown + watchlist editor + counter + footer. ✅
- The watchlist enforces `MAX_COINS = 9` correctly via the `atLimit` guard (`settings.ts:70, 142`). ✅

**Documentation gap:** Even should publish phone-side UX guidelines (theming variables, safe-area insets, expected nav patterns). Until they do, this section is "compliant by lack of rules."

⚠️ **One inconsistency:** `README.md` says *"up to 8 of 30 catalog coins"* but `catalog.ts:100` defines `MAX_COINS = 9` and the picker enforces 9. The catalog has 30 entries, so "of 30" is right; only the "8" should be "9".

**Recommendation:**
- Fix the README's "8" → "9".

---

### 9. Performance / battery

**Status:** ❌ Violation (no foreground/background handling)

**Doc rules (Input-events guide):**
> *"Apps should resume updates or refresh data on foreground entry and pause any timers or ongoing work when backgrounded."*

**Code:**
- `main.ts:888-889`:
  ```ts
  resubscribe(watchlist, quote);
  bootGlass().catch(...);
  setInterval(scheduleRender, PERIODIC_REFRESH_MS);
  ```
- The WebSocket connects on app start and stays open until `unsubscribeWS` is called, which only happens in `resubscribe()`. There is no path that calls it on `FOREGROUND_EXIT_EVENT`.
- `setInterval(scheduleRender, PERIODIC_REFRESH_MS)` runs every 5 seconds forever.
- ❌ Both run while the app is backgrounded, generating BLE upgrades for prices the user can't see, and consuming battery on both phone and glasses.

**Doc-silent concerns:**
- ⚠️ Update cadence: with 9 coins, Binance's `@ticker` stream emits ~9 events/sec on average. Each one schedules a `flushRender` that batches into one BLE upgrade per 1 s tick (good — `RENDER_INTERVAL_MS = 1000` `setTimeout` debounce). However:
  - Two simultaneous `textContainerUpgrade` calls per render cycle (price + change). On hardware, each BLE round-trip can take 30–100 ms; doing two back-to-back every second is plausible but not free. Consider concatenating into one container if you can rework the layout.
  - The footer image push is one-shot at rebuild time — fine.
- ⚠️ Chart updates: every range change triggers REST fetch + canvas render + 2 image PNGs. Aside from the size/format issue (section 4), the cadence is user-driven so it's not a battery problem.

**Recommendation:**
- Add foreground/background handling. Suggested skeleton:
  ```ts
  case OsEventTypeList.FOREGROUND_EXIT_EVENT:
    unsubscribeWS?.(); unsubscribeWS = null;
    if (refreshIntervalId) { clearInterval(refreshIntervalId); refreshIntervalId = null; }
    break;
  case OsEventTypeList.FOREGROUND_ENTER_EVENT:
    if (!unsubscribeWS) resubscribe(watchlist, quote);
    if (!refreshIntervalId) refreshIntervalId = setInterval(scheduleRender, PERIODIC_REFRESH_MS);
    break;
  case OsEventTypeList.ABNORMAL_EXIT_EVENT:
    unsubscribeWS?.(); /* + clear interval */ break;
  ```
- Track the interval id rather than orphaning it.

---

### 10. Submission readiness

**Status:** ⚠️ Several gaps

**Doc rules:**
- Manifest: docs do not enumerate required vs optional fields beyond examples; the Networking guide example uses `{name, whitelist}` per permission; the overview guide names the package format as `.ehpk` produced by `evenhub pack`.
- Edition / supported_languages / min_app_version / min_sdk_version: **not documented in the pages I could fetch**. Their meaning and validation rules are doc-silent.

**Code (`app.json`):**
```json
{
  "package_id": "com.eventicker.crypto",
  "edition": "202601",
  "name": "Crypto Ticker",
  "version": "0.1.0",
  "min_app_version": "2.0.0",
  "min_sdk_version": "0.0.7",
  "entrypoint": "index.html",
  "permissions": [...],
  "supported_languages": ["en"]
}
```

- ✅ `package_id` is reverse-DNS, which matches the `com.eventicker.crypto` shape used in conventional manifests.
- ✅ `entrypoint` matches `index.html` at the project root.
- ⚠️ **No `icon` field.** `docs/` contains `icon-24.png`, `icon-48.png`, `icon-128.png`, `icon.png`, but none of them are referenced in `app.json`. Most app stores require an explicit icon; doc is silent on whether the Even Hub manifest needs one. **Likely cause of a rejection if not present.** Ask Even.
- ⚠️ **No `description` field.** The README + Privacy doc are good copy; they're just not pulled into the manifest.
- ⚠️ **No `screenshots` field.** `docs/` has `Splash.png`, `Details.png`, `Companion.png` — perfect screenshot candidates not referenced from the manifest. Doc silent on whether the manifest carries screenshots or whether they're uploaded separately via the developer portal.
- ⚠️ **`edition: "202601"`** — undocumented. The user is presumably tracking this against an Even Hub edition list, but the docs don't say what valid values are.
- ⚠️ **`supported_languages: ["en"]`** — the phone-side UI is English-only, glass-side text labels are English-only. ✅ matches the declaration. But the docs don't say anything about whether more languages are required for store listing.
- ⚠️ **`min_app_version: "2.0.0"`** — doc-silent on what valid values are. Confirm with Even.

**Recommendation:**
- Add `icon`, `description`, and `screenshots` (or whatever the developer portal uses) before resubmission. Confirm with Even Hub support / Discord which manifest fields are *required* for store listings — current rejection notice didn't list these but the manifest is sparse for a store app.
- Verify `edition: "202601"` is the current valid edition for an April 2026 submission.

---

## Documentation gaps

Things the docs **don't** address that affect this audit. Worth raising in the Discord:

1. **Image container dimension limits — soft or hard?** Display guide says 20–200 wide / 20–100 tall, but the simulator accepts 288×144. Is the hardware firmware enforcing this? Is it a render-quality recommendation or a sizing contract?
2. **Pixel format for `updateImageRawData`.** Docs say "4-bit greyscale" + "Accepts `number[]`, `Uint8Array`, `ArrayBuffer`, or base64". They do not specify whether PNG bytes are accepted, whether the host converts on the way through, or whether raw 4-bit packed bytes are required. The presence of `imageToGray4Failed` is suggestive but not definitive.
3. **Port specificity in network whitelist origins.** Is `wss://host` equivalent to `wss://host:9443` in the permission gate, or does the gate require an exact port?
4. **Permission `desc` field.** Used by this app, not in the documented schema. Allowed?
5. **Manifest required vs optional fields.** No reference page enumerates icon/description/screenshots/min_app_version/edition/supported_languages requirements. The closest is example-by-example.
6. **Cursor convention enforcement.** Design guide gives `>` as a *suggestion*. Is using a non-recommended cursor (e.g., `「 」`) a QA-fail signal or stylistic latitude?
7. **Single-tap convention.** No documented requirement that `CLICK_EVENT` must do something on every screen; common sense says yes, but it isn't written down.
8. **Foreground/background handling — required or recommended?** Guide says apps "should pause" on background. Whether store reviewers fail apps that don't is not explicit.
9. **Firmware font character set.** Docs list "recommended special characters" but don't enumerate the full LVGL bake-in. Need an explicit list (or a way to test) before relying on glyphs like `「 」 　 ▲ ▼`.
10. **Phone-side companion UX guidelines.** None exist for the WebView body — would help align companion looks.
11. **Submission QA checklist.** No published QA guideline page (or it exists at a URL I couldn't find via WebFetch). Ask whether the rejection email points to one.

---

## Recommended actions before resubmission

In priority order:

### Blockers (must fix or get explicit confirmation)
1. **Image container sizes.** Either resize chart halves to 200×100 and footer to ≤200×20, **or** confirm in Discord that the documented 20–200 / 20–100 envelope is not enforced. **(File: `src/main.ts` constants `FOOTER_IMG_W/H`, `CHART_HALF_W`, `CHART_H`.)**
2. **Image pixel format.** Add a packed-4-bit greyscale fallback path behind a feature flag, and confirm with Even whether PNG bytes through `updateImageRawData` are supported. Until confirmed, ship the safer format. **(Files: `src/chart.ts:sliceToPng`, `src/main.ts:renderFooterImage`.)**
3. **Foreground/background lifecycle.** Wire `FOREGROUND_ENTER_EVENT`, `FOREGROUND_EXIT_EVENT`, `ABNORMAL_EXIT_EVENT` to pause/resume the WebSocket and refresh interval. **(File: `src/main.ts:handleGlassEvent` + module-level `setInterval`.)**

### Manifest gaps
4. **Add `icon` to `app.json`** (point at `docs/icon.png` or a dedicated `icon-128.png`). **(File: `app.json`.)**
5. **Add `description`** field; reuse README first paragraph. **(File: `app.json`.)**
6. **Add `screenshots`** field if the developer portal supports it (or upload separately and document where). **(File: `app.json` / dev portal.)**
7. **Fix WSS origin:** `wss://stream.binance.com` → `wss://stream.binance.com:9443`. **(File: `app.json` line 14.)**
8. **Remove `desc` from the permission object** (or keep it after Even confirms it's tolerated). **(File: `app.json` line 12.)**

### Should-fix UX issues
9. **Validate firmware font** for `「`, `」`, `　` (CJK em-space). If any are missing, fall back to `> SYM` cursor per design guideline. **(Files: `src/main.ts:symbolColumn`, `tabsVertical`.)**
10. **Decide CLICK_EVENT behavior in detail mode** (currently silent). **(File: `src/main.ts:726-737`.)**
11. **Coordinate `updateImageRawData` calls** behind a single-flight mutex to guarantee the no-concurrent rule even during mode transitions. **(File: `src/main.ts:pushChart`, `pushListFooter`.)**
12. **Capture and log `createStartUpPageContainer` return code**; render a fallback if oversize/OOM. **(File: `src/main.ts:bootGlass`.)**
13. **Truncate or restructure detail line 1** so long names like `Ethereum Classic` don't wrap. **(File: `src/main.ts:detailInfoText`.)**
14. **Strengthen the stale-data marker** beyond a lone `*`. **(File: `src/format.ts:liveCells`, `src/main.ts:detailInfoText`.)**
15. **Fix `README.md`** "up to 8 of 30 catalog coins" → "up to 9". **(File: `README.md` line 56.)**

### Nice-to-have
16. Track and clear the `setInterval` id in a module-level variable so backgrounding can stop it.
17. Document the cursor convention deviation in `STORE_NOTES.md` for the reviewer.
18. Bump chart-axis font from 16 px → 18 px and re-test on hardware.
