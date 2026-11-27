const SYMBOL = /^[A-Z0-9]{2,20}USDT$/;
const INTERVALS = new Set(["1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w","1M"]);
export const onRequestGet = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") || "BTCUSDT").toUpperCase();
  const interval = url.searchParams.get("interval") || "1h";
  const limit = Number(url.searchParams.get("limit") || 500);
  if (!SYMBOL.test(symbol)) return Response.json({ error: "Invalid USDT symbol." }, { status: 400 });
  if (!INTERVALS.has(interval)) return Response.json({ error: "Unsupported candle interval." }, { status: 400 });
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return Response.json({ error: "Limit must be between 1 and 1000." }, { status: 400 });
  try {
    const endpoint = new URL("https://api.binance.com/api/v3/klines");
    endpoint.searchParams.set("symbol", symbol); endpoint.searchParams.set("interval", interval); endpoint.searchParams.set("limit", String(limit));
    const upstream = await fetch(endpoint.toString(), { headers: { accept: "application/json" }, cf: { cacheTtl: 10, cacheEverything: true } } as RequestInit);
    if (!upstream.ok) return Response.json({ error: "Binance candle feed unavailable." }, { status: 502 });
    const data = await upstream.json();
    return Response.json({ data, source: "Binance Spot", receivedAt: new Date().toISOString() }, { headers: { "cache-control": "public, max-age=5, s-maxage=10" } });
  } catch { return Response.json({ error: "Unable to reach Binance candle data." }, { status: 502 }); }
};
