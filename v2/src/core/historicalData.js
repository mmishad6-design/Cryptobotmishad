/**
 * Return only candles that had fully closed by the decision timestamp.
 * Input rows must be sorted by closeTime ascending (as Binance klines are).
 */
export function selectClosedCandlesAsOf(rows, decisionTime, limit = 120) {
  if (!Array.isArray(rows) || !Number.isFinite(decisionTime) ||
      !Number.isInteger(limit) || limit <= 0) return [];
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const closeTime = rows[mid]?.closeTime;
    if (Number.isFinite(closeTime) && closeTime <= decisionTime) low = mid + 1;
    else high = mid;
  }
  return rows.slice(Math.max(0, low - limit), low);
}
