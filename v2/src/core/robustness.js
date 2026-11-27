/**
 * Classify each closed candle using trailing-only returns and volatility.
 * No future candles are consulted for a regime label.
 */
export function classifyMarketRegimes(candles, window = 48, trendThreshold = 0.004) {
  if (!Array.isArray(candles) || !Number.isInteger(window) || window < 2 ||
      !Number.isFinite(trendThreshold) || trendThreshold < 0) return [];
  const volatility = candles.map((c, i) => {
    if (i < window) return null;
    const returns = [];
    for (let j = i - window + 1; j <= i; j++) {
      const prev = candles[j - 1]?.close, close = candles[j]?.close;
      if (!Number.isFinite(prev) || !Number.isFinite(close) || prev <= 0 || close <= 0) return null;
      returns.push(Math.log(close / prev));
    }
    const mean = returns.reduce((a,b)=>a+b,0)/returns.length;
    return Math.sqrt(returns.reduce((s,x)=>s+(x-mean)**2,0)/returns.length);
  });
  const validVol = volatility.filter(Number.isFinite).sort((a,b)=>a-b);
  const median = validVol.length ? validVol[Math.floor(validVol.length/2)] : 0;
  return candles.map((c,i) => {
    if (i < window || !Number.isFinite(volatility[i])) return {time:c.time,regime:'INSUFFICIENT'};
    const change = c.close / candles[i-window].close - 1;
    const trend = change >= trendThreshold ? 'UP' : change <= -trendThreshold ? 'DOWN' : 'RANGE';
    const vol = volatility[i] >= median ? 'HIGH' : 'LOW';
    return {time:c.time,regime:trend+'_'+vol};
  });
}

/** Summarize trade outcomes by the regime known at signal close. */
export function summarizeRegimePerformance(trades, regimes) {
  const byTime = new Map(regimes.map(x=>[x.time,x.regime]));
  const groups = new Map();
  for (const trade of trades || []) {
    const regime = byTime.get(trade.signalTime) || 'UNKNOWN';
    if (!groups.has(regime)) groups.set(regime, []);
    groups.get(regime).push(trade);
  }
  return [...groups.entries()].map(([regime,items]) => {
    const wins=items.filter(t=>t.netPnl>0), losses=items.filter(t=>t.netPnl<0);
    const grossProfit=wins.reduce((s,t)=>s+t.netPnl,0);
    const grossLoss=Math.abs(losses.reduce((s,t)=>s+t.netPnl,0));
    const netPnl=items.reduce((s,t)=>s+t.netPnl,0);
    return {regime,tradeCount:items.length,wins:wins.length,winRatePct:items.length?wins.length/items.length*100:0,netPnl,expectancy:items.length?netPnl/items.length:0,profitFactor:grossLoss?grossProfit/grossLoss:grossProfit?null:0};
  }).sort((a,b)=>a.regime.localeCompare(b.regime));
}
