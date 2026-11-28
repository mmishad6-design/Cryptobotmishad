export interface Env {
  ASSETS: Fetcher;
}

const BINANCE_SPOT = "https://api.binance.com";
const ALLOWED_INTERVALS = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "3d", "1w", "1M"]);
const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SUIUSDT", "SOLUSDT"];
const SYMBOL_PATTERN = /^[A-Z0-9]{5,20}$/;

function json(data: unknown, status = 200, cacheSeconds = 0): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": cacheSeconds > 0 ? `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=10` : "no-store",
  });
  return new Response(JSON.stringify(data), { status, headers });
}

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function proxyBinance(path: string, cacheSeconds: number): Promise<Response> {
  const upstream = await fetch(`${BINANCE_SPOT}${path}`, {
    headers: { accept: "application/json" },
    cf: { cacheTtl: cacheSeconds, cacheEverything: true },
  });
  if (!upstream.ok) {
    return json({ error: "Market data provider unavailable", providerStatus: upstream.status }, 502);
  }
  const body = await upstream.json<unknown>();
  return json({ data: body, source: "Binance Spot", receivedAt: new Date().toISOString() }, 200, cacheSeconds);
}

async function handleApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!isAllowedOrigin(request)) return json({ error: "Origin not allowed" }, 403);

  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/health") {
    return json({ ok: true, service: "cryptobot-market-api", timestamp: new Date().toISOString() });
  }

  if (url.pathname === "/api/market/ticker") {
    const raw = url.searchParams.get("symbols") ?? DEFAULT_SYMBOLS.join(",");
    const symbols = [...new Set(raw.split(",").map((item) => item.trim().toUpperCase()))];
    if (symbols.length < 1 || symbols.length > 20 || symbols.some((symbol) => !SYMBOL_PATTERN.test(symbol))) {
      return json({ error: "Invalid symbols. Supply 1–20 comma-separated market symbols." }, 400);
    }
    const encoded = encodeURIComponent(JSON.stringify(symbols));
    return proxyBinance(`/api/v3/ticker/24hr?symbols=${encoded}`, 5);
  }

  if (url.pathname === "/api/market/klines") {
    const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase();
    const interval = url.searchParams.get("interval") ?? "1h";
    const limit = Number(url.searchParams.get("limit") ?? "500");
    if (!SYMBOL_PATTERN.test(symbol)) return json({ error: "Invalid symbol." }, 400);
    if (!ALLOWED_INTERVALS.has(interval)) return json({ error: "Unsupported candle interval." }, 400);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return json({ error: "Limit must be between 1 and 1000." }, 400);
    return proxyBinance(`/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`, 15);
  }

  return json({ error: "API route not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request);
    return env.ASSETS.fetch(request);
  },
};
