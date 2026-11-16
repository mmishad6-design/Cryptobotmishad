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

  if (side !== 'LONG' && side !== 'SHORT') return fail('নির্দিষ্ট LONG বা SHORT Setup পাওয়া যায়নি');
  if (!Number.isFinite(entry) || entry <= 0) return fail('Entry Price-এর মান সঠিক নয়');
  if (!Number.isFinite(atr) || atr <= 0) return fail('ATR অনুপস্থিত অথবা এর মান সঠিক নয়');
  if (market !== 'Spot' && market !== 'Futures') return fail('Market-এর ধরন সঠিক নয়');
  if (!Number.isFinite(feeRate) || feeRate < 0 ||
      !Number.isFinite(slippageRate) || slippageRate < 0 ||
      !Number.isFinite(minNetRR) || minNetRR <= 0) {
    return fail('Trading Cost অথবা Reward/Risk-এর অনুমান সঠিক নয়');
  }
  if (accountBalance !== null && (!Number.isFinite(accountBalance) || accountBalance <= 0)) {
    return fail('Account Balance-এর মান সঠিক নয়');
  }

  const stopDistance = atr * STOP_ATR_MULTIPLE;
  const rewardDistance = atr * TARGET_ATR_MULTIPLE;
  const stop = side === 'LONG' ? entry - stopDistance : entry + stopDistance;
  const target = side === 'LONG' ? entry + rewardDistance : entry - rewardDistance;

  if (!Number.isFinite(stop) || !Number.isFinite(target) || stop <= 0 || target <= 0) {
    return fail('Stop অথবা Target Price-এর মান সঠিক নয়');
  }
  if (side === 'LONG' ? !(stop < entry && target > entry) : !(stop > entry && target < entry)) {
    return fail(side + ' দিকের Stop/Target সঠিকভাবে নির্ধারিত হয়নি');
  }

  const roundTripCost = entry * (feeRate * 2 + slippageRate * 2);
  const netReward = rewardDistance - roundTripCost;
  const netRisk = stopDistance + roundTripCost;
  const netRR = netRisk > 0 ? netReward / netRisk : 0;
  if (!Number.isFinite(netRR) || netReward <= 0 || netRR < minNetRR) {
    return fail('খরচ সমন্বয়ের পর Reward/Risk প্রয়োজনীয় ' + minNetRR.toFixed(2) + 'R-এর নিচে', {
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
      return fail('Position Size নির্ধারণে ১% Risk Budget অতিক্রম হচ্ছে', { stop, target, roundTripCost, netRR });
    }
  }

  return {
    ok: true,
    reason: 'Risk Plan সঠিক',
    entry, stop, target, stopDistance, rewardDistance, roundTripCost,
    netRR, quantity, riskUsd, riskBudget, riskBudgetPct: 1, maxNotional,
  };
}
