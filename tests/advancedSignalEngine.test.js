import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAdvancedSignal } from '../v2/src/core/advancedSignalEngine.js';

const frame = (trend = 'BULLISH', extra = {}) => ({
  trend, close: 100, rsi: trend === 'BEARISH' ? 40 : 60, adx: 25,
  volumeRatio: 1.2, atr: 1, structure: 'Bullish BOS',
  takerRatio: trend === 'BEARISH' ? 0.8 : 1.2, ...extra,
});
const bullish = () => ({
  '1d': frame(), '4h': frame(), '1h': frame(),
  '15m': frame(), '5m': frame(),
});
const bearish = () => Object.fromEntries(
  ['1d', '4h', '1h', '15m', '5m'].map(key => [key, frame('BEARISH', { structure: 'Bearish BOS' })])
);

test('strong aligned setup emits a Futures LONG with risk plan', () => {
  const result = evaluateAdvancedSignal({ data: bullish(), market: 'Futures', entry: 100, flow: { takerRatio: 1.2, depthRatio: 1.1 }, leverage: 3 });
  assert.equal(result.decision, 'LONG');
  assert.equal(result.score, 100);
  assert.equal(result.gates.risk, true);
  assert.equal(result.riskPlan.ok, true);
});

test('strong bearish setup emits a Futures SHORT', () => {
  const result = evaluateAdvancedSignal({ data: bearish(), market: 'Futures', entry: 100, flow: { takerRatio: 0.8, depthRatio: 0.9 }, leverage: 2 });
  assert.equal(result.decision, 'SHORT');
});

test('Spot only emits BUY/LONG and blocks bearish short setup', () => {
  const result = evaluateAdvancedSignal({ data: bearish(), market: 'Spot', entry: 100, flow: { takerRatio: 0.8, depthRatio: 0.9 } });
  assert.equal(result.decision, 'NO TRADE');
  assert.equal(result.gates.market, false);
});

test('missing any required timeframe fails closed', () => {
  const data = bullish();
  delete data['1d'];
  const result = evaluateAdvancedSignal({ data });
  assert.equal(result.decision, 'NO TRADE');
  assert.equal(result.gates.data, false);
});

test('conflicting higher timeframe trend blocks a signal', () => {
  const data = bullish();
  data['4h'] = frame('BEARISH');
  const result = evaluateAdvancedSignal({ data, flow: { takerRatio: 1.2, depthRatio: 1.1 } });
  assert.equal(result.decision, 'NO TRADE');
  assert.equal(result.gates.trend, false);
});

test('weak volume, structure, flow and ADX each block the setup', () => {
  const mutations = [
    d => { d['15m'].volumeRatio = 0.2; },
    d => { d['1h'].structure = 'NONE'; d['15m'].structure = 'NONE'; },
    d => { d['5m'].takerRatio = 1; },
    d => { d['1d'].adx = 10; },
  ];
  for (const mutate of mutations) {
    const data = bullish();
    mutate(data);
    const result = evaluateAdvancedSignal({ data, flow: { takerRatio: 1.2, depthRatio: 1.1 } });
    assert.equal(result.decision, 'NO TRADE');
  }
});

test('rejects invalid leverage and never applies leverage to Spot', () => {
  assert.equal(evaluateAdvancedSignal({ data: bullish(), market: 'Futures', leverage: 0 }).decision, 'NO TRADE');
  assert.equal(evaluateAdvancedSignal({ data: bullish(), market: 'Spot', leverage: 2 }).decision, 'NO TRADE');
});

test('Futures position sizing respects leverage notional cap', () => {
  const result = evaluateAdvancedSignal({
    data: bullish(), market: 'Futures', entry: 100, accountBalance: 1000,
    leverage: 2, flow: { takerRatio: 1.2, depthRatio: 1.1 },
  });
  assert.equal(result.decision, 'LONG');
  assert.ok(result.riskPlan.quantity * result.riskPlan.entry <= 2000.000001);
});

test('signal reasons are Bengali and low score remains NO TRADE', () => {
  const data = bullish();
  data['1h'].volumeRatio = 0.1;
  const result = evaluateAdvancedSignal({ data, flow: { takerRatio: 1.2, depthRatio: 1.1 } });
  assert.equal(result.decision, 'NO TRADE');
  assert.ok(result.reasons.some(reason => reason.includes('NO TRADE')));
  assert.ok(result.reasons.every(reason => !/[A-Za-z]{4,}/.test(reason.replaceAll('NO TRADE', '').replaceAll('RSI', '').replaceAll('ADX', '').replaceAll('BOS', '').replaceAll('CHoCH', '').replaceAll('Order Book', '').replaceAll('Taker', '').replaceAll('Spot', '').replaceAll('Futures', '').replaceAll('Risk', '').replaceAll('Reward', '').replaceAll('Score', '').replaceAll('LONG', '').replaceAll('SHORT', '').replaceAll('BUY', '').replaceAll('R:R', '').replaceAll('1D', '').replaceAll('4H', '').replaceAll('1H', '').replaceAll('15M', '').replaceAll('5M', '')));
});
