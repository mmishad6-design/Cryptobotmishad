import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSignalRiskPlan } from '../src/riskValidation.js';

const base = { side: 'LONG', entry: 100, atr: 1, market: 'Futures' };

test('accepts a valid LONG plan and places stop/target on correct sides', () => {
  const plan = validateSignalRiskPlan(base);
  assert.equal(plan.ok, true);
  assert.equal(plan.stop, 98.5);
  assert.equal(plan.target, 103);
  assert.ok(plan.netRR >= 1.5);
});

test('accepts a valid SHORT plan and places stop/target on correct sides', () => {
  const plan = validateSignalRiskPlan({ ...base, side: 'SHORT' });
  assert.equal(plan.ok, true);
  assert.equal(plan.stop, 101.5);
  assert.equal(plan.target, 97);
});

test('blocks missing or unsupported direction', () => {
  assert.equal(validateSignalRiskPlan({ ...base, side: 'WAIT' }).ok, false);
  assert.equal(validateSignalRiskPlan({ ...base, side: null }).ok, false);
});

test('blocks invalid entry and ATR values', () => {
  for (const entry of [0, -1, NaN, Infinity, '100']) {
    assert.equal(validateSignalRiskPlan({ ...base, entry }).ok, false);
  }
  for (const atr of [0, -1, NaN, Infinity, null]) {
    assert.equal(validateSignalRiskPlan({ ...base, atr }).ok, false);
  }
});

test('blocks stop or target at non-positive prices', () => {
  assert.equal(validateSignalRiskPlan({ ...base, entry: 1, atr: 1 }).ok, false);
  assert.equal(validateSignalRiskPlan({ ...base, side: 'SHORT', entry: 1, atr: 1 }).ok, false);
});

test('blocks invalid market, fee, slippage, and minimum R:R assumptions', () => {
  assert.equal(validateSignalRiskPlan({ ...base, market: 'Margin' }).ok, false);
  assert.equal(validateSignalRiskPlan({ ...base, feeRate: -0.1 }).ok, false);
  assert.equal(validateSignalRiskPlan({ ...base, slippageRate: Infinity }).ok, false);
  assert.equal(validateSignalRiskPlan({ ...base, minNetRR: 0 }).ok, false);
  assert.equal(validateSignalRiskPlan({ ...base, minNetRR: NaN }).ok, false);
});

test('rejects a cost structure that destroys the reward or minimum net R:R', () => {
  assert.equal(validateSignalRiskPlan({ ...base, feeRate: 0.01, slippageRate: 0.01 }).ok, false);
  assert.equal(validateSignalRiskPlan({ ...base, minNetRR: 2.5 }).ok, false);
});

test('blocks invalid supplied account balances instead of silently skipping sizing', () => {
  for (const accountBalance of [0, -100, NaN, Infinity, '10000']) {
    assert.equal(validateSignalRiskPlan({ ...base, accountBalance }).ok, false);
  }
});

test('sizes within the 1% risk budget including estimated round-trip costs', () => {
  const balance = 10000;
  const plan = validateSignalRiskPlan({ ...base, accountBalance: balance });
  assert.equal(plan.ok, true);
  assert.ok(plan.riskUsd <= balance * 0.01);
  assert.ok(plan.quantity * (plan.stopDistance + plan.roundTripCost) <= balance * 0.01);
  assert.ok(plan.quantity * base.entry <= balance * 3);
});

test('spot notional cap is one times balance', () => {
  const plan = validateSignalRiskPlan({ ...base, market: 'Spot', accountBalance: 10000 });
  assert.equal(plan.ok, true);
  assert.ok(plan.quantity * base.entry <= 10000);
});

test('keeps sizing optional when account balance is omitted', () => {
  const plan = validateSignalRiskPlan(base);
  assert.equal(plan.ok, true);
  assert.equal(plan.quantity, 0);
  assert.equal(plan.riskUsd, 0);
});
