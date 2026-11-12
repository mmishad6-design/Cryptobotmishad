import test from 'node:test';
import assert from 'node:assert/strict';
import { selectClosedCandlesAsOf } from '../src/historicalData.js';

const candles = [
  { time: 0, closeTime: 99, close: 10 },
  { time: 100, closeTime: 199, close: 11 },
  { time: 200, closeTime: 299, close: 12 },
  { time: 300, closeTime: 399, close: 13 },
];

test('as-of selection excludes candles that had not closed at decision time', () => {
  assert.deepEqual(selectClosedCandlesAsOf(candles, 298), candles.slice(0, 2));
  assert.deepEqual(selectClosedCandlesAsOf(candles, 299), candles.slice(0, 3));
});

test('as-of selection returns only the most recent requested number of closed candles', () => {
  assert.deepEqual(selectClosedCandlesAsOf(candles, 399, 2), candles.slice(2));
});

test('as-of selection safely handles invalid input and empty history', () => {
  assert.deepEqual(selectClosedCandlesAsOf(null, 100), []);
  assert.deepEqual(selectClosedCandlesAsOf(candles, Number.NaN), []);
  assert.deepEqual(selectClosedCandlesAsOf(candles, 399, 0), []);
});
