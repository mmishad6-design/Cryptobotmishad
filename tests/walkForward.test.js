import test from 'node:test';
import assert from 'node:assert/strict';
import { createSequentialOosFolds } from '../src/walkForward.js';

const rows = Array.from({ length: 20 }, (_, i) => ({ time: i * 300000, close: 100 + i }));

test('creates chronological, non-overlapping OOS folds with prior-only warm-up', () => {
  const folds = createSequentialOosFolds(rows, 8, 3, 2);
  assert.equal(folds.length, 3);
  assert.deepEqual(folds.map(f => [f.testFrom, f.testTo]), [[8, 12], [12, 16], [16, 20]]);
  assert.deepEqual(folds.map(f => f.data.map(x => x.time)), [
    rows.slice(6, 12).map(x => x.time),
    rows.slice(10, 16).map(x => x.time),
    rows.slice(14, 20).map(x => x.time),
  ]);
  assert.equal(folds[0].data[folds[0].warmupCount].time, rows[8].time);
  assert.equal(folds[1].data[folds[1].warmupCount].time, rows[12].time);
  assert.equal(folds[2].data[folds[2].warmupCount].time, rows[16].time);
});

test('fold test ranges cover the unseen segment exactly once without overlap', () => {
  const folds = createSequentialOosFolds(rows, 8, 3, 2);
  const tested = folds.flatMap(f => rows.slice(f.testFrom, f.testTo));
  assert.deepEqual(tested, rows.slice(8));
});

test('rejects invalid or too-short fold requests', () => {
  assert.deepEqual(createSequentialOosFolds(rows, 8, 0, 2), []);
  assert.deepEqual(createSequentialOosFolds(rows, 8, 3, 0), []);
  assert.deepEqual(createSequentialOosFolds(rows, 19, 3, 2), []);
  assert.deepEqual(createSequentialOosFolds(rows, -1, 3, 2), []);
});
