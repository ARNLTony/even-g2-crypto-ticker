---
title: Privacy Policy — Crypto Ticker for Even G2
---

# Privacy Policy

**Effective date:** 2026-04-28
**App:** Crypto Ticker (`com.eventicker.crypto`)
**Platform:** Even Realities Even Hub (Even G2 smart glasses)

This page describes what data the Crypto Ticker app handles, where it goes, and how it is stored. The app is intentionally minimal — it streams public market data and renders it on the lens. It does not have an account system and does not transmit any personal data to a server.

## What we collect

**Nothing about you, personally.**

We do not collect, transmit, or store:

- Your name, email address, phone number, or any contact information
- Your location, IP address, or device identifiers
- Browsing or usage analytics, telemetry, crash reports, or behavioral metrics
- Any data from other apps on your phone or glasses
- Any biometric data, voice data, or sensor data from the glasses
- Cookies or third-party trackers

There is no account, no login, no API key, and no sign-up flow.

## What is stored on your device

The app saves only your **own preferences**, locally in the WebView's `localStorage` on your phone:

- `ticker.watchlist` — the list of cryptocurrency symbols you've selected (e.g. `["BTC","ETH","SOL"]`)
- `ticker.quote` — your selected quote currency (e.g. `"USD"`, `"EUR"`)

This data never leaves your device. It is not transmitted to any server. You can clear it at any time by removing the app or clearing your browser/WebView storage. There is no remote backup.

## Network connections

The app only contacts these two **public Binance endpoints** to fetch market data:

| Endpoint | Purpose |
|---|---|
| `wss://stream.binance.com:9443/stream` | Live cryptocurrency price ticker via WebSocket |
| `https://api.binance.com/api/v3/klines` | Historical price candles for the chart |

These connections are subject to [Binance's Privacy Policy](https://www.binance.com/en/privacy). Standard HTTPS / WSS connections expose your IP address to Binance, as is the case with any client that reads from a public web API. The app does not send any user-identifying data — only the cryptocurrency pair you wish to subscribe to (e.g. `BTCUSDT`).

The app declares this network access in its `app.json` manifest under the `network` permission, with the two hosts above explicitly whitelisted. No other domains are contacted.

## Third-party data sources

- **Binance** is the data source for all cryptocurrency prices. This project is an unaffiliated third-party client. See https://www.binance.com/en/privacy for Binance's own privacy policy.

## Children's privacy

The app does not collect personal information from anyone, including children under 13 (US COPPA), under 16 (EU GDPR), or any other age. No targeted content, advertising, or profiling is performed.

## Data security

Because the app stores no personal data and transmits no user-identifying data, there is no personal data security boundary on our side. Local preferences sit inside the WebView storage on your device and are protected by the device's own OS security.

## Changes to this policy

If this app's data practices change, this document will be updated and the new effective date posted at the top. Material changes will also be noted in the project's [release notes](https://github.com/ARNLTony/even-g2-crypto-ticker/releases).

## Contact

This is an open-source project. Questions, bugs, or privacy concerns can be raised as a GitHub issue:

- Repository: https://github.com/ARNLTony/even-g2-crypto-ticker
- Issues: https://github.com/ARNLTony/even-g2-crypto-ticker/issues

## Disclaimer

This app is for informational purposes only and is not financial advice. Cryptocurrency prices are volatile and the data shown may be delayed, incomplete, or incorrect at any given moment. Do not make trading decisions based solely on this app's display.
