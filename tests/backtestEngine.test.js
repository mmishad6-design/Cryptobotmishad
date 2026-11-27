import test from 'node:test';
import assert from 'node:assert/strict';
import { runHistoricalBacktest } from '../v2/src/core/backtestEngine.js';

function candles(overrides = {}) {
  return Array.from({ length: 8 }, (_, i) => ({
    time: i * 60_000, open: 100, high: 101, low: 99, close: 100,
    ...overrides[i],
  }));
}
const longSignal = {
  decision: 'LONG',
  riskPlan: { ok: true, stopDistance: 2, rewardDistance: 4, quantity: 1 },
};

test('enters on the candle after the signal and calculates a target win net of costs', () => {
  const rows = candles({ 4: { high: 105, low: 99, close: 104 } });
  const result = runHistoricalBacktest({
    candles: rows, warmup: 2, feeRate: 0, slippageRate: 0,
    evaluate: (history, index) => {
      assert.equal(history.length, index + 1);
      assert.equal(history.at(-1).time, rows[index].time);
      return index === 2 ? longSignal : null;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].entryTime, rows[3].time);
  assert.equal(result.trades[0].exitTime, rows[4].time);
  assert.equal(result.trades[0].exitReason, 'টেক প্রফিট');
  assert.equal(result.trades[0].netPnl, 4);
  assert.equal(result.metrics.winRatePct, 100);
});

test('uses conservative stop-first resolution when stop and target hit in one candle', () => {
  const rows = candles({ 4: { high: 105, low: 97, close: 103 } });
  const result = runHistoricalBacktest({
    candles: rows, warmup: 2, feeRate: 0, slippageRate: 0,
    evaluate: (_, index) => index === 2 ? longSignal : null,
  });
  assert.equal(result.trades[0].exitReason, 'স্টপ লস');
  assert.equal(result.trades[0].netPnl, -2);
});

test('does not allow SHORT signals in Spot mode', () => {
  const rows = candles();
  const result = runHistoricalBacktest({
    candles: rows, warmup: 2, market: 'Spot',
    evaluate: () => ({ ...longSignal, decision: 'SHORT' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.trades.length, 0);
});

test('rejects malformed candle history and insufficient warm-up', () => {
  assert.equal(runHistoricalBacktest({ candles: candles().slice(0, 3), warmup: 3, evaluate: () => null }).ok, false);
  const invalid = candles();
  invalid[4].high = 90;
  assert.equal(runHistoricalBacktest({ candles: invalid, warmup: 2, evaluate: () => null }).ok, false);
});

test('reports no-lookahead callback boundary and risk-adjusted metrics', () => {
  const rows = candles({ 4: { high: 105, low: 99, close: 104 } });
  let maxHistory = 0;
  const result = runHistoricalBacktest({
    candles: rows, warmup: 2, feeRate: 0.0005, slippageRate: 0.0002,
    evaluate: (history, index) => {
      maxHistory = Math.max(maxHistory, history.length);
      assert.ok(history.length <= rows.length - 1);
      return index === 2 ? longSignal : null;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(maxHistory, rows.length - 1);
  assert.ok(result.metrics.feesPaid > 0);
  assert.ok(Number.isFinite(result.metrics.maxDrawdownPct));
  assert.ok(Number.isFinite(result.metrics.expectancy));
});
