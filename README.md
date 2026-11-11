# CryptoBot — Trading Terminal

An early-stage, manual-analysis and paper-trading dashboard built with React, Vite and Lightweight Charts.

## Current MVP
- Live 24-hour ticker data and candlesticks from Binance public REST endpoints.
- Watchlist of selected liquid USDT markets.
- 1m, 5m, 15m, 1h, 4h and 1d chart intervals.
- A deliberately simple moving-average/momentum snapshot labelled as a preliminary setup assessment.
- Local paper-trade journal and simulated balance.
- Dark/light themes and responsive layout.

## Important limitations
- The setup assessment is **not a validated trading signal**, forecast, or probability of profit.
- No backtesting, order-book/liquidation analysis, open interest, funding, news intelligence, or production risk engine is implemented yet.
- Paper trades are stored in page memory only and reset on refresh.
- The current market feed is Binance public spot data. Selecting Futures changes the workspace label only; it does not yet fetch derivatives data.
- No exchange credentials are collected and no real orders can be placed.

## Run locally
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```

Designed by Mishad.
