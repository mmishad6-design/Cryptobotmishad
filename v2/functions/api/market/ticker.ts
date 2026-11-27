const ALLOWED = /^[A-Z0-9]{2,20}USDT$/;
export const onRequestGet = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const symbols = (url.searchParams.get("symbols") || "BTCUSDT,ETHUSDT,SUIUSDT,SOLUSDT").split(",").map((s) => s.trim().toUpperCase());
  if (!symbols.length || symbols.length > 20 || symbols.some((s) => !ALLOWED.test(s))) return Response.json({ error: "Invalid symbols. Use up to 20 USDT pairs." }, { status: 400 });
  try {
    const upstream = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbols=" + encodeURIComponent(JSON.stringify([...new Set(symbols)])), { headers: { accept: "application/json" }, cf: { cacheTtl: 5, cacheEverything: true } } as RequestInit);
    if (!upstream.ok) return Response.json({ error: "Binance market feed unavailable." }, { status: 502 });
    const rows = await upstream.json() as Array<Record<string, string>>;
    const data = rows.map((row) => ({ symbol: row.symbol, lastPrice: row.lastPrice, priceChangePercent: row.priceChangePercent, quoteVolume: row.quoteVolume, highPrice: row.highPrice, lowPrice: row.lowPrice }));
    return Response.json({ data, source: "Binance Spot", receivedAt: new Date().toISOString() }, { headers: { "cache-control": "public, max-age=3, s-maxage=5" } });
  } catch { return Response.json({ error: "Unable to reach Binance market data." }, { status: 502 }); }
};
