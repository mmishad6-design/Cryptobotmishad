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
} = {}) {
  const fail = reason => ({
    decision: 'NO TRADE', score: 0, reasons: [reason],
    gates: { data: false, trend: false, setup: false, timing: false, structure: false, volume: false, adx: false, flow: false, risk: false },
    riskPlan: null,
  });
  const frames = ['4h', '1h', '15m', '5m'];
  if (!data || frames.some(frame => !data[frame])) return fail('NO TRADE: required 4H/1H/15M/5M timeframe data is missing.');
  const [h4, h1, m15, m5] = frames.map(frame => data[frame]);
  const numeric = [h4,h1,m15,m5].every(x =>
    Number.isFinite(x.close) && x.close > 0 &&
    Number.isFinite(x.rsi) && Number.isFinite(x.adx) &&
    Number.isFinite(x.volumeRatio) && Number.isFinite(x.atr) && x.atr > 0
  );
  if (!numeric) return fail('NO TRADE: one or more timeframe indicators are missing or invalid.');

  const takerRatio = Number.isFinite(flow.takerRatio) && flow.takerRatio > 0
    ? flow.takerRatio : m5.takerRatio;
  const depthRatio = flow.depthRatio;
  const longBias = h4.trend === 'BULLISH' && h1.trend === 'BULLISH';
  const shortBias = h4.trend === 'BEARISH' && h1.trend === 'BEARISH';
  const rsiLong = Number.isFinite(thresholds.rsiLong) ? thresholds.rsiLong : 50;
  const rsiShort = Number.isFinite(thresholds.rsiShort) ? thresholds.rsiShort : 50;
  const adx15Min = Number.isFinite(thresholds.adx15) ? thresholds.adx15 : 18;
  const adxTrendMin = Number.isFinite(thresholds.adxTrend) ? thresholds.adxTrend : 15;
  const volumeMin = Number.isFinite(thresholds.volume) ? thresholds.volume : 0.8;
  const takerMin = Number.isFinite(thresholds.taker) ? thresholds.taker : 1.05;
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
  const depthLong = Number.isFinite(depthRatio) && depthRatio >= 1.02;
  const depthShort = Number.isFinite(depthRatio) && depthRatio <= 0.98;
  const flowLong = takerLong && (flowMode === 'historical' || depthLong);
  const flowShort = takerShort && (flowMode === 'historical' || depthShort);
  const flowOk = (longBias && flowLong) || (shortBias && flowShort);
  const adxOk = h4.adx >= adxTrendMin && h1.adx >= adxTrendMin && m15.adx >= adx15Min;
  const structureOk = (longBias && longSetup && longTiming && longStructure && flowLong) ||
    (shortBias && shortSetup && shortTiming && shortStructure && flowShort);
  const candidateSide = longBias ? 'LONG' : shortBias ? 'SHORT' : null;
  const sideSetup = candidateSide === 'LONG' ? longSetup : candidateSide === 'SHORT' ? shortSetup : false;
  const sideTiming = candidateSide === 'LONG' ? longTiming : candidateSide === 'SHORT' ? shortTiming : false;
  const sideStructure = candidateSide === 'LONG' ? longStructure : candidateSide === 'SHORT' ? shortStructure : false;
  const sideFlow = candidateSide === 'LONG' ? flowLong : candidateSide === 'SHORT' ? flowShort : false;

  let score = 0;
  const reasons = [];
  if (longBias || shortBias) {
    score += 25;
    reasons.push('4H and 1H trend alignment: ' + (longBias ? 'bullish' : 'bearish') + '.');
  } else reasons.push('NO TRADE: 4H and 1H trends do not align.');
  if (longSetup || shortSetup) {
    score += 20;
    reasons.push('15M setup confirmed by trend, RSI and ADX.');
  } else reasons.push('NO TRADE: 15M setup conditions are not satisfied.');
  if (longTiming || shortTiming) {
    score += 15;
    reasons.push('5M entry timing supports the direction.');
  } else reasons.push('NO TRADE: 5M entry timing is not confirmed.');
  if ((longBias && longStructure) || (shortBias && shortStructure)) {
    score += 15;
    reasons.push('Market structure supports the higher-timeframe direction.');
  } else reasons.push('NO TRADE: no aligned BOS, CHoCH or liquidity sweep.');
  if (volumeOk) {
    score += 10;
    reasons.push('15M and 5M volume are at least 0.8x their averages.');
  } else reasons.push('NO TRADE: volume confirmation is weak.');
  if ((longBias && flowLong) || (shortBias && flowShort)) {
    score += 15;
    reasons.push(flowMode === 'historical'
      ? 'Historical taker-volume proxy confirms direction; order-book depth is unavailable in historical data.'
      : 'Taker flow and top-20 order-book depth confirm direction.');
  } else {
    reasons.push(flowMode === 'historical'
      ? 'NO TRADE: historical taker-volume proxy is missing or opposing.'
      : 'NO TRADE: taker flow or top-20 order-book depth is missing or opposing.');
  }
  if (!adxOk) reasons.push('NO TRADE: ADX strength gate failed (4H/1H >= 15 and 15M >= 18).');

  const riskEntry = entry === undefined || entry === null ? m5.close : entry;
  const riskPlan = candidateSide ? validateSignalRiskPlan({
    side: candidateSide, entry: riskEntry, atr: m5.atr, market, accountBalance,
    ...(Number.isFinite(feeRate) ? { feeRate } : {}),
    ...(Number.isFinite(slippageRate) ? { slippageRate } : {}),
  }) : null;
  const riskOk = Boolean(riskPlan?.ok);
  if (candidateSide && !riskOk) reasons.push('NO TRADE: risk validation failed — ' + (riskPlan?.reason || 'no valid risk plan') + '.');

  const decision = score >= 85 && volumeOk && adxOk && structureOk && riskOk
    ? candidateSide : 'NO TRADE';
  if (decision === 'NO TRADE') {
    if (score < 85) reasons.push('NO TRADE: confluence score ' + score + '/100 is below 85.');
    if (!structureOk) reasons.push('NO TRADE: all directional, setup, timing, structure and flow gates must pass together.');
  } else {
    reasons.push('Decision: ' + decision + ' — mandatory gates passed; cost-adjusted R:R ' + riskPlan.netRR.toFixed(2) + 'R.');
  }
  return {
    decision, score, reasons, riskPlan,
    gates: {
      data: true, trend: longBias || shortBias, setup: sideSetup,
      timing: sideTiming, structure: sideStructure, volume: volumeOk,
      adx: adxOk, flow: sideFlow, risk: riskOk,
    },
    diagnostics: { takerRatio, depthRatio: Number.isFinite(depthRatio) ? depthRatio : null, flowMode },
  };
}
