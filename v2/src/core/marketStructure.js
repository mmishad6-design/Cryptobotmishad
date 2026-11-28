/**
 * Detect swing pivots only after the required right-side candles exist.
 * A pivot at index i is confirmed at i + radius; no candle after the supplied
 * rows array is ever consulted. Equal highs/lows invalidate a pivot.
 */
export function findConfirmedSwingPivots(rows, radius = 3) {
  if (!Array.isArray(rows) || !Number.isInteger(radius) || radius < 1) return [];
  const pivots = [];
  for (let i = radius; i + radius < rows.length; i++) {
    const candidate = rows[i];
    if (!candidate || !Number.isFinite(candidate.high) || !Number.isFinite(candidate.low)) continue;
    let swingHigh = true;
    let swingLow = true;
    for (let j = i - radius; j <= i + radius; j++) {
      if (j === i) continue;
      const neighbor = rows[j];
      if (!neighbor || !Number.isFinite(neighbor.high) || !Number.isFinite(neighbor.low)) {
        swingHigh = false;
        swingLow = false;
        break;
      }
      if (neighbor.high >= candidate.high) swingHigh = false;
      if (neighbor.low <= candidate.low) swingLow = false;
    }
    if (swingHigh) pivots.push({ type: 'H', index: i, confirmationIndex: i + radius, price: candidate.high });
    if (swingLow) pivots.push({ type: 'L', index: i, confirmationIndex: i + radius, price: candidate.low });
  }
  return pivots;
}
