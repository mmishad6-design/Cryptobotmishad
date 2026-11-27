const SYMBOL = /^[A-Z0-9]{2,20}USDT$/;
const INTERVALS = new Set(["1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w","1M"]);
const BYBIT_INTERVAL: Record<string, string> = {
  "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30",
  "1h": "60", "2h": "120", "4h": "240", "6h": "360", "8h": "480",
  "12h": "720", "1d": "D", "1w": "W", "1M": "M",
};

type Kline = [number, string, string, string, string, string, number, string, number, string, string, string];

function candleCloseTime(start: number, interval: string): number {
  if (interval === "1M") {
    const date = new Date(start);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 1;
  }
  const duration = interval === "1w" ? 7 * 24 * 60 * 60 * 1000
    : interval === "1d" ? 24 * 60 * 60 * 1000
    : Number.parseInt(interval, 10) * (interval.endsWith("m") ? 60_000 : 3_600_000);
  return start + duration - 1;
}

async function fromBinance(symbol: string, interval: string, limit: number): Promise<Kline[] | null> {
  try {
    const endpoint = new URL("https://api.binance.com/api/v3/klines");
    endpoint.searchParams.set("symbol", symbol);
    endpoint.searchParams.set("interval", interval);
    endpoint.searchParams.set("limit", String(limit));
    const response = await fetch(endpoint.toString(), {
      headers: { accept: "application/json" },
      cf: { cacheTtl: 8, cacheEverything: true },
    } as RequestInit);
    if (!response.ok) return null;
    return await response.json() as Kline[];
  } catch { return null; }
}

async function fromBybit(symbol: string, interval: string, limit: number): Promise<Kline[] | null> {
  const isThreeDay = interval === "3d";
  const bybitInterval = isThreeDay ? "D" : BYBIT_INTERVAL[interval];
  if (!bybitInterval) return null;
  try {
    const endpoint = new URL("https://api.bybit.com/v5/market/kline");
    endpoint.searchParams.set("category", "spot");
    endpoint.searchParams.set("symbol", symbol);
    endpoint.searchParams.set("interval", bybitInterval);
    endpoint.searchParams.set("limit", String(Math.min(isThreeDay ? limit * 3 : limit, 1000)));
    const response = await fetch(endpoint.toString(), {
      headers: { accept: "application/json" },
      cf: { cacheTtl: 8, cacheEverything: true },
    } as RequestInit);
    if (!response.ok) return null;
    const payload = await response.json() as {
      retCode?: number;
      result?: { list?: string[][] };
    };
    if (payload.retCode !== 0 || !payload.result?.list?.length) return null;
    const daily = payload.result.list.map(row => [
      Number(row[0]), row[1], row[2], row[3], row[4], row[5], candleCloseTime(Number(row[0]), "1d"), "", 0, "", "", "",
    ] as Kline).reverse();
    if (!isThreeDay) return daily.map(candle => { candle[6] = candleCloseTime(candle[0], interval); return candle; });

    const bucketMs = 3 * 24 * 60 * 60 * 1000;
    // Binance 3d candles are anchored at 2017-08-17 00:00 UTC
    // (one day after the Unix epoch modulo a three-day interval).
    const bucketOffset = 24 * 60 * 60 * 1000;
    const buckets = new Map<number, Kline>();
    for (const candle of daily) {
      const bucketStart = Math.floor((candle[0] - bucketOffset) / bucketMs) * bucketMs + bucketOffset;
      const existing = buckets.get(bucketStart);
      if (!existing) {
        buckets.set(bucketStart, [
          bucketStart, candle[1], candle[2], candle[3], candle[4], candle[5],
          bucketStart + bucketMs - 1, "", 0, "", "", "",
        ]);
      } else {
        existing[2] = String(Math.max(Number(existing[2]), Number(candle[2])));
        existing[3] = String(Math.min(Number(existing[3]), Number(candle[3])));
        existing[4] = candle[4];
        existing[5] = String(Number(existing[5]) + Number(candle[5]));
      }
    }
    return [...buckets.values()].slice(-limit);
  } catch { return null; }
}

export const onRequestGet = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") || "BTCUSDT").toUpperCase();
  const interval = url.searchParams.get("interval") || "1h";
  const limit = Number(url.searchParams.get("limit") || 500);
  if (!SYMBOL.test(symbol)) return Response.json({ error: "Invalid USDT symbol." }, { status: 400 });
  if (!INTERVALS.has(interval)) return Response.json({ error: "Unsupported candle interval." }, { status: 400 });
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return Response.json({ error: "Limit must be between 1 and 1000." }, { status: 400 });

  const binance = await fromBinance(symbol, interval, limit);
  if (binance) {
    return Response.json({ data: binance, source: "Binance Spot REST", receivedAt: new Date().toISOString() }, {
      headers: { "cache-control": "public, max-age=4, s-maxage=8" },
    });
  }
  const bybit = await fromBybit(symbol, interval, limit);
  if (bybit) {
    return Response.json({ data: bybit, source: "Bybit Spot REST (fallback)", receivedAt: new Date().toISOString() }, {
      headers: { "cache-control": "public, max-age=4, s-maxage=8" },
    });
  }
  return Response.json({ error: "Binance and Bybit candle feeds are unavailable for this interval." }, { status: 502 });
};
