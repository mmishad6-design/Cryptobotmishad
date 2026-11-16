# CryptoBotMishad — Manual Trading Research Terminal

A React + Vite research terminal for Binance public market data. It provides market charts, multi-timeframe signal analysis, risk plans, paper trading, strategy research, market-regime and market-structure tools.

## Features
- Public Binance Spot and USD-M Futures market data; no exchange credentials are requested.
- Live ticker and candlestick streams with REST fallback and feed-integrity checks.
- Multi-timeframe signal profiles (5m, 15m, 1h) with AUTO selection and conflict rejection.
- ATR-based entry, stop, target and position sizing with fee/slippage-aware risk checks.
- Local paper trading, trade journal, manual close, and conservative simulated exits.
- Historical backtesting, walk-forward utilities, Strategy Lab, Multi-Asset Scanner, Market Regime and Market Structure research panels.
- Bengali-first explanations and responsive dark/light interface.

## Safety and limitations
- Analysis and paper trading only. No real orders, private API keys, or automated execution.
- Signals are rule-based research outputs, not predictions or guarantees of profit. Always verify data and execution independently.
- Paper quotes older than 15 seconds are rejected for automatic TP/SL handling and paper-trade entry/close controls. Polling can still miss price excursions between quote updates.
- Backtesting currently evaluates the 5m entry profile with 4h/1h/15m context; AUTO's 15m and 1h candidate profiles are not independently backtested yet.
- Backtests and scanners use simplified execution assumptions; funding, liquidation, spread, partial fills and exchange-specific constraints may not be fully represented in every research panel.
- News & Events is not currently implemented and is not shown in navigation.
- Paper trades and balances are stored in the current browser's local storage; they do not sync across devices.
- No authentication is configured by default. A public deployment is publicly accessible.

## Volume / taker-flow validation
- Live and historical MTF analysis share strict completed-candle volume and taker-buy calculations.
- Missing or inconsistent candle volume data blocks flow confirmation; Futures aggregate taker ratio is display-only because its newest interval may be incomplete.
- Live signals require a structurally valid top-20 order-book snapshot fetched within an 8-second request window. Binance's response does not expose an exchange event timestamp here, so server-side freshness is not guaranteed.
- See `docs/volume-taker-flow-audit.md` for assumptions and limitations.

## Run locally
```bash
npm install
npm run dev
```

## Tests and production build
```bash
npm test
npm run build
```

Designed by Mishad.
