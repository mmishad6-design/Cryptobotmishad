# CryptoBot — MISHAD EDITION (v2)

A clean rebuild of CryptoBot as an institutional-style market analysis and paper-trading terminal.

## Architecture

- **Frontend:** React + TypeScript + Vite
- **Edge/backend:** Cloudflare Workers (API routes, market-data normalization, scheduled refreshes)
- **Database & identity:** Supabase Postgres + Auth + Row Level Security
- **Charts:** Lightweight Charts
- **Market data:** Public exchange endpoints only; no exchange private keys

## Safety model

- No real-money order execution.
- No exchange API secrets or private keys.
- Paper trading is simulated and clearly separated from live market data.
- Signal engine must return `NO TRADE` unless all configured validation rules pass.
- User-owned records must be protected by Supabase RLS.

## Local development

```bash
cd v2
npm install
npm run dev
```

Environment variables will be documented after the Supabase project is provisioned. Never commit service-role keys or Cloudflare secrets.

## Planned modules

1. Market data gateway and symbol registry
2. Technical analysis and multi-timeframe engine
3. Signal validation and risk engine
4. Watchlists and user preferences
5. Paper trading ledger and position lifecycle
6. Backtesting and performance reports
7. Audit trail, health checks and observability
