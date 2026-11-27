/**
 * Strict, shared candle-flow calculations for live signals and historical tests.
 * rows must be chronological and contain Binance kline base volume + taker-buy base volume.
 */
export function calculateCandleFlow(rows, lookback = 20) {
  if (!Array.isArray(rows) || !Number.isInteger(lookback) || lookback < 1 || rows.length < lookback + 1) {
    return { valid: false, volumeValid: false, volumeRatio: null, takerRatio: null, reason: 'Volume ও Taker Flow-এর ভিত্তি হিসাবের জন্য পর্যাপ্ত Candle নেই।' };
  }
  const sample = rows.slice(-(lookback + 1));
  for (const row of sample) {
    if (!row || !Number.isFinite(row.volume) || row.volume <= 0 ||
        !Number.isFinite(row.takerBuy) || row.takerBuy < 0 || row.takerBuy > row.volume) {
      return { valid: false, volumeValid: false, volumeRatio: null, takerRatio: null, reason: 'Candle Volume অথবা Taker Buy Volume অনুপস্থিত কিংবা ভুল।' };
    }
  }
  const averageVolume = sample.slice(0, lookback).reduce((sum, row) => sum + row.volume, 0) / lookback;
  const current = sample.at(-1);
  const volumeRatio = averageVolume > 0 ? current.volume / averageVolume : null;
  const sellVolume = current.volume - current.takerBuy;
  const takerRatio = sellVolume > 0 ? current.takerBuy / sellVolume : null;
  if (!Number.isFinite(volumeRatio) || volumeRatio <= 0) {
    return { valid: false, volumeValid: false, volumeRatio: null, takerRatio, reason: 'Volume-এর ভিত্তি হিসাব সঠিক নয়।' };
  }
  return {
    valid: Number.isFinite(takerRatio) && takerRatio > 0,
    volumeValid: true,
    volumeRatio,
    takerRatio,
    reason: Number.isFinite(takerRatio) && takerRatio > 0 ? null : 'Taker Buy/Sell Ratio নির্ধারণ করা যায়নি অথবা মানটি ভুল।',
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
    return { ok: false, reason: 'Order Book-এর উত্তর পাওয়া যায়নি, ডেটা ভুল অথবা সাড়া দিতে বেশি সময় লেগেছে।' };
  }
  if (!book.bids.length || !book.asks.length || book.bids.length > 20 || book.asks.length > 20) {
    return { ok: false, reason: 'Bid ও Ask—উভয় পাশে ১ থেকে ২০টি Level প্রত্যাশিত ছিল।' };
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
    return { ok: false, reason: 'Order Book-এর Level-এ Price অথবা Quantity-এর মান ভুল।' };
  }
  return { ok: true, bidValue, askValue, depthRatio: bidValue / askValue, requestDurationMs };
}
