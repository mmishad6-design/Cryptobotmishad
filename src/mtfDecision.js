import { validateSignalRiskPlan } from './riskValidation.js';

const labels = { BULLISH: 'bullish', BEARISH: 'bearish', MIXED: 'mixed' };

export function evaluateMtfDecision({
  data,
  flow = {},
  flowMode = 'live',
  entry,
  market = 'Futures',
  accountBalance = null,
  feeRate,
  slippageRate,
  thresholds = {},
  frameLabels = {},
} = {}) {
  const roleLabels = {
    contextSlow: '4h', contextFast: '1h', setup: '15m', entry: '5m',
    ...frameLabels,
  };
  const fail = reason => ({
    decision: 'NO TRADE', score: 0, reasons: [reason],
    gates: { data: false, trend: false, setup: false, timing: false, structure: false, volume: false, adx: false, flow: false, risk: false },
    riskPlan: null,
  });
  const frames = ['4h', '1h', '15m', '5m'];
  if (!data || frames.some(frame => !data[frame])) return fail('NO TRADE: প্রয়োজনীয় ' + [roleLabels.contextSlow, roleLabels.contextFast, roleLabels.setup, roleLabels.entry].map(x => x.toUpperCase()).join('/') + ' টাইমফ্রেমের ডেটা পাওয়া যায়নি।');
  const [h4, h1, m15, m5] = frames.map(frame => data[frame]);
  const numeric = [h4,h1,m15,m5].every(x =>
    Number.isFinite(x.close) && x.close > 0 &&
    Number.isFinite(x.rsi) && Number.isFinite(x.adx) &&
    Number.isFinite(x.volumeRatio) && Number.isFinite(x.atr) && x.atr > 0
  );
  if (!numeric) return fail('NO TRADE: এক বা একাধিক টাইমফ্রেমের ইন্ডিকেটর অনুপস্থিত অথবা ভুল।');

  const takerRatio = Number.isFinite(flow.takerRatio) && flow.takerRatio > 0
    ? flow.takerRatio : m5.takerRatio;
  const depthRatio = flow.depthRatio;
  const longBias = h4.trend === 'BULLISH' && h1.trend === 'BULLISH';
  const shortBias = h4.trend === 'BEARISH' && h1.trend === 'BEARISH';
  const rsiLong = Number.isFinite(thresholds.rsiLong) ? thresholds.rsiLong : 50;
  const rsiShort = Number.isFinite(thresholds.rsiShort) ? thresholds.rsiShort : 50;
  const adx15Min = Number.isFinite(thresholds.adx15) ? thresholds.adx15 : 18;
  const adxTrendMin = Number.isFinite(thresholds.adxTrend) ? thresholds.adxTrend : 15;
  const volumeMin = Number.isFinite(thresholds.volume) ? thresholds.volume : 0.75;
  const takerMin = Number.isFinite(thresholds.taker) ? thresholds.taker : 1.03;
  const longSetup = longBias && m15.trend === 'BULLISH' && m15.rsi >= rsiLong && m15.rsi <= 72 && m15.adx >= adx15Min;
  const shortSetup = shortBias && m15.trend === 'BEARISH' && m15.rsi >= 28 && m15.rsi <= rsiShort && m15.adx >= adx15Min;
  const longStructure = ['BULLISH'].includes(m15.bos) || m15.choch === 'BULLISH' || m15.sweep === 'LOW-SIDE' ||
    m5.bos === 'BULLISH' || m5.choch === 'BULLISH' || m5.sweep === 'LOW-SIDE';
  const shortStructure = m15.bos === 'BEARISH' || m15.choch === 'BEARISH' || m15.sweep === 'HIGH-SIDE' ||
    m5.bos === 'BEARISH' || m5.choch === 'BEARISH' || m5.sweep === 'HIGH-SIDE';
  const longTiming = m5.trend === 'BULLISH' && m5.rsi > rsiLong && m5.adx >= adxTrendMin;
  const shortTiming = m5.trend === 'BEARISH' && m5.rsi < rsiShort && m5.adx >= adxTrendMin;
  const volumeOk = m15.volumeRatio >= volumeMin && m5.volumeRatio >= volumeMin;
  const takerLong = Number.isFinite(takerRatio) && takerRatio >= takerMin;
  const takerShort = Number.isFinite(takerRatio) && takerRatio <= 1 / takerMin;
  const depthAvailable = Number.isFinite(depthRatio) && depthRatio > 0;
  const depthLong = depthAvailable && depthRatio >= 1.005;
  const depthShort = depthAvailable && depthRatio <= 0.995;
  // A missing depth snapshot is degraded evidence, not a reason to disable every signal.
  // If depth is available and strongly contradicts taker flow, keep the flow gate closed.
  const flowLong = takerLong && (!depthAvailable || depthLong);
  const flowShort = takerShort && (!depthAvailable || depthShort);
  const flowOk = (longBias && flowLong) || (shortBias && flowShort);
  const adxOk = h4.adx >= adxTrendMin && h1.adx >= adxTrendMin && m15.adx >= adx15Min;
  const structureOk = (longBias && longSetup && longTiming && flowLong && (longStructure || volumeOk)) ||
    (shortBias && shortSetup && shortTiming && flowShort && (shortStructure || volumeOk));
  const candidateSide = longBias ? 'LONG' : shortBias ? 'SHORT' : null;
  const sideSetup = candidateSide === 'LONG' ? longSetup : candidateSide === 'SHORT' ? shortSetup : false;
  const sideTiming = candidateSide === 'LONG' ? longTiming : candidateSide === 'SHORT' ? shortTiming : false;
  const sideStructure = candidateSide === 'LONG' ? longStructure : candidateSide === 'SHORT' ? shortStructure : false;
  const sideFlow = candidateSide === 'LONG' ? flowLong : candidateSide === 'SHORT' ? flowShort : false;

  let score = 0;
  const reasons = [];
  if (longBias || shortBias) {
    score += 25;
    reasons.push(roleLabels.contextSlow.toUpperCase() + ' ও ' + roleLabels.contextFast.toUpperCase() + ' ট্রেন্ড একই দিকে: ' + (longBias ? 'ঊর্ধ্বমুখী' : 'নিম্নমুখী') + '.');
  } else reasons.push('NO TRADE: ' + roleLabels.contextSlow.toUpperCase() + ' ও ' + roleLabels.contextFast.toUpperCase() + '-এর Trend একই দিকে নেই।');
  if (longSetup || shortSetup) {
    score += 20;
    reasons.push(roleLabels.setup.toUpperCase() + ' সেটআপে Trend, RSI ও ADX-এর সমর্থন পাওয়া গেছে.');
  } else reasons.push('NO TRADE: ' + roleLabels.setup.toUpperCase() + ' Setup-এর প্রয়োজনীয় শর্ত পূরণ হয়নি।');
  if (longTiming || shortTiming) {
    score += 15;
    reasons.push(roleLabels.entry.toUpperCase() + ' এন্ট্রির সময় বর্তমান দিককে সমর্থন করছে.');
  } else reasons.push('NO TRADE: ' + roleLabels.entry.toUpperCase() + ' Entry নেওয়ার উপযুক্ত সময় নিশ্চিত হয়নি।');
  if ((longBias && longStructure) || (shortBias && shortStructure)) {
    score += 15;
    reasons.push('Market Structure উচ্চতর টাইমফ্রেমের দিককে সমর্থন করছে।');
  } else reasons.push('একই দিকের BOS, CHoCH অথবা Liquidity Sweep পাওয়া যায়নি; Volume ও Taker Flow-এর বিকল্প সমর্থন যাচাই করা হয়েছে।');
  if (volumeOk) {
    score += 10;
    reasons.push(roleLabels.setup.toUpperCase() + ' ও ' + roleLabels.entry.toUpperCase() + '-এর Volume নিজ নিজ গড়ের অন্তত 0.75 গুণ.');
  } else reasons.push('NO TRADE: Volume-এর সমর্থন যথেষ্ট নয়।');
  if ((longBias && flowLong) || (shortBias && flowShort)) {
    score += depthAvailable ? 15 : 10;
    reasons.push(flowMode === 'historical' || !depthAvailable
      ? 'Taker Volume বর্তমান দিককে সমর্থন করছে; Order Book Depth না থাকায় Flow-এর Score কম রাখা হয়েছে।'
      : 'Taker Flow ও Order Book-এর শীর্ষ ২০ স্তরের Depth বর্তমান দিককে সমর্থন করছে।');
  } else {
    reasons.push(flowMode === 'historical'
      ? 'NO TRADE: ঐতিহাসিক Taker Volume অনুপস্থিত অথবা বিপরীত দিক নির্দেশ করছে।'
      : 'NO TRADE: Taker Flow অথবা Order Book-এর শীর্ষ ২০ স্তরের Depth অনুপস্থিত কিংবা বিপরীতমুখী।');
  }
  if (!adxOk) reasons.push('NO TRADE: ADX-এর শক্তির শর্ত পূরণ হয়নি (' + roleLabels.contextSlow.toUpperCase() + '/' + roleLabels.contextFast.toUpperCase() + ' কমপক্ষে ১৫ এবং ' + roleLabels.setup.toUpperCase() + ' কমপক্ষে ১৮ হতে হবে)।');

  const riskEntry = entry === undefined || entry === null ? m5.close : entry;
  const riskPlan = candidateSide ? validateSignalRiskPlan({
    side: candidateSide, entry: riskEntry, atr: m5.atr, market, accountBalance,
    ...(Number.isFinite(feeRate) ? { feeRate } : {}),
    ...(Number.isFinite(slippageRate) ? { slippageRate } : {}),
  }) : null;
  const marketAllowsSide = !(market === 'Spot' && candidateSide === 'SHORT');
  const riskOk = Boolean(riskPlan?.ok);
  if (!marketAllowsSide) reasons.push('NO TRADE: Spot Market-এ শুধু LONG নেওয়া যায়; SHORT সিগন্যাল বন্ধ।');
  if (candidateSide && !riskOk) reasons.push('NO TRADE: Risk যাচাইয়ে ব্যর্থ — ' + (riskPlan?.reason || 'বৈধ Risk Plan পাওয়া যায়নি') + '.');

  const decision = score >= 75 && volumeOk && adxOk && structureOk && riskOk && marketAllowsSide
    ? candidateSide : 'NO TRADE';
  if (decision === 'NO TRADE') {
    if (score < 75) reasons.push('NO TRADE: একাধিক শর্তের সম্মিলিত Score ' + score + '/১০০, যা প্রয়োজনীয় ৭৫-এর কম।');
    if (!structureOk) reasons.push('NO TRADE: Direction, Setup, Timing, Taker Flow এবং Structure অথবা Volume-এর সমর্থন প্রয়োজন।');
  } else {
    reasons.push('সিদ্ধান্ত: ' + (decision === 'LONG' ? 'LONG' : 'SHORT') + ' — সব বাধ্যতামূলক শর্ত পূরণ হয়েছে; খরচ সমন্বয়ের পর R:R ' + riskPlan.netRR.toFixed(2) + 'R.');
  }
  return {
    decision, score, reasons, riskPlan,
    gates: {
      data: true, trend: longBias || shortBias, setup: sideSetup,
      timing: sideTiming, structure: sideStructure, volume: volumeOk,
      adx: adxOk, flow: sideFlow, risk: riskOk, market: marketAllowsSide,
    },
    diagnostics: { takerRatio, depthRatio: Number.isFinite(depthRatio) ? depthRatio : null, flowMode, frameLabels: roleLabels },
  };
}
