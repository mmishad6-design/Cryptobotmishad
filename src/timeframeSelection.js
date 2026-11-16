export const TIMEFRAME_PROFILES = Object.freeze({
  '5m': Object.freeze({ contextSlow: '4h', contextFast: '1h', setup: '15m', entry: '5m' }),
  '15m': Object.freeze({ contextSlow: '1d', contextFast: '4h', setup: '1h', entry: '15m' }),
  '1h': Object.freeze({ contextSlow: '1w', contextFast: '1d', setup: '4h', entry: '1h' }),
});

export const TIMEFRAME_INTERVAL_MS = Object.freeze({
  '5m': 300000, '15m': 900000, '1h': 3600000,
  '4h': 14400000, '1d': 86400000, '1w': 604800000,
});

const PRIORITY = Object.freeze({ '5m': 1, '15m': 2, '1h': 3 });
const isSignal = value => value === 'LONG' || value === 'SHORT';

export function buildTimeframeRoleData(data, timeframe) {
  const profile = TIMEFRAME_PROFILES[timeframe];
  if (!profile || !data) return null;
  const mapped = {
    '4h': data[profile.contextSlow],
    '1h': data[profile.contextFast],
    '15m': data[profile.setup],
    '5m': data[profile.entry],
  };
  return Object.values(mapped).every(Boolean) ? mapped : null;
}

export function selectBestTimeframeSignal(evaluations, mode = 'AUTO') {
  const candidates = Object.keys(TIMEFRAME_PROFILES)
    .map(timeframe => ({ timeframe, ...(evaluations?.[timeframe] || {}) }))
    .filter(candidate => candidate.decision);
  const signals = candidates.filter(candidate => isSignal(candidate.decision));

  if (mode !== 'AUTO') {
    const chosen = evaluations?.[mode];
    if (!TIMEFRAME_PROFILES[mode] || !chosen) {
      return { selectedTimeframe: null, decision: 'NO TRADE', score: 0, reasons: ['নির্বাচিত Timeframe-এর বিশ্লেষণ পাওয়া যায়নি।'], selectionStatus: 'UNAVAILABLE' };
    }
    const opposing = signals.filter(candidate => candidate.timeframe !== mode && candidate.decision !== chosen.decision);
    if (isSignal(chosen.decision) && opposing.length) {
      return {
        ...chosen, selectedTimeframe: mode, candidateDecision: chosen.decision,
        decision: 'NO TRADE', selectionStatus: 'CONFLICT',
        reasons: [...(chosen.reasons || []), 'অন্য Timeframe-এ বিপরীত Signal পাওয়া গেছে; দ্বন্দ্ব থাকায় চূড়ান্ত সিদ্ধান্ত NO TRADE।'],
      };
    }
    return { ...chosen, selectedTimeframe: mode, candidateDecision: chosen.decision, selectionStatus: 'MANUAL' };
  }

  const directions = new Set(signals.map(candidate => candidate.decision));
  if (directions.size > 1) {
    return {
      selectedTimeframe: null, decision: 'NO TRADE',
      score: Math.max(...signals.map(candidate => candidate.score || 0)),
      reasons: ['বিভিন্ন Timeframe-এ বিপরীতমুখী যোগ্য Signal পাওয়া গেছে। স্বয়ংক্রিয়ভাবে কোনো একটিকে বেছে না নিয়ে NO TRADE রাখা হয়েছে।'],
      selectionStatus: 'CONFLICT',
      conflictingSignals: signals.map(candidate => ({ timeframe: candidate.timeframe, decision: candidate.decision, score: candidate.score })),
    };
  }

  if (!signals.length) {
    const best = candidates.sort((a, b) => (b.score || 0) - (a.score || 0) || PRIORITY[b.timeframe] - PRIORITY[a.timeframe])[0];
    return {
      selectedTimeframe: null, decision: 'NO TRADE', score: best?.score || 0,
      reasons: ['কোনো Timeframe-এই সব বাধ্যতামূলক Signal ও Risk শর্ত পূরণ হয়নি।'],
      selectionStatus: 'NO_MATCH', bestCandidate: best?.timeframe || null,
    };
  }

  signals.sort((a, b) => (b.score || 0) - (a.score || 0) || PRIORITY[b.timeframe] - PRIORITY[a.timeframe]);
  return { ...signals[0], selectedTimeframe: signals[0].timeframe, candidateDecision: signals[0].decision, selectionStatus: 'AUTO' };
}
