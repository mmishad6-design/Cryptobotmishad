import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStructureEvent } from '../src/structureEvents.js';

const rows = (previousClose, close, high = Math.max(previousClose, close), low = Math.min(previousClose, close)) => [
  ...Array.from({ length: 6 }, (_, i) => ({ open: 95, high: 97 + i, low: 90 - i, close: 95 })),
  { open: previousClose, high: previousClose + 1, low: previousClose - 1, close: previousClose },
  { open: previousClose, high, low, close },
];
const bullishPivots = [
  { type: 'H', index: 1, confirmationIndex: 2, price: 100 },
  { type: 'L', index: 2, confirmationIndex: 3, price: 80 },
  { type: 'H', index: 3, confirmationIndex: 4, price: 110 },
  { type: 'L', index: 4, confirmationIndex: 5, price: 90 },
];
const bearishPivots = [
  { type: 'H', index: 1, confirmationIndex: 2, price: 110 },
  { type: 'L', index: 2, confirmationIndex: 3, price: 90 },
  { type: 'H', index: 3, confirmationIndex: 4, price: 100 },
  { type: 'L', index: 4, confirmationIndex: 5, price: 80 },
];

test('BOS fires only on the candle that closes across the confirmed swing', () => {
  const event = evaluateStructureEvent(rows(109, 111), bullishPivots);
  assert.equal(event.structure, 'BULLISH');
  assert.equal(event.bos, 'BULLISH');
  assert.equal(event.choch, 'NONE');
  assert.equal(evaluateStructureEvent(rows(111, 112), bullishPivots).bos, 'NONE');
});

test('break against bearish structure is classified as bullish CHoCH once', () => {
  const event = evaluateStructureEvent(rows(99, 101), bearishPivots);
  assert.equal(event.structure, 'BEARISH');
  assert.equal(event.bos, 'BULLISH');
  assert.equal(event.choch, 'BULLISH');
  assert.equal(evaluateStructureEvent(rows(101, 102), bearishPivots).choch, 'NONE');
});

test('break against bullish structure is classified as bearish CHoCH', () => {
  const event = evaluateStructureEvent(rows(91, 89), bullishPivots);
  assert.equal(event.bos, 'BEARISH');
  assert.equal(event.choch, 'BEARISH');
});

test('wick-only sweep is not mislabeled as a close-confirmed BOS', () => {
  const event = evaluateStructureEvent(rows(99, 99, 102, 98), bearishPivots);
  assert.equal(event.bos, 'NONE');
  assert.equal(event.sweep, 'HIGH-SIDE');
});

test('a break must cross from the other side; already-beyond closes do not repeat', () => {
  const event = evaluateStructureEvent(rows(111, 113), bullishPivots);
  assert.equal(event.bos, 'NONE');
});

test('incomplete or malformed candles safely produce no structure event', () => {
  assert.deepEqual(evaluateStructureEvent([]), { structure: 'NEUTRAL', bos: 'NONE', choch: 'NONE', sweep: 'NONE' });
  assert.equal(evaluateStructureEvent([{ close: 1 }, { close: 2 }], []).bos, 'NONE');
});
