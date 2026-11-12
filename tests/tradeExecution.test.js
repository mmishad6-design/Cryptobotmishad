import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAdverseSlippage, calculateTradePnl, resolveIntrabarExit } from '../src/tradeExecution.js';

test('slippage moves fills against both LONG and SHORT positions', () => {
  assert.equal(applyAdverseSlippage(100, 'LONG', 'ENTRY', 0.001), 100.1);
  assert.equal(applyAdverseSlippage(100, 'LONG', 'EXIT', 0.001), 99.9);
  assert.equal(applyAdverseSlippage(100, 'SHORT', 'ENTRY', 0.001), 99.9);
  assert.equal(applyAdverseSlippage(100, 'SHORT', 'EXIT', 0.001), 100.1);
});

test('trade accounting deducts entry and exit fees for LONG and SHORT', () => {
  const long = calculateTradePnl({ side:'LONG', entry:100, exit:110, quantity:2, feeRate:0.001 });
  assert.equal(long.grossPnl, 20);
  assert.equal(long.entryFee, 0.2);
  assert.equal(long.exitFee, 0.22);
  assert.equal(long.netPnl, 19.58);
  const short = calculateTradePnl({ side:'SHORT', entry:100, exit:90, quantity:2, feeRate:0.001 });
  assert.equal(short.netPnl, 19.62);
});

test('explicit entry fee is not charged twice', () => {
  const pnl = calculateTradePnl({ side:'LONG', entry:100, exit:100, quantity:1, feeRate:0.001, entryFee:0.2 });
  assert.equal(pnl.entryFee, 0.2);
  assert.equal(pnl.netPnl, -0.3);
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
