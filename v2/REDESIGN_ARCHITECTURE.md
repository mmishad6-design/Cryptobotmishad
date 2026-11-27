# CryptoBot Mishad — Full Redesign Architecture

## Approved direction

- Visual direction: Institutional Dark.
- Layout: Hybrid, optimized for desktop and mobile.
- Scope: Full product-wide redesign.
- Hosting target: Existing Cloudflare Pages project `cryptobotmishad`, branch `rebuild-cloudflare-supabase`.
- Preserve the legacy Vercel `main` deployment and do not merge PR #8 as part of this work.

## Audit findings

The Cloudflare `v2/` application currently contains Supabase authentication, a responsive shell, public market ticker/candle APIs, Binance/Bybit WebSocket/REST market feeds, a basic OHLC chart, paper-trading UI, and admin/settings scaffolding.

The repository's existing root application contains additional tested domain functionality that must be carried into v2 rather than discarded or rewritten casually:

- Multi-timeframe signal decision and best-timeframe selection.
- Risk-plan validation and sizing.
- Candle-flow and order-book depth analysis.
- Market regime and market-structure analysis.
- Strategy optimization, multi-asset scanning and derivatives/order-flow analysis.
- Paper-trading calculations, fee/slippage-aware execution and trade PnL.
- Historical backtesting and sequential out-of-sample evaluation.
- Bangla/English language support.

The root `main` application is the legacy Vercel deployment and must remain untouched.

## Product navigation

1. Overview
2. Market
3. Signal Engine
4. Strategy Lab
5. Multi-Asset Scanner
6. Market Regime
7. Market Structure
8. Futures & Order Flow
9. Backtesting
10. Paper Trading
11. Trade Journal
12. Watchlist
13. Settings

Navigation labels may be grouped visually on desktop, while all destinations remain reachable on mobile through a drawer/More navigation.

## Visual system

- Graphite/near-black application canvas, layered charcoal panels, subtle cool-grey borders.
- Muted emerald/teal as the primary accent; green/red reserved for market direction and PnL.
- Compact but legible typography with tabular numerals for prices and metrics.
- Clear hierarchy, consistent spacing, reusable panel/table/metric/control primitives.
- Desktop: collapsible left navigation, top command/status bar, flexible multi-column workspaces.
- Mobile: full-width single-column content, compact top bar, accessible navigation drawer, horizontally scrollable chart controls and tables with deliberate overflow handling.
- Avoid oversized decorative cards, excessive gradients, and cramped icon-only navigation.

## Frontend architecture

Keep React + TypeScript + Vite. Refactor the monolithic `v2/src/App.tsx` into:

- `src/app/`: app state, page composition, navigation and providers.
- `src/layout/`: desktop shell, mobile navigation, top bar and page frame.
- `src/components/ui/`: reusable buttons, panels, metric tiles, tables, badges, selectors and empty/loading/error states.
- `src/features/market/`: market watchlist, ticker strip, chart workspace and data-source status.
- `src/features/signals/`: MTF analysis, decision gates, reasons and risk plan.
- `src/features/strategy/`: strategy lab, optimizer and scanners.
- `src/features/backtesting/`: historical simulation and out-of-sample reports.
- `src/features/paper-trading/`: demo account, positions, manual close and journal.
- `src/features/settings/`: account, language, risk and chart preferences.
- `src/core/`: domain logic ported from the existing root app, with behavior parity and tests.
- `src/lib/`: Supabase and market API/WebSocket adapters.

Do not introduce a new state-management or routing dependency unless a concrete requirement justifies it. Keep domain calculations separate from presentation.

## Market/chart architecture

Use the existing `lightweight-charts` v5 dependency for the chart instead of a hand-drawn SVG. Render OHLC candlesticks and volume histogram; provide crosshair, pan/zoom, last-price line, responsive resize, reset view, symbol selection and source/freshness status.

Chart timeframes:
`1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M`.

Chart intervals and signal-engine profiles are separate concepts. The chart can expose all supported exchange intervals, while the MTF signal engine keeps its validated role mappings and automatic/manual best-timeframe selection. Never imply that choosing a chart interval changes the strategy profile unless explicitly wired and tested.

Binance Spot WebSocket/REST remains primary; Bybit Spot WebSocket/REST remains fallback. Unsupported Bybit WebSocket intervals must fall back to REST without leaving the chart in a false-connected state. No stale/fabricated price may be labelled live.

## Domain and persistence architecture

- Port the existing root domain modules into `v2/src/core/` with minimal/no semantic changes.
- Preserve risk hard-gates, conflict handling, completed-candle-only decisions, fee/slippage assumptions, conservative intrabar stop-first behavior, and sequential OOS validation.
- Keep Supabase Auth, PostgreSQL, RLS and existing paper-trading RPC contracts.
- Keep paper trading virtual/manual only. No exchange API secrets, real order execution, or automatic live trading.
- Preserve Bangla signal/rejection explanations and language preferences.
- Keep public data access and current free-tier/no-paid-resource constraints.

## Verification and rollout

1. Add domain modules and parity tests to v2 before wiring new UI.
2. Refactor the application shell and design tokens while preserving existing handlers.
3. Build shared chart workspace and all chart timeframes; verify REST fallback behavior.
4. Migrate each legacy analytical module into its corresponding feature page.
5. Verify auth, RLS-backed paper account, open/close/reset, watchlist and settings.
6. Run TypeScript build and domain tests; check desktop and mobile layouts.
7. Deploy previews to Cloudflare; promote only after successful verification.
8. Leave legacy Vercel `main` and its deployment unchanged.

## Non-negotiable acceptance criteria

- No feature removed merely to simplify the redesign.
- No false live status or synthetic market values.
- No signal without passing mandatory data, structure, flow and risk gates.
- NO TRADE remains the default when evidence is missing, stale, conflicting or weak.
- Chart timeframe selection changes the actual requested OHLC data and reconnects the matching stream.
- Desktop and mobile both remain usable without horizontal page overflow.
