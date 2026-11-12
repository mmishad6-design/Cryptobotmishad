# Volume and Taker-Flow Audit

## Signal inputs
- Volume confirmation uses each timeframe's latest fully closed Binance kline volume divided by the mean base volume of the preceding 20 completed candles.
- Live and historical analysis share `calculateCandleFlow`.
- Taker buy/sell ratio is computed from Binance kline base volume and taker-buy base volume (array index 9): buy volume divided by total base volume minus buy volume.
- Missing, non-positive, or inconsistent volume/taker-buy values invalidate the sample; missing data is never coerced to zero.
- A 100% taker-buy candle has no finite buy/sell ratio and cannot pass the directional taker gate.
- Futures `takerlongshortRatio` remains contextual display data only. Its newest 5-minute interval may be incomplete; it does not authorize a signal.
- Historical flow uses the same closed-candle calculation, but historical order-book snapshots are unavailable.

## Order-book depth
- Live flow requires a valid Binance REST top-20 bid/ask snapshot.
- Each side must contain 1–20 levels with finite positive prices and quantities.
- Depth ratio is top-20 bid quote value divided by top-20 ask quote value.
- Requests taking more than 8 seconds are rejected.
- Binance REST depth responses do not provide an exchange event timestamp in this flow. Request latency and payload integrity are checked, but server-side snapshot freshness is not guaranteed.
- A single snapshot is an imbalance observation, not full order flow, queue position, or executable liquidity.

## Remaining limitations
- Candle taker-buy volume is a Binance trade-classification proxy, not complete market-wide order-flow delta.
- Volume ratio compares base volume, not quote-notional volume.
- Top-20 depth can change immediately after retrieval and is not available in historical backtests.
- Funding, spread, market impact, partial fills, liquidation, and historical depth replay remain unmodelled.
- Deterministic tests do not establish signal accuracy or profitability.
