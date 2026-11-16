import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeframeRoleData, selectBestTimeframeSignal } from '../src/timeframeSelection.js';

const candidate = (decision, score) => ({ decision, score, reasons: [] });

test('maps each signal timeframe to its own higher-context, setup and entry frames', () => {
  const data = Object.fromEntries(['1w','1d','4h','1h','15m','5m'].map(tf => [tf, { tf }]));
  assert.deepEqual(buildTimeframeRoleData(data, '15m'), {
    '4h': data['1d'], '1h': data['4h'], '15m': data['1h'], '5m': data['15m'],
  });
  assert.equal(buildTimeframeRoleData(data, '1h')['5m'], data['1h']);
});

test('auto mode chooses the highest-scoring signal when directions agree', () => {
  const result = selectBestTimeframeSignal({
    '5m': candidate('LONG', 82), '15m': candidate('LONG', 91), '1h': candidate('NO TRADE', 60),
  });
  assert.equal(result.selectedTimeframe, '15m');
  assert.equal(result.decision, 'LONG');
});

test('auto mode prefers the slower timeframe only when scores tie', () => {
  const result = selectBestTimeframeSignal({
    '5m': candidate('LONG', 90), '15m': candidate('LONG', 90), '1h': candidate('LONG', 90),
  });
  assert.equal(result.selectedTimeframe, '1h');
});

test('auto mode refuses to choose when eligible timeframes disagree', () => {
  const result = selectBestTimeframeSignal({
    '5m': candidate('LONG', 96), '15m': candidate('SHORT', 80), '1h': candidate('NO TRADE', 55),
  });
  assert.equal(result.decision, 'NO TRADE');
  assert.equal(result.selectionStatus, 'CONFLICT');
  assert.equal(result.selectedTimeframe, null);
});

test('manual mode exposes the selected candidate but blocks an opposing cross-timeframe signal', () => {
  const result = selectBestTimeframeSignal({
    '5m': candidate('LONG', 90), '15m': candidate('SHORT', 82), '1h': candidate('NO TRADE', 50),
  }, '5m');
  assert.equal(result.candidateDecision, 'LONG');
  assert.equal(result.decision, 'NO TRADE');
  assert.equal(result.selectionStatus, 'CONFLICT');
});

test('no valid signal never auto-selects a timeframe', () => {
  const result = selectBestTimeframeSignal({
    '5m': candidate('NO TRADE', 74), '15m': candidate('NO TRADE', 69), '1h': candidate('NO TRADE', 60),
  });
  assert.equal(result.decision, 'NO TRADE');
  assert.equal(result.selectedTimeframe, null);
  assert.equal(result.selectionStatus, 'NO_MATCH');
});
