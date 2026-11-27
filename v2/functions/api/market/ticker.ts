const ALLOWED = /^[A-Z0-9]{2,20}USDT$/;

type TickerRow = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
};

const jsonHeaders = { accept: "application/json" };
const cacheOptions = { headers: jsonHeaders, cf: { cacheTtl: 3, cacheEverything: true } } as RequestInit;

async function fromBinance(symbols: string[]): Promise<TickerRow[] | null> {
  try {
    const endpoint = "https://api.binance.com/api/v3/ticker/24hr?symbols=" + encodeURIComponent(JSON.stringify(symbols));
    const response = await fetch(endpoint, cacheOptions);
    if (!response.ok) return null;
    const rows = await response.json() as Array<Record<string, string>>;
    const mapped = rows.map(row => ({
      symbol: row.symbol,
      lastPrice: row.lastPrice,
      priceChangePercent: row.priceChangePercent,
      quoteVolume: row.quoteVolume,
      highPrice: row.highPrice,
      lowPrice: row.lowPrice,
    }));
    return mapped.length === symbols.length ? mapped : null;
  } catch { return null; }
}

async function fromBybit(symbols: string[]): Promise<TickerRow[] | null> {
  try {
    const rows = await Promise.all(symbols.map(async symbol => {
      const endpoint = new URL("https://api.bybit.com/v5/market/tickers");
      endpoint.searchParams.set("category", "spot");
      endpoint.searchParams.set("symbol", symbol);
      const response = await fetch(endpoint.toString(), cacheOptions);
      if (!response.ok) return null;
      const payload = await response.json() as {
        retCode?: number;
        result?: { list?: Array<Record<string, string>> };
      };
      const row = payload.result?.list?.[0];
      if (payload.retCode !== 0 || !row?.lastPrice) return null;
      return {
        symbol: row.symbol,
        lastPrice: row.lastPrice,
        priceChangePercent: String(Number(row.price24hPcnt) * 100),
        quoteVolume: row.turnover24h ?? "",
        highPrice: row.highPrice24h ?? "",
        lowPrice: row.lowPrice24h ?? "",
      };
    }));
    if (rows.some(row => row === null)) return null;
    return rows.filter((row): row is TickerRow => row !== null);
  } catch { return null; }
}

export const onRequestGet = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const requested = (url.searchParams.get("symbols") || "BTCUSDT,ETHUSDT,SUIUSDT,SOLUSDT").split(",").map(s => s.trim().toUpperCase());
  if (!requested.length || requested.length > 20 || requested.some(s => !ALLOWED.test(s))) {
    return Response.json({ error: "Invalid symbols. Use up to 20 USDT pairs." }, { status: 400 });
  }
  const symbols = [...new Set(requested)];
  const binance = await fromBinance(symbols);
  if (binance) {
    return Response.json({ data: binance, source: "Binance Spot REST", receivedAt: new Date().toISOString() }, {
      headers: { "cache-control": "public, max-age=2, s-maxage=3" },
    });
  }
  const bybit = await fromBybit(symbols);
  if (bybit) {
    return Response.json({ data: bybit, source: "Bybit Spot REST (fallback)", receivedAt: new Date().toISOString() }, {
      headers: { "cache-control": "public, max-age=2, s-maxage=3" },
    });
  }
  return Response.json({ error: "Binance and Bybit market feeds are unavailable." }, { status: 502 });
};
