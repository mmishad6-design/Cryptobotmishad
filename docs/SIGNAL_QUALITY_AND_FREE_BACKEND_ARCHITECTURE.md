# CryptoBot — Signal Quality & Free Backend Architecture

## Product objective

CryptoBot is a private, single-user research and manual-trading assistant. The objective is **selectivity and capital preservation**, not signal volume. Returning `NO TRADE` is the correct outcome whenever evidence is incomplete, conflicting, stale, or not economically actionable.

This document is an implementation plan, not a claim that the proposed backend or validation has already been deployed.

## 1. Signal decision pipeline

A candidate must pass every mandatory gate. A weighted score is explanatory only; it must never override a failed hard gate.

1. **Data integrity**
   - Use completed candles only for decisions.
   - Check candle continuity, timestamp freshness, valid OHLCV values, and source availability.
   - Require the requested symbol and market to match every input.
   - Missing, stale, conflicting, or malformed required data => `NO TRADE / DATA BLOCKED`.
2. **Market regime**
   - Classify trend, range, transition, and high-volatility conditions.
   - Avoid forcing trend-following entries in ranges or unstable transitions.
   - Treat regime labels as context, not as standalone signals.
3. **Higher-timeframe direction**
   - 4H and 1H must agree for directional trend setups.
   - Mixed higher-timeframe direction => `NO TRADE`.
4. **Setup formation**
   - 15M trend, momentum, strength, volume, and confirmed structure must support the same direction.
   - Structure events must be confirmed using only information available at decision time.
5. **Entry trigger**
   - 5M trigger must agree with the higher-timeframe direction.
   - Do not chase an entry after the price has moved too far from the intended invalidation level.
6. **Execution feasibility**
   - Validate best bid/ask spread, available top-of-book depth, and data age.
   - Treat a shallow top-20 snapshot as partial evidence, never as the full order book.
   - If a required execution input is unavailable, either explicitly mark it optional with a tested fallback or block the trade; never silently substitute stale values.
7. **Risk validation**
   - Calculate entry, stop, target, position size, fees, and estimated slippage before publishing a trade.
   - Reject invalid/zero ATR, non-positive stop distance, invalid quantity, insufficient reward relative to risk after estimated costs, or a stop/target on the wrong side of entry.
   - Enforce the configured maximum account-risk budget and notional cap.
   - Do not publish a signal if the risk plan cannot be calculated.
8. **Final decision**
   - Publish LONG/SHORT only if all hard gates pass.
   - Otherwise publish `NO TRADE` with the exact failed gates and supporting measurements.
   - A score such as 90/100 is a rule-confluence score, **not** a 90% probability of winning.

## 2. What must be improved in the current client-side engine

The current app already has a 4H → 1H → 15M → 5M analysis path, Wilder RSI/ATR/ADX, volume checks, structure checks, order-book depth, and taker-flow checks. The next code changes should be limited to these audited gaps:

- Separate hard gates from the explanatory confluence score.
- Add an explicit execution/risk-plan validation stage before a signal can be emitted.
- Record why each gate passed or failed, with measured values and timestamps.
- Ensure all price/ATR/stop/target values come from the same completed-candle snapshot.
- Make signal entry assumptions explicit. A candle-close reference is not a guaranteed fill.
- Avoid treating missing order-flow inputs as bullish/bearish confirmation.
- Keep the dashboard, paper trading, tracker, and backtest on the same decision contract.

No arbitrary threshold should be described as “optimal”. Any new threshold must be tested on training data, frozen, and then evaluated on unseen data.

## 3. Validation and promotion policy

A strategy is not promoted because it has a high historical win rate or a high in-app score.

Required validation:

- Chronological data only; no random train/test shuffle.
- Warm-up data may initialize indicators, but no future candle may enter a decision.
- Entry is simulated no earlier than the next executable candle/open after the signal decision.
- Include entry and exit fees plus conservative slippage on both sides.
- If stop and target are both touched in the same candle and intrabar order is unknown, assume the stop occurs first.
- Evaluate at least three chronological out-of-sample folds; keep the final holdout untouched until settings are frozen.
- Report trade count, net return, expectancy, profit factor, maximum drawdown, average win/loss, and results by market regime.
- Compare against a simple baseline and a no-trade/cash baseline.
- Include funding, spread, and liquidation assumptions for Futures where reliable data is available; otherwise disclose the omission.
- A low trade count is **inconclusive**, not proof of quality. Do not advertise a win probability from a small sample.
- Keep a strategy in research mode if out-of-sample results are unstable, costs erase the edge, or drawdown is unacceptable.

Live/paper outcomes must be tracked separately from historical backtests. Do not combine them into one performance number.

## 3A. Shared execution and outcome accounting

The live signal tracker, paper trading, and historical MTF backtest use shared helpers in `src/tradeExecution.js` for adverse fill slippage, fee-aware P&L, and conservative same-candle exit resolution.

- LONG entry and SHORT exit fills move upward by the configured slippage; SHORT entry and LONG exit fills move downward.
- Net P&L includes both entry and exit fees. An already-charged entry fee can be supplied so it is not charged twice.
- If both stop and target are touched in one historical candle, the stop is selected first because intrabar ordering is unknown.
- Live signal tracking uses a completed 5M close as a reference, then applies an estimated adverse entry fill; it is not an exchange fill.
- Paper trading uses the observed live price as a reference, estimates adverse entry/exit slippage, and remains browser-local.
- Historical MTF backtesting enters at the next 5M candle open with adverse slippage. Its historical flow input remains a candle-derived proxy and does not include historical order-book snapshots.

The current default assumptions (0.05% fee per side and 0.02% slippage per side) are configurable/provisional estimates, not verified fills or guaranteed Binance fee tiers. Actual fees vary by account, product, VIP level, promotions, and execution. Spread, market impact, partial fills, funding, and liquidation are not fully modelled. Therefore paper/backtest results remain approximations and must not be treated as expected live returns.

## 4. Free-tier, single-user backend proposal

Target components:

- **Frontend:** existing React/Vite app on Vercel.
- **Market data:** Binance public REST/WebSocket endpoints; no Binance API key and no order execution.
- **Scheduled worker:** GitHub Actions running a short Node.js job on completed-candle boundaries.
- **Database:** Supabase Postgres Free tier for signals, gate results, market snapshots, paper-trade outcomes, and worker checkpoints.
- **Secrets:** Supabase server-side secret stored only in GitHub Actions/Vercel environment settings; never in browser code or committed files.
- **Private access:** private GitHub repository plus Vercel deployment protection or a real single-user login. A hard-to-guess URL is not authentication.

Suggested database records:

- `signal_runs`: symbol, market, decision time, data timestamps, decision, rule score, engine version.
- `signal_gate_results`: one row per gate, pass/fail/block reason, measurements, source timestamps.
- `signals`: side, reference entry, stop, target, risk budget, estimated costs, status.
- `signal_outcomes`: exit reason, exit reference, gross/net result, fees, data quality status.
- `worker_state`: last processed candle per symbol/market/timeframe, last successful run, engine version.

Security requirements:

- Enable Row Level Security on exposed tables.
- Restrict reads/writes to the single authenticated owner.
- Never expose Supabase service-role/secret keys in Vite client variables.
- Use a least-privilege server-side path for scheduled writes.
- Do not store exchange credentials because the product is manual-only.

### Free-tier reality check

A scheduled GitHub Actions worker is not an always-on server. Schedules can start late, jobs can fail, and private-repository free minutes are limited. A 15-minute completed-candle scan is the conservative initial target; the worker should process every missed closed 5-minute candle from Binance history when it wakes, rather than assuming it ran exactly on time.

This design can provide periodic background analysis at no subscription cost within current quotas, but it cannot promise second-by-second monitoring or guaranteed 24/7 execution. If the free quotas or schedule reliability are insufficient, the honest outcome is reduced scan frequency or a user-run local worker—not an undisclosed paid dependency.

Before connecting Supabase or enabling workflows, verify the current free-tier quotas and the user's project settings. Do not create paid resources.

## 5. Safe implementation phases

1. **Quality gate refactor:** isolate the decision pipeline and risk-plan validator; preserve existing UI and current live data source.
2. **Deterministic tests:** test stale data, candle gaps, timeframe conflicts, missing order flow, invalid ATR, invalid stops, cost-adjusted risk, and valid setups.
3. **Backtest parity:** use the same pure decision function in live analysis and historical simulation; document unavoidable differences in execution assumptions.
4. **Supabase setup:** only after the user connects/creates a Free project; add SQL schema, RLS, and secret handling.
5. **Scheduled worker:** run on a conservative cadence, checkpoint processed candles, retry safely, and prevent duplicate signals.
6. **Private access hardening:** verify repository visibility and protect the hosted dashboard before storing personal trading history.

## 6. Non-goals

- No automated exchange orders.
- No exchange API keys or private trading permissions.
- No paid data feeds, paid hosting, or hidden subscription dependency.
- No claims of guaranteed accuracy, guaranteed profit, or validated win probability without adequate out-of-sample and live evidence.


## Phase 2 — Shared live and historical decision engine

- The directional decision rules now live in `src/mtfDecision.js` and are called by both the live MTF signal component and the MTF historical simulator.
- Shared mandatory gates: 4H/1H trend alignment, 15M RSI/ADX setup, 5M RSI/ADX timing, BOS/CHoCH/sweep structure, 15M+5M volume, directional taker flow, cost-aware risk validation, and Spot long-only enforcement.
- Training profiles pass frozen thresholds into the same decision function; the out-of-sample period does not tune those thresholds.
- Historical simulation uses the candle-derived taker buy/sell ratio as a proxy. Historical top-20 order-book depth snapshots are not available from the current dataset, so historical mode does not pretend to validate the live depth gate. This limitation must remain visible in reports.
- The simulator validates the next-candle simulated entry with the selected fee and slippage assumptions, then sizes quantity from the same 1% risk-budget validator used by the live dashboard.
- Automated unit tests cover shared live/historical behavior, missing data, market direction, threshold gates, and risk sizing. Passing tests/build does not establish trading edge or profitability.
- The Strategy Lab's separate SMA parameter experiment and the Multi-Asset Scanner remain distinct research tools; they are not yet the same MTF strategy.


## Phase 3 — Historical look-ahead audit

- Historical MTF candle snapshots are now selected by an explicit as-of timestamp: only rows whose candle close time is at or before the 5M decision candle close can enter the indicator snapshot.
- Signal eligibility is evaluated using the completed 5M close and the already-closed 4H/1H/15M context. The simulator no longer supplies the following 5M candle's open to the signal decision/risk gate.
- The next 5M candle open is used only after a direction has been decided, as the simulated execution fill with adverse slippage. The cost-aware risk plan is then revalidated at that simulated fill; if the actual fill makes the plan invalid, the trade is skipped.
- Added deterministic tests for as-of candle selection, including the boundary where a candle closes exactly at the decision timestamp.
- This removes a specific future-open leakage path. It does not by itself prove the entire backtest is free of all bias: higher-timeframe candle alignment, walk-forward boundaries, intrabar gap fills, and execution realism still require further review.
