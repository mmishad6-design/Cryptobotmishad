/**
 * Strict, shared candle-flow calculations for live signals and historical tests.
 * rows must be chronological and contain Binance kline base volume + taker-buy base volume.
 */
export function calculateCandleFlow(rows, lookback = 20) {
  if (!Array.isArray(rows) || !Number.isInteger(lookback) || lookback < 1 || rows.length < lookback + 1) {
    return { valid: false, volumeValid: false, volumeRatio: null, takerRatio: null, reason: 'Insufficient candles for volume/taker-flow baseline.' };
  }
  const sample = rows.slice(-(lookback + 1));
  for (const row of sample) {
    if (!row || !Number.isFinite(row.volume) || row.volume <= 0 ||
        !Number.isFinite(row.takerBuy) || row.takerBuy < 0 || row.takerBuy > row.volume) {
      return { valid: false, volumeValid: false, volumeRatio: null, takerRatio: null, reason: 'Candle volume or taker-buy volume is missing or invalid.' };
    }
  }
  const averageVolume = sample.slice(0, lookback).reduce((sum, row) => sum + row.volume, 0) / lookback;
  const current = sample.at(-1);
  const volumeRatio = averageVolume > 0 ? current.volume / averageVolume : null;
  const sellVolume = current.volume - current.takerBuy;
  const takerRatio = sellVolume > 0 ? current.takerBuy / sellVolume : null;
  if (!Number.isFinite(volumeRatio) || volumeRatio <= 0) {
    return { valid: false, volumeValid: false, volumeRatio: null, takerRatio, reason: 'Volume baseline is invalid.' };
  }
  return {
    valid: Number.isFinite(takerRatio) && takerRatio > 0,
    volumeValid: true,
    volumeRatio,
    takerRatio,
    reason: Number.isFinite(takerRatio) && takerRatio > 0 ? null : 'Taker-buy/sell ratio is undefined or invalid.',
  };
}

/**
 * Validate a REST top-20 depth snapshot. Binance depth has no exchange event
 * timestamp in this response, so this checks payload integrity and request latency;
 * it does not claim to prove server-side snapshot age.
 */
export function calculateOrderBookDepth(book, { requestedAt, receivedAt, maxRequestMs = 8000 } = {}) {
  const requestDurationMs = receivedAt - requestedAt;
  if (!book || !Array.isArray(book.bids) || !Array.isArray(book.asks) ||
      !Number.isFinite(requestedAt) || !Number.isFinite(receivedAt) ||
      !Number.isFinite(requestDurationMs) || requestDurationMs < 0 || requestDurationMs > maxRequestMs) {
    return { ok: false, reason: 'Missing, malformed, or slow order-book response.' };
  }
  if (!book.bids.length || !book.asks.length || book.bids.length > 20 || book.asks.length > 20) {
    return { ok: false, reason: 'Expected 1–20 bid and ask levels.' };
  }
  const sumSide = levels => {
    let total = 0;
    for (const level of levels) {
      const price = Number(level?.[0]), quantity = Number(level?.[1]);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) return null;
      total += price * quantity;
    }
    return Number.isFinite(total) && total > 0 ? total : null;
  };
  const bidValue = sumSide(book.bids), askValue = sumSide(book.asks);
  if (!Number.isFinite(bidValue) || !Number.isFinite(askValue)) {
    return { ok: false, reason: 'Order-book levels contain invalid prices or quantities.' };
  }
  return { ok: true, bidValue, askValue, depthRatio: bidValue / askValue, requestDurationMs };
}
