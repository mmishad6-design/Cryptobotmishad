import { validateSignalRiskPlan } from './riskValidation.js';

const REQUIRED_FRAMES = ['1d', '4h', '1h', '15m', '5m'];
const BENGALI = {
  BULLISH: 'ঊর্ধ্বমুখী',
  BEARISH: 'নিম্নমুখী',
  MIXED: 'মিশ্র',
};

function noTrade(reason, diagnostics = {}) {
  return {
    decision: 'NO TRADE',
    score: 0,
    reasons: [reason],
    riskPlan: null,
    gates: {
      data: false, trend: false, setup: false, timing: false,
      structure: false, volume: false, flow: false, risk: false, market: false,
    },
    diagnostics,
  };
}

/**
 * Five-timeframe, rules-based signal gate.
 * Each frame must contain already validated indicator/flow values.
 * This function never places orders; it only returns a candidate for review.
 */
export function evaluateAdvancedSignal({
  data,
  market = 'Futures',
  entry,
  accountBalance = null,
  leverage = 1,
  flow = {},
  thresholds = {},
} = {}) {
  if (market !== 'Spot' && market !== 'Futures') {
    return noTrade('NO TRADE: Market-এর ধরন নির্ধারিত নয়।');
  }
  if (!data || REQUIRED_FRAMES.some(frame => !data[frame])) {
    return noTrade('NO TRADE: 1D, 4H, 1H, 15M ও 5M—সব timeframe-এর ডেটা প্রয়োজন।');
  }

  const invalidFrame = REQUIRED_FRAMES.find(frame => {
    const x = data[frame];
    return !Number.isFinite(x.close) || x.close <= 0 ||
      !['BULLISH', 'BEARISH', 'MIXED'].includes(x.trend) ||
      !Number.isFinite(x.rsi) || x.rsi < 0 || x.rsi > 100 ||
      !Number.isFinite(x.adx) || x.adx < 0 ||
      !Number.isFinite(x.volumeRatio) || x.volumeRatio < 0 ||
      !Number.isFinite(x.atr) || x.atr <= 0;
  });
  if (invalidFrame) {
    return noTrade('NO TRADE: ' + invalidFrame.toUpperCase() + ' timeframe-এর indicator data অসম্পূর্ণ বা ভুল।', { invalidFrame });
  }

  if (market === 'Futures' && (!Number.isFinite(leverage) || leverage < 1 || leverage > 125)) {
    return noTrade('NO TRADE: Futures leverage 1x থেকে 125x-এর মধ্যে হতে হবে।');
  }
  if (market === 'Spot' && leverage !== 1) {
    return noTrade('NO TRADE: Spot-এর জন্য leverage 1x হতে হবে।');
  }

  const d1 = data['1d'], h4 = data['4h'], h1 = data['1h'];
  const m15 = data['15m'], m5 = data['5m'];
  const rsiLong = Number.isFinite(thresholds.rsiLong) ? thresholds.rsiLong : 52;
  const rsiShort = Number.isFinite(thresholds.rsiShort) ? thresholds.rsiShort : 48;
  const adxMin = Number.isFinite(thresholds.adxMin) ? thresholds.adxMin : 18;
  const volumeMin = Number.isFinite(thresholds.volumeMin) ? thresholds.volumeMin : 0.85;
  const takerMin = Number.isFinite(thresholds.takerMin) ? thresholds.takerMin : 1.05;
  const minScore = Number.isFinite(thresholds.minScore) ? thresholds.minScore : 80;
  const minNetRR = Number.isFinite(thresholds.minNetRR) ? thresholds.minNetRR : 1.5;

  const longBias = d1.trend === 'BULLISH' && h4.trend === 'BULLISH';
  const shortBias = d1.trend === 'BEARISH' && h4.trend === 'BEARISH';
  const candidateSide = longBias ? 'LONG' : shortBias ? 'SHORT' : null;
  const setup = candidateSide === 'LONG'
    ? h1.trend === 'BULLISH' && h1.rsi >= rsiLong && h1.rsi <= 72 && h1.adx >= adxMin
    : candidateSide === 'SHORT'
      ? h1.trend === 'BEARISH' && h1.rsi <= rsiShort && h1.rsi >= 28 && h1.adx >= adxMin
      : false;
  const timing = candidateSide === 'LONG'
    ? m15.trend === 'BULLISH' && m5.trend === 'BULLISH' && m15.rsi >= 50 && m5.rsi >= 50
    : candidateSide === 'SHORT'
      ? m15.trend === 'BEARISH' && m5.trend === 'BEARISH' && m15.rsi <= 50 && m5.rsi <= 50
      : false;
  const structureNames = candidateSide === 'LONG'
    ? ['Bullish BOS', 'Bullish CHoCH', 'BULLISH']
    : ['Bearish BOS', 'Bearish CHoCH', 'BEARISH'];
  const structure = [h1, m15].some(frame =>
    structureNames.includes(frame.structure) ||
    structureNames.includes(frame.bos) ||
    structureNames.includes(frame.choch)
  );
  const volumeOk = h1.volumeRatio >= volumeMin && m15.volumeRatio >= volumeMin;
  const takerRatio = Number.isFinite(flow.takerRatio) ? flow.takerRatio : m5.takerRatio;
  const depthRatio = flow.depthRatio;
  const takerOk = candidateSide === 'LONG'
    ? Number.isFinite(takerRatio) && takerRatio >= takerMin
    : candidateSide === 'SHORT'
      ? Number.isFinite(takerRatio) && takerRatio > 0 && takerRatio <= 1 / takerMin
      : false;
  const depthAvailable = Number.isFinite(depthRatio) && depthRatio > 0;
  const depthOk = !depthAvailable || (candidateSide === 'LONG'
    ? depthRatio >= 1.005
    : candidateSide === 'SHORT' ? depthRatio <= 0.995 : false);
  const flowOk = takerOk && depthOk;
  const adxOk = d1.adx >= adxMin && h4.adx >= adxMin && h1.adx >= adxMin;

  let score = 0;
  const reasons = [];
  if (candidateSide) {
    score += 25;
    reasons.push('1D ও 4H timeframe একই দিকে ' + BENGALI[candidateSide === 'LONG' ? 'BULLISH' : 'BEARISH'] + ' trend নিশ্চিত করছে।');
  } else {
    reasons.push('NO TRADE: 1D ও 4H trend একই দিকে নেই।');
  }
  if (setup) {
    score += 20;
    reasons.push('1H timeframe-এর trend, RSI ও ADX সেটআপকে সমর্থন করছে।');
  } else reasons.push('NO TRADE: 1H timeframe-এ প্রয়োজনীয় setup confirmation নেই।');
  if (timing) {
    score += 15;
    reasons.push('15M ও 5M timeframe entry timing-কে একই দিকে সমর্থন করছে।');
  } else reasons.push('NO TRADE: 15M ও 5M entry timing একমত নয়।');
  if (structure) {
    score += 15;
    reasons.push('1H/15M-এ একই দিকের BOS অথবা CHoCH confirmation পাওয়া গেছে।');
  } else reasons.push('NO TRADE: নিশ্চিত একই দিকের market structure break পাওয়া যায়নি।');
  if (volumeOk) {
    score += 10;
    reasons.push('1H ও 15M volume নিজ নিজ গড়ের তুলনায় যথেষ্ট।');
  } else reasons.push('NO TRADE: 1H/15M volume confirmation দুর্বল।');
  if (flowOk) {
    score += depthAvailable ? 15 : 10;
    reasons.push(depthAvailable
      ? 'Taker flow ও Order Book depth একই দিককে সমর্থন করছে।'
      : 'Taker flow সমর্থন করছে; live Order Book depth না থাকায় score সীমিত রাখা হয়েছে।');
  } else if (!Number.isFinite(takerRatio) || takerRatio <= 0) {\n    reasons.push('NO TRADE: নির্বাচিত exchange feed থেকে নির্ভরযোগ্য Taker Buy/Sell flow পাওয়া যায়নি; তাই flow confirmation ছাড়া signal অনুমোদিত নয়।');\n  } else reasons.push('NO TRADE: Taker flow অথবা Order Book depth বিপরীত/অপর্যাপ্ত।');

  if (!adxOk) reasons.push('NO TRADE: 1D, 4H ও 1H-এর ADX trend-strength শর্ত পূরণ হয়নি।');
  if (market === 'Spot' && candidateSide === 'SHORT') {
    reasons.push('NO TRADE: Spot market-এ Short signal অনুমোদিত নয়।');
  }

  const riskEntry = entry ?? m5.close;
  let riskPlan = null;
  if (candidateSide && !(market === 'Spot' && candidateSide === 'SHORT')) {
    riskPlan = validateSignalRiskPlan({
      side: candidateSide,
      entry: riskEntry,
      atr: m5.atr,
      market,
      accountBalance,
      minNetRR,
    });
    if (riskPlan.ok && accountBalance !== null && market === 'Futures') {
      const leverageNotionalCap = accountBalance * leverage;
      const maxQuantity = leverageNotionalCap / riskPlan.entry;
      if (riskPlan.quantity > maxQuantity) {
        const quantity = maxQuantity;
        const riskUsd = quantity * (riskPlan.stopDistance + riskPlan.roundTripCost);
        riskPlan = {
          ...riskPlan,
          quantity,
          riskUsd,
          maxNotional: leverageNotionalCap,
          leverage,
        };
      } else {
        riskPlan = { ...riskPlan, maxNotional: leverageNotionalCap, leverage };
      }
    }
  }
  const riskOk = Boolean(riskPlan?.ok);
  if (candidateSide && !riskOk) {
    reasons.push('NO TRADE: Risk/Reward যাচাই ব্যর্থ — ' + (riskPlan?.reason || 'বৈধ risk plan পাওয়া যায়নি') + '।');
  }

  const marketAllowsSide = !(market === 'Spot' && candidateSide === 'SHORT');
  const decision = candidateSide && score >= minScore && setup && timing &&
    structure && volumeOk && flowOk && adxOk && riskOk && marketAllowsSide
    ? candidateSide : 'NO TRADE';

  if (decision === 'NO TRADE') {
    if (score < minScore) reasons.push('NO TRADE: Signal score ' + score + '/100; প্রয়োজনীয় score ' + minScore + '।');
  } else {
    reasons.push('সিদ্ধান্ত: ' + (decision === 'LONG' ? 'LONG / BUY' : 'SHORT') +
      '। সব বাধ্যতামূলক gate পূরণ হয়েছে এবং estimated net R:R ' + riskPlan.netRR.toFixed(2) + 'R।');
  }

  return {
    decision,
    score,
    reasons,
    riskPlan,
    gates: {
      data: true, trend: Boolean(candidateSide), setup, timing,
      structure, volume: volumeOk, flow: flowOk, risk: riskOk, market: marketAllowsSide,
    },
    diagnostics: {
      frames: REQUIRED_FRAMES,
      takerRatio: Number.isFinite(takerRatio) ? takerRatio : null,
      depthRatio: depthAvailable ? depthRatio : null,
      flowMode: Number.isFinite(takerRatio) && takerRatio > 0 ? (depthAvailable ? 'taker+depth' : 'taker-only') : 'unavailable',\n      takerFlowAvailable: Number.isFinite(takerRatio) && takerRatio > 0,
      market,
      leverage: market === 'Futures' ? leverage : 1,
      minimumScore: minScore,
      minimumNetRR: minNetRR,
    },
  };
}
