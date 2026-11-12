const DEFAULT_FEE_RATE = 0.0005;
const DEFAULT_SLIPPAGE_RATE = 0.0002;
const DEFAULT_MIN_NET_RR = 1.5;
const STOP_ATR_MULTIPLE = 1.5;
const TARGET_ATR_MULTIPLE = 3;
const RISK_BUDGET_FRACTION = 0.01;

export function validateSignalRiskPlan({
  side,
  entry,
  atr,
  market = 'Futures',
  accountBalance = null,
  feeRate = DEFAULT_FEE_RATE,
  slippageRate = DEFAULT_SLIPPAGE_RATE,
  minNetRR = DEFAULT_MIN_NET_RR,
} = {}) {
  const fail = (reason, extra = {}) => ({
    ok: false,
    reason,
    entry: Number.isFinite(entry) ? entry : null,
    stop: null,
    target: null,
    quantity: 0,
    riskUsd: 0,
    netRR: null,
    ...extra,
  });

  if (side !== 'LONG' && side !== 'SHORT') return fail('No directional setup');
  if (!Number.isFinite(entry) || entry <= 0) return fail('Entry price is invalid');
  if (!Number.isFinite(atr) || atr <= 0) return fail('ATR is missing or invalid');
  if (market !== 'Spot' && market !== 'Futures') return fail('Market type is invalid');
  if (!Number.isFinite(feeRate) || feeRate < 0 ||
      !Number.isFinite(slippageRate) || slippageRate < 0 ||
      !Number.isFinite(minNetRR) || minNetRR <= 0) {
    return fail('Trading cost or reward/risk assumptions are invalid');
  }
  if (accountBalance !== null && (!Number.isFinite(accountBalance) || accountBalance <= 0)) {
    return fail('Account balance is invalid');
  }

  const stopDistance = atr * STOP_ATR_MULTIPLE;
  const rewardDistance = atr * TARGET_ATR_MULTIPLE;
  const stop = side === 'LONG' ? entry - stopDistance : entry + stopDistance;
  const target = side === 'LONG' ? entry + rewardDistance : entry - rewardDistance;

  if (!Number.isFinite(stop) || !Number.isFinite(target) || stop <= 0 || target <= 0) {
    return fail('Stop or target price is invalid');
  }
  if (side === 'LONG' ? !(stop < entry && target > entry) : !(stop > entry && target < entry)) {
    return fail(side + ' stop/target placement is invalid');
  }

  const roundTripCost = entry * (feeRate * 2 + slippageRate * 2);
  const netReward = rewardDistance - roundTripCost;
  const netRisk = stopDistance + roundTripCost;
  const netRR = netRisk > 0 ? netReward / netRisk : 0;
  if (!Number.isFinite(netRR) || netReward <= 0 || netRR < minNetRR) {
    return fail('Cost-adjusted reward/risk is below ' + minNetRR.toFixed(2) + 'R', {
      stop, target, roundTripCost, netRR,
    });
  }

  let quantity = 0;
  let riskUsd = 0;
  let riskBudget = null;
  let maxNotional = null;
  if (accountBalance !== null) {
    riskBudget = accountBalance * RISK_BUDGET_FRACTION;
    maxNotional = accountBalance * (market === 'Futures' ? 3 : 1);
    // Include estimated round-trip costs in the 1% risk budget, not just the ATR stop distance.
    const riskPerUnit = stopDistance + roundTripCost;
    quantity = Math.min(riskBudget / riskPerUnit, maxNotional / entry);
    riskUsd = quantity * riskPerUnit;
    if (!Number.isFinite(quantity) || quantity <= 0 ||
        !Number.isFinite(riskUsd) || riskUsd <= 0 || riskUsd > riskBudget * 1.000001) {
      return fail('Position sizing failed the 1% risk budget', { stop, target, roundTripCost, netRR });
    }
  }

  return {
    ok: true,
    reason: 'Risk plan valid',
    entry, stop, target, stopDistance, rewardDistance, roundTripCost,
    netRR, quantity, riskUsd, riskBudget, riskBudgetPct: 1, maxNotional,
  };
}
