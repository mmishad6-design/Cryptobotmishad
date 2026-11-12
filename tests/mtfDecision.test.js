import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMtfDecision } from '../src/mtfDecision.js';

const makeFrame = (trend='BULLISH') => ({
  trend, close: 100, rsi: trend === 'BEARISH' ? 40 : 60, adx: 25,
  volumeRatio: 1.2, atr: 1, bos: 'NONE', choch: 'NONE', sweep: 'NONE',
  takerRatio: 1.2,
});
const bullishData = () => ({
  '4h': makeFrame(), '1h': makeFrame(), '15m': {...makeFrame(), bos:'BULLISH'},
  '5m': {...makeFrame(), rsi:60},
});
const bearishData = () => ({
  '4h': makeFrame('BEARISH'), '1h': makeFrame('BEARISH'),
  '15m': {...makeFrame('BEARISH'), rsi:40, bos:'BEARISH'},
  '5m': {...makeFrame('BEARISH'), rsi:40, takerRatio:0.8},
});

test('live LONG requires aligned trend, setup, timing, structure, volume, taker and depth', () => {
  const result = evaluateMtfDecision({data:bullishData(),flow:{takerRatio:1.2,depthRatio:1.1},flowMode:'live',entry:100});
  assert.equal(result.decision,'LONG');
  assert.equal(result.score,100);
  assert.equal(result.gates.risk,true);
});

test('live mode blocks missing order-book depth even when taker flow is bullish', () => {
  const result = evaluateMtfDecision({data:bullishData(),flow:{takerRatio:1.2,depthRatio:null},flowMode:'live',entry:100});
  assert.equal(result.decision,'NO TRADE');
  assert.equal(result.gates.flow,false);
});

test('historical mode uses taker proxy but explicitly does not require unavailable depth snapshots', () => {
  const result = evaluateMtfDecision({data:bullishData(),flow:{takerRatio:1.2,depthRatio:null},flowMode:'historical',entry:100});
  assert.equal(result.decision,'LONG');
  assert.equal(result.diagnostics.flowMode,'historical');
  assert.equal(result.diagnostics.depthRatio,null);
  assert.ok(result.reasons.some(x=>x.includes('order-book depth is unavailable')));
});

test('SHORT requires bearish alignment and bearish taker flow', () => {
  const result = evaluateMtfDecision({data:bearishData(),flow:{takerRatio:0.8,depthRatio:0.9},flowMode:'live',entry:100});
  assert.equal(result.decision,'SHORT');
});

test('blocks conflicting higher-timeframe trend', () => {
  const data=bullishData(); data['1h']=makeFrame('BEARISH');
  const result=evaluateMtfDecision({data,flow:{takerRatio:1.2,depthRatio:1.1},entry:100});
  assert.equal(result.decision,'NO TRADE');
  assert.equal(result.gates.trend,false);
});

test('blocks weak volume, ADX, setup, timing and structure independently', () => {
  const cases=[
    d=>{d['5m'].volumeRatio=0.2;},
    d=>{d['4h'].adx=10;},
    d=>{d['15m'].rsi=80;},
    d=>{d['5m'].rsi=45;},
    d=>{d['15m'].bos='NONE';d['15m'].choch='NONE';d['15m'].sweep='NONE';d['5m'].bos='NONE';},
  ];
  for(const mutate of cases){const data=bullishData();mutate(data);const result=evaluateMtfDecision({data,flow:{takerRatio:1.2,depthRatio:1.1},entry:100});assert.equal(result.decision,'NO TRADE');}
});

test('blocks risk plan with invalid entry or ATR', () => {
  const invalidEntry=evaluateMtfDecision({data:bullishData(),flow:{takerRatio:1.2,depthRatio:1.1},entry:0});
  assert.equal(invalidEntry.decision,'NO TRADE');
  const data=bullishData();data['5m'].atr=0;
  const invalidAtr=evaluateMtfDecision({data,flow:{takerRatio:1.2,depthRatio:1.1},entry:100});
  assert.equal(invalidAtr.decision,'NO TRADE');
});

test('historical mode blocks missing or opposing taker proxy', () => {
  const result=evaluateMtfDecision({data:bullishData(),flow:{takerRatio:0.8},flowMode:'historical',entry:100});
  assert.equal(result.decision,'NO TRADE');
  assert.equal(result.gates.flow,false);
});

test('rejects missing timeframe data', () => {
  const result=evaluateMtfDecision({data:{'4h':makeFrame()},flowMode:'historical'});
  assert.equal(result.decision,'NO TRADE');
  assert.equal(result.gates.data,false);
});
