import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateTimeframeProfile } from '../src/timeframeBacktest.js';
import { TIMEFRAME_INTERVAL_MS } from '../src/timeframeSelection.js';

function makeRows(frame, count = 150) {
  const executionStart = 1_700_000_000_000;
  const historyBars = 149;
  const start = executionStart - historyBars * TIMEFRAME_INTERVAL_MS[frame];
  const interval = TIMEFRAME_INTERVAL_MS[frame];
  return Array.from({ length: count }, (_, index) => {
    const time = start + index * interval;
    const close = 100 + index * 0.05;
    return {
      time, closeTime: time + interval - 1,
      open: close - 0.02, high: close + 0.2, low: close - 0.2, close,
      volume: 1000 + index, takerBuy: 700 + index * 0.7,
    };
  });
}

const frames = ['5m', '15m', '1h', '4h', '1d', '1w'];
const evaluateFrame = (rows, frame, decisionTime) => {
  if (rows.length) assert.ok(rows.at(-1).closeTime <= decisionTime, frame + ' leaked a candle that had not closed at decision time');
  const last = rows.at(-1);
  return {
    trend: 'BULLISH', rsi: 60, volumeRatio: 2, adx: 30, atr: 1,
    bos: 'BULLISH', choch: 'NONE', sweep: 'NONE',
    takerRatio: 2, close: last.close,
  };
};

for (const timeframe of ['5m', '15m', '1h']) {
  test(timeframe + ' AUTO candidate replays with its own entry candle interval', () => {
    const dataByFrame = Object.fromEntries(frames.map(frame => [frame, makeRows(frame)]));
    const result = simulateTimeframeProfile({ dataByFrame, timeframe, evaluateFrame });
    assert.equal(result.ok, true);
    assert.equal(result.timeframe, timeframe);
    assert.ok(result.signals > 0);
    assert.ok(result.tradeCount > 0);
  });
}

test('historical replay rejects a missing candle in any required context frame', () => {
  const dataByFrame = Object.fromEntries(frames.map(frame => [frame, makeRows(frame)]));
  dataByFrame['1w'].splice(40, 1);
  const result = simulateTimeframeProfile({ dataByFrame, timeframe: '1h', evaluateFrame });
  assert.equal(result.ok, false);
  assert.match(result.reason, /1w/);
});

test('historical replay rejects an unsupported execution timeframe', () => {
  const dataByFrame = Object.fromEntries(frames.map(frame => [frame, makeRows(frame)]));
  const result = simulateTimeframeProfile({ dataByFrame, timeframe: '4h', evaluateFrame });
  assert.equal(result.ok, false);
});
