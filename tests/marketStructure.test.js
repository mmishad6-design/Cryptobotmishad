import test from 'node:test';
import assert from 'node:assert/strict';
import { findConfirmedSwingPivots } from '../src/marketStructure.js';

const candles = (highs, lows = highs.map(x => x - 10)) =>
  highs.map((high, i) => ({ high, low: lows[i] }));

test('pivot is not returned until all three right-side candles exist', () => {
  // Three candles on both sides are required for a radius-3 swing pivot.
  const rows = candles([0, 1, 2, 5, 3, 2, 1]);
  assert.deepEqual(findConfirmedSwingPivots(rows.slice(0, 6), 3), []);
  const pivots = findConfirmedSwingPivots(rows, 3);
  assert.deepEqual(pivots.filter(x => x.type === 'H'), [
    { type: 'H', index: 3, confirmationIndex: 6, price: 5 },
  ]);
});

test('equal highs and lows invalidate a swing pivot', () => {
  const rows = candles([1, 2, 5, 3, 5, 1], [9, 8, 4, 6, 4, 9]);
  const pivots = findConfirmedSwingPivots(rows, 2);
  assert.equal(pivots.some(x => x.type === 'H' && x.index === 2), false);
  assert.equal(pivots.some(x => x.type === 'L' && x.index === 2), false);
});

test('every returned pivot confirmation index is within supplied closed rows', () => {
  const rows = candles([1, 3, 2, 6, 2, 1, 4, 2, 1]);
  const pivots = findConfirmedSwingPivots(rows, 2);
  assert.ok(pivots.length > 0);
  for (const pivot of pivots) {
    assert.equal(pivot.confirmationIndex, pivot.index + 2);
    assert.ok(pivot.confirmationIndex < rows.length);
  }
});

test('invalid input and radius are safely rejected', () => {
  assert.deepEqual(findConfirmedSwingPivots(null, 3), []);
  assert.deepEqual(findConfirmedSwingPivots(candles([1, 2, 3]), 0), []);
  assert.deepEqual(findConfirmedSwingPivots(candles([1, 2, 3]), 3), []);
});
