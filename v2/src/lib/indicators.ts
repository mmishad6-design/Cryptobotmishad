import type { Kline } from "./market";

export type IndicatorPoint = { time: number; value: number };
export type IndicatorResult = {
  ema20: IndicatorPoint[];
  ema50: IndicatorPoint[];
  ema200: IndicatorPoint[];
  vwap: IndicatorPoint[];
  bbUpper: IndicatorPoint[];
  bbLower: IndicatorPoint[];
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  atr14: number | null;
};

function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return out;
  const multiplier = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  out[period - 1] = current;
  for (let i = period; i < values.length; i++) {
    current = (values[i] - current) * multiplier + current;
    out[i] = current;
  }
  return out;
}

function points(candles: Kline[], values: Array<number | null>): IndicatorPoint[] {
  return candles.flatMap((candle, index) => values[index] === null ? [] : [{
    time: Math.floor(Number(candle[0]) / 1000),
    value: values[index] as number,
  }]);
}

export function calculateIndicators(candles: Kline[]): IndicatorResult {
  const close = candles.map(k => Number(k[4]));
  const high = candles.map(k => Number(k[2]));
  const low = candles.map(k => Number(k[3]));
  const volume = candles.map(k => Number(k[5]));
  const ema20 = ema(close, 20);
  const ema50 = ema(close, 50);
  const ema200 = ema(close, 200);

  const upper: Array<number | null> = Array(close.length).fill(null);
  const lower: Array<number | null> = Array(close.length).fill(null);
  for (let i = 19; i < close.length; i++) {
    const window = close.slice(i - 19, i + 1);
    const mean = window.reduce((sum, n) => sum + n, 0) / 20;
    const variance = window.reduce((sum, n) => sum + (n - mean) ** 2, 0) / 20;
    const deviation = Math.sqrt(variance) * 2;
    upper[i] = mean + deviation;
    lower[i] = mean - deviation;
  }

  const vwapValues: Array<number | null> = [];
  let cumulativePV = 0;
  let cumulativeVolume = 0;
  for (let i = 0; i < candles.length; i++) {
    const typical = (high[i] + low[i] + close[i]) / 3;
    cumulativePV += typical * volume[i];
    cumulativeVolume += volume[i];
    vwapValues.push(cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : null);
  }

  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < close.length; i++) {
    const change = close[i] - close[i - 1];
    gains.push(Math.max(change, 0));
    losses.push(Math.max(-change, 0));
  }
  let avgGain = gains.length >= 14 ? gains.slice(0, 14).reduce((a, b) => a + b, 0) / 14 : 0;
  let avgLoss = losses.length >= 14 ? losses.slice(0, 14).reduce((a, b) => a + b, 0) / 14 : 0;
  let rsi14: number | null = null;
  if (gains.length >= 14) {
    for (let i = 14; i < gains.length; i++) {
      avgGain = (avgGain * 13 + gains[i]) / 14;
      avgLoss = (avgLoss * 13 + losses[i]) / 14;
    }
    rsi14 = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  const ema12 = ema(close, 12);
  const ema26 = ema(close, 26);
  const macdValues = close.map((_, i) => ema12[i] !== null && ema26[i] !== null ? (ema12[i] as number) - (ema26[i] as number) : null);
  const macdCompact = macdValues.filter((v): v is number => v !== null);
  const signalCompact = ema(macdCompact, 9);
  const macd = macdCompact.length ? macdCompact[macdCompact.length - 1] : null;
  const macdSignal = signalCompact.length ? signalCompact[signalCompact.length - 1] : null;

  const trueRanges = candles.map((_, i) => i === 0 ? high[i] - low[i] : Math.max(
    high[i] - low[i],
    Math.abs(high[i] - close[i - 1]),
    Math.abs(low[i] - close[i - 1]),
  ));
  let atr14: number | null = null;
  if (trueRanges.length >= 14) {
    atr14 = trueRanges.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
    for (let i = 14; i < trueRanges.length; i++) atr14 = ((atr14 as number) * 13 + trueRanges[i]) / 14;
  }

  return {
    ema20: points(candles, ema20),
    ema50: points(candles, ema50),
    ema200: points(candles, ema200),
    vwap: points(candles, vwapValues),
    bbUpper: points(candles, upper),
    bbLower: points(candles, lower),
    rsi14,
    macd,
    macdSignal,
    atr14,
  };
}

export function getEmaTrend(candles: Kline[]): "Bullish" | "Bearish" | "Neutral" {
  const close = candles.map(k => Number(k[4]));
  const fast = ema(close, 20);
  const slow = ema(close, 50);
  const last = close.length - 1;
  if (last < 49 || fast[last] === null || slow[last] === null) return "Neutral";
  if (close[last] > (fast[last] as number) && (fast[last] as number) > (slow[last] as number)) return "Bullish";
  if (close[last] < (fast[last] as number) && (fast[last] as number) < (slow[last] as number)) return "Bearish";
  return "Neutral";
}
