import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCandleFlow, calculateOrderBookDepth } from '../src/flowMetrics.js';

const candles = (volumes = Array(21).fill(100), buy = 60) =>
  volumes.map((volume, index) => ({ volume, takerBuy: index === 20 ? buy : volume * 0.5 }));

test('uses latest candle against exactly 20 prior volumes', () => {
  const rows = candles([...Array(20).fill(100), 150], 90);
  const result = calculateCandleFlow(rows);
  assert.equal(result.valid, true);
  assert.equal(result.volumeRatio, 1.5);
  assert.equal(result.takerRatio, 1.5);
});
test('rejects insufficient history', () => assert.equal(calculateCandleFlow(candles().slice(0,20)).valid, false));
test('rejects missing taker-buy volume', () => { const x=candles();x[20].takerBuy=null;assert.equal(calculateCandleFlow(x).valid,false); });
test('rejects negative taker-buy volume', () => { const x=candles();x[20].takerBuy=-1;assert.equal(calculateCandleFlow(x).valid,false); });
test('rejects taker-buy volume above total volume', () => { const x=candles();x[20].takerBuy=101;assert.equal(calculateCandleFlow(x).valid,false); });
test('rejects zero-volume baseline candles', () => { const x=candles();x[4].volume=0;assert.equal(calculateCandleFlow(x).valid,false); });
test('does not fabricate a finite ratio for all-buy candles', () => { const x=calculateCandleFlow(candles(Array(21).fill(100),100));assert.equal(x.volumeValid,true);assert.equal(x.takerRatio,null);assert.equal(x.valid,false); });
test('accepts valid depth and computes quote-value ratio', () => {
  const x=calculateOrderBookDepth({bids:[['100','2'],['99','1']],asks:[['101','1'],['102','1']]},{requestedAt:1000,receivedAt:1200});
  assert.equal(x.ok,true);assert.equal(x.bidValue,299);assert.equal(x.askValue,203);assert.equal(x.depthRatio,299/203);
});
test('rejects empty or invalid depth levels', () => {
  assert.equal(calculateOrderBookDepth({bids:[],asks:[['101','1']]},{requestedAt:1,receivedAt:2}).ok,false);
  assert.equal(calculateOrderBookDepth({bids:[['100','0']],asks:[['101','1']]},{requestedAt:1,receivedAt:2}).ok,false);
});
test('rejects slow depth requests', () => assert.equal(calculateOrderBookDepth({bids:[['100','1']],asks:[['101','1']]},{requestedAt:1000,receivedAt:10000,maxRequestMs:8000}).ok,false));
