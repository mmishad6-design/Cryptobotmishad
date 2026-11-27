export type MarketTicker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
};

type ApiEnvelope<T> = {
  data: T;
  source: string;
  receivedAt: string;
};

const API_BASE = import.meta.env.VITE_MARKET_API_BASE ?? "";

async function request<T>(path: string): Promise<ApiEnvelope<T>> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? `Market API error (${response.status})`);
  }
  return response.json() as Promise<ApiEnvelope<T>>;
}

export function getMarketTickers(symbols = ["BTCUSDT", "ETHUSDT", "SUIUSDT", "SOLUSDT"]) {
  return request<MarketTicker[]>(`/api/market/ticker?symbols=${encodeURIComponent(symbols.join(","))}`);
}

export type Kline = [number, string, string, string, string, string, number, string, number, string, string, string];

export function normalizeKlines(candles: Kline[]): Kline[] {
  const byTime = new Map<number, Kline>();
  for (const candle of candles) {
    if (!Array.isArray(candle) || candle.length < 6) continue;
    const time = Number(candle[0]);
    const open = Number(candle[1]);
    const high = Number(candle[2]);
    const low = Number(candle[3]);
    const close = Number(candle[4]);
    const volume = Number(candle[5]);
    if (![time, open, high, low, close, volume].every(Number.isFinite)) continue;
    if (time <= 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) continue;
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) continue;
    byTime.set(time, candle);
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-500)
    .map(([, candle]) => candle);
}

export async function getMarketKlines(symbol = "BTCUSDT", interval = "1h", limit = 500) {
  const result = await request<Kline[]>(`/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`);
  return { ...result, data: normalizeKlines(result.data) };
}
