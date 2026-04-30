# Store reviewer notes — Crypto Ticker

A short note on one intentional deviation from the published Even Hub design
guidelines, included so the reviewer doesn't have to guess. This file is
**not** user-facing.

## Cursor convention: `「 」` instead of `>`

The design guidelines suggest prefixing the selected row with `>` as the
cursor indicator. Crypto Ticker instead wraps the selected row's symbol in
**CJK corner brackets** (`「` U+300C, `」` U+300D) and pads unselected rows
with **U+3000** (CJK ideographic space) on either side.

### Why

The glasses' baked-in LVGL font is **proportional**, not monospaced. ASCII
`>` plus an ASCII space is 2 narrow glyphs; an unselected row with 2 ASCII
spaces in front is also 2 narrow glyphs — but those leading spaces collapse
visually because the symbol that follows is itself proportional, so the
left edge of the symbol column drifts row-to-row depending on whether the
selected row is above or below.

CJK corner brackets and U+3000 ideographic space are full-width and
visually equal (≈ the width of two ASCII characters), so swapping them in
and out as the cursor moves keeps every symbol's left edge aligned within
the same x-position, which matches the column boundary configured in the
text container's geometry.

### Side-by-side

With `>` (recommended):

```
> BTC      76,200      ▼ 2.10%
  ETH       2,275      ▼ 1.97%
  ADA      0.5612      ▲ 0.42%
```

The leading `>` plus space takes ~14 px on the proportional font. The two
leading spaces below take ~6 px. The `B`, `E`, `A` columns drift left by
~8 px on the unselected rows.

With `「 」` (this app):

```
「BTC」    76,200      ▼ 2.10%
　ETH　    2,275      ▼ 1.97%
　ADA　   0.5612      ▲ 0.42%
```

Both `「` and `　` (U+3000) render at full ideographic width, so `B`, `E`,
`A` all start at the same x-pixel.

### Caveat

This relies on `「`, `」`, and U+3000 being baked into the LVGL firmware
font. The Display guide's *"Recommended special characters"* list doesn't
include them, so they may render as missing glyphs on hardware. If they
are, the fallback is the documented `>` cursor with extra ASCII padding —
column alignment will be slightly off but the cursor will at least be
visible. Validation against actual G2 firmware is pending.

## Image container sizes / pixel format

The chart halves (`288 × 144`) and list footer (`288 × 20`) currently
exceed the documented Display guide envelope of `20–200 × 20–100`, and the
images are sent as PNG bytes rather than packed 4-bit greyscale. Both are
**deliberately deferred** pending Discord clarification on whether the
20–200/20–100 limits and the explicit "4-bit greyscale" pixel format are
firmware-enforced or G1-era specs that the G2 host accepts more leniently.
The simulator accepts both. If Even confirms the limits are hard, a
follow-up patch will resize and re-encode.
