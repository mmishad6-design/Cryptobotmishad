import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAdverseSlippage, calculateTradePnl, resolveIntrabarExit } from '../src/tradeExecution.js';

const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `expected ${actual} to be close to ${expected}`);

test('slippage moves fills against both LONG and SHORT positions', () => {
  approx(applyAdverseSlippage(100, 'LONG', 'ENTRY', 0.001), 100.1);
  approx(applyAdverseSlippage(100, 'LONG', 'EXIT', 0.001), 99.9);
  approx(applyAdverseSlippage(100, 'SHORT', 'ENTRY', 0.001), 99.9);
  approx(applyAdverseSlippage(100, 'SHORT', 'EXIT', 0.001), 100.1);
});

test('trade accounting deducts entry and exit fees for LONG and SHORT', () => {
  const long = calculateTradePnl({ side:'LONG', entry:100, exit:110, quantity:2, feeRate:0.001 });
  approx(long.grossPnl, 20);
  approx(long.entryFee, 0.2);
  approx(long.exitFee, 0.22);
  approx(long.netPnl, 19.58);
  const short = calculateTradePnl({ side:'SHORT', entry:100, exit:90, quantity:2, feeRate:0.001 });
  approx(short.netPnl, 19.62);
});

test('explicit entry fee is not charged twice', () => {
  const pnl = calculateTradePnl({ side:'LONG', entry:100, exit:100, quantity:1, feeRate:0.001, entryFee:0.2 });
  approx(pnl.entryFee, 0.2);
  approx(pnl.netPnl, -0.3);
});

test('same-candle stop and target collision resolves conservatively to stop first', () => {
  assert.deepEqual(resolveIntrabarExit({ side:'LONG', high:105, low:95, stop:97, target:103 }), { price:97, reason:'STOP LOSS' });
  assert.deepEqual(resolveIntrabarExit({ side:'SHORT', high:105, low:95, stop:103, target:97 }), { price:103, reason:'STOP LOSS' });
});

test('intrabar resolver supports target-only exits and rejects invalid inputs', () => {
  assert.deepEqual(resolveIntrabarExit({ side:'LONG', high:104, low:99, stop:97, target:103 }), { price:103, reason:'TAKE PROFIT' });
  assert.equal(resolveIntrabarExit({ side:'LONG', high:98, low:99, stop:97, target:103 }), null);
  assert.equal(applyAdverseSlippage(0, 'LONG', 'ENTRY', 0.001), null);
  assert.equal(calculateTradePnl({ side:'WAIT', entry:100, exit:101, quantity:1 }).ok, false);
});

test('stop-loss gap through fills at the worse candle open', () => {
  assert.deepEqual(resolveIntrabarExit({ side:'LONG', open:94, high:99, low:93, stop:97, target:105 }), { price:94, reason:'STOP LOSS' });
  assert.deepEqual(resolveIntrabarExit({ side:'SHORT', open:106, high:107, low:101, stop:103, target:95 }), { price:106, reason:'STOP LOSS' });
});

test('ordinary stop touch fills at stop and favorable target gap is capped at target', () => {
  assert.deepEqual(resolveIntrabarExit({ side:'LONG', open:99, high:101, low:96, stop:97, target:105 }), { price:97, reason:'STOP LOSS' });
  assert.deepEqual(resolveIntrabarExit({ side:'LONG', open:108, high:110, low:106, stop:97, target:105 }), { price:105, reason:'TAKE PROFIT' });
});

test('same-candle stop and target collision still prioritizes stop, including a gap', () => {
  assert.deepEqual(resolveIntrabarExit({ side:'LONG', open:94, high:106, low:93, stop:97, target:105 }), { price:94, reason:'STOP LOSS' });
});
