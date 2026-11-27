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

export function getMarketKlines(symbol = "BTCUSDT", interval = "1h", limit = 500) {
  return request<Kline[]>(`/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`);
}
