import { findConfirmedSwingPivots } from './marketStructure.js';

/**
 * Classify only the latest completed candle's structure event.
 * A break requires a close crossing the latest confirmed swing level from
 * the other side; remaining beyond a level does not emit repeated events.
 */
export function evaluateStructureEvent(rows, pivots = findConfirmedSwingPivots(rows, 3)) {
  if (!Array.isArray(rows) || rows.length < 2) {
    return { structure: 'NEUTRAL', bos: 'NONE', choch: 'NONE', sweep: 'NONE' };
  }
  const last = rows.at(-1);
  const previous = rows.at(-2);
  if (![last?.open, last?.high, last?.low, last?.close, previous?.close].every(Number.isFinite)) {
    return { structure: 'NEUTRAL', bos: 'NONE', choch: 'NONE', sweep: 'NONE' };
  }
  const highs = pivots.filter(p => p.type === 'H' && p.confirmationIndex < rows.length - 1);
  const lows = pivots.filter(p => p.type === 'L' && p.confirmationIndex < rows.length);
  const lastHigh = highs.at(-1);
  const lastLow = lows.at(-1);
  const priorHigh = highs.at(-2);
  const priorLow = lows.at(-2);
  const bullish = !!lastHigh && !!lastLow && !!priorHigh && !!priorLow &&
    lastHigh.price > priorHigh.price && lastLow.price > priorLow.price;
  const bearish = !!lastHigh && !!lastLow && !!priorHigh && !!priorLow &&
    lastHigh.price < priorHigh.price && lastLow.price < priorLow.price;
  const bullishBreak = !!lastHigh && previous.close <= lastHigh.price && last.close > lastHigh.price;
  const bearishBreak = !!lastLow && previous.close >= lastLow.price && last.close < lastLow.price;
  const bos = bullishBreak ? 'BULLISH' : bearishBreak ? 'BEARISH' : 'NONE';
  const choch = bullishBreak && bearish ? 'BULLISH' : bearishBreak && bullish ? 'BEARISH' : 'NONE';
  const sweep = lastHigh && last.high > lastHigh.price && last.close <= lastHigh.price
    ? 'HIGH-SIDE'
    : lastLow && last.low < lastLow.price && last.close >= lastLow.price
      ? 'LOW-SIDE'
      : 'NONE';
  return { structure: bullish ? 'BULLISH' : bearish ? 'BEARISH' : 'NEUTRAL', bos, choch, sweep };
}
