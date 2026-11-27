# Cloudflare deployment

This repository is a client-rendered React + Vite application. Market data is currently requested directly from Binance public APIs by the browser; there is no application server or database to migrate.

## Deploy a preview

1. Install Node.js (current LTS) and dependencies:
   `npm install`
2. Authenticate with Cloudflare:
   `npx --yes cf auth login`
3. Build and deploy an isolated preview:
   `npm run deploy:cloudflare:preview`

## Deploy the Cloudflare Worker

After validating the preview:

`npm run deploy:cloudflare`

The Vite build output in `dist/` is deployed as an assets-only Cloudflare Worker. Cloudflare serves the SPA globally; Binance remains the external public market-data provider.

## Important

- This migration does not change trading logic, market-data endpoints, or paper-trading behavior.
- No API keys, exchange credentials, or private trading permissions are required.
- Vercel remains untouched until the Cloudflare preview is verified.
- If a server-side API or persistent shared storage is added later, implement it as a Worker and add only the required bindings (for example D1 for relational records).
