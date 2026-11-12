/**
 * Split the unseen chronological segment into non-overlapping evaluation folds.
 * Each fold carries only a fixed pre-test warm-up window for indicator state.
 * The warm-up rows are excluded from metrics because simulate() starts at index warmup.
 *
 * This is sequential out-of-sample evaluation with a frozen training profile,
 * not a re-optimizing walk-forward procedure.
 */
export function createSequentialOosFolds(rows, testStartIndex, count = 3, warmup = 60) {
  if (!Array.isArray(rows) || !Number.isInteger(testStartIndex) ||
      !Number.isInteger(count) || !Number.isInteger(warmup) ||
      count < 1 || warmup < 1 || testStartIndex < warmup ||
      testStartIndex >= rows.length) return [];
  const remaining = rows.length - testStartIndex;
  if (remaining < count) return [];
  const baseLength = Math.floor(remaining / count);
  const folds = [];
  for (let n = 0; n < count; n++) {
    const testFrom = testStartIndex + n * baseLength;
    const testTo = n === count - 1 ? rows.length : testStartIndex + (n + 1) * baseLength;
    const dataFrom = Math.max(0, testFrom - warmup);
    const foldRows = rows.slice(dataFrom, testTo);
    const warmupCount = testFrom - dataFrom;
    if (foldRows.length - warmupCount < 1) continue;
    folds.push({
      index: n + 1,
      data: foldRows,
      warmupCount,
      testFrom,
      testTo,
      testStartTime: rows[testFrom].time,
      testEndTime: rows[testTo - 1].time,
    });
  }
  return folds;
}
