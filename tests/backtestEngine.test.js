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

import { createSequentialOosFolds, aggregateWalkForwardResults } from '../v2/src/core/walkForward.js';

test('walk-forward creates isolated chronological folds with pre-test warmup', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ time: i + 1, value: i }));
  const folds = createSequentialOosFolds(rows, 60, 3, 5);
  assert.equal(folds.length, 3);
  assert.deepEqual(folds.map(f => [f.testFrom, f.testTo, f.warmupCount]), [[60,73,5],[73,86,5],[86,100,5]]);
  assert.equal(folds[0].data.at(-1).time, 73);
  assert.equal(folds[1].data[0].time, 69);
  assert.equal(folds[0].data.some(r => r.time >= 74), false);
});
test('walk-forward rejects unordered rows and invalid split parameters', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ time: i + 1 }));
  assert.deepEqual(createSequentialOosFolds(rows.slice().reverse(), 60, 3, 5), []);
  assert.deepEqual(createSequentialOosFolds(rows, 2, 3, 5), []);
});
test('walk-forward aggregates OOS results and reports worst fold drawdown', () => {
  const result = aggregateWalkForwardResults([
    { ok:true, trades:[{netPnl:10,rMultiple:1,fees:1},{netPnl:-4,rMultiple:-.4,fees:1}], metrics:{maxDrawdownPct:4} },
    { ok:true, trades:[{netPnl:6,rMultiple:.6,fees:2}], metrics:{maxDrawdownPct:7} },
  ], 1000);
  assert.equal(result.tradeCount, 3); assert.equal(result.netPnl, 12);
  assert.equal(result.maxDrawdownPct, 7); assert.equal(result.feesPaid, 4);
  assert.equal(result.profitFactor, 4);
});

import { classifyMarketRegimes, summarizeRegimePerformance } from '../v2/src/core/robustness.js';

test('market regime classification uses trailing-only data and labels volatility', () => {
  const rows = Array.from({length:70},(_,i)=>({time:i+1,close:100+i*.2}));
  const labels = classifyMarketRegimes(rows,10,0.004);
  assert.equal(labels.length,70);
  assert.equal(labels[9].regime,'INSUFFICIENT');
  assert.match(labels[20].regime,/^UP_(HIGH|LOW)$/);
  const alteredFuture = rows.map(x=>({...x}));
  alteredFuture[60].close = 1;
  const changed = classifyMarketRegimes(alteredFuture,10,0.004);
  assert.equal(changed[30].regime,labels[30].regime);
});
test('regime report groups trades by signal close and calculates metrics', () => {
  const report = summarizeRegimePerformance([
    {signalTime:10,netPnl:5},{signalTime:10,netPnl:-2},{signalTime:20,netPnl:4}
  ],[{time:10,regime:'UP_HIGH'},{time:20,regime:'RANGE_LOW'}]);
  assert.equal(report.length,2);
  assert.equal(report.find(x=>x.regime==='UP_HIGH').tradeCount,2);
  assert.equal(report.find(x=>x.regime==='UP_HIGH').netPnl,3);
  assert.equal(report.find(x=>x.regime==='UP_HIGH').winRatePct,50);
});
