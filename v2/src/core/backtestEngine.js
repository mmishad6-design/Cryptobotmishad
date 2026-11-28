import { applyAdverseSlippage, calculateTradePnl, resolveIntrabarExit } from './tradeExecution.js';

/**
 * Candle-level historical simulation.
 * evaluate() sees history ending at the last fully closed candle only.
 * A signal is filled no earlier than the following candle open.
 * If stop and target are both touched in one candle, stop wins (conservative).
 */
export function runHistoricalBacktest({
  candles,
  evaluate,
  market = 'Futures',
  initialBalance = 1000,
  feeRate = 0.0005,
  slippageRate = 0.0002,
  warmup = 60,
  maxHoldingBars = 240,
} = {}) {
  const fail = reason => ({ ok: false, reason, trades: [], metrics: null });
  if (!Array.isArray(candles) || candles.length < warmup + 3) return fail('ঐতিহাসিক candle অপর্যাপ্ত।');
  if (typeof evaluate !== 'function') return fail('Signal evaluator দেওয়া হয়নি।');
  if (!['Spot', 'Futures'].includes(market)) return fail('Market mode সঠিক নয়।');
  if (![initialBalance, feeRate, slippageRate].every(Number.isFinite) ||
      initialBalance <= 0 || feeRate < 0 || slippageRate < 0 ||
      !Number.isInteger(warmup) || warmup < 2 ||
      !Number.isInteger(maxHoldingBars) || maxHoldingBars < 1) return fail('Backtest configuration সঠিক নয়।');

  const valid = candles.every((c, i) =>
    c && [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite) &&
    c.open > 0 && c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) && c.low > 0 &&
    (i === 0 || c.time > candles[i - 1].time)
  );
  if (!valid) return fail('Candle data invalid অথবা chronological order-এ নেই।');

  const trades = [];
  let equity = initialBalance;
  let peak = equity;
  let maxDrawdownPct = 0;
  let index = warmup;
  while (index < candles.length - 1) {
    // Only pass information available at the decision close. Never pass future rows.
    let signal;
    try { signal = evaluate(candles.slice(0, index + 1), index); }
    catch { return fail('Signal evaluation চলাকালে error হয়েছে।'); }
    if (!signal || !['LONG', 'SHORT'].includes(signal.decision) ||
        (market === 'Spot' && signal.decision === 'SHORT') ||
        !signal.riskPlan?.ok ||
        !Number.isFinite(signal.riskPlan.stopDistance) ||
        !Number.isFinite(signal.riskPlan.rewardDistance) ||
        signal.riskPlan.stopDistance <= 0 || signal.riskPlan.rewardDistance <= 0) {
      index++;
      continue;
    }

    const side = signal.decision;
    const entryBarIndex = index + 1;
    const rawEntry = candles[entryBarIndex].open;
    const entry = applyAdverseSlippage(rawEntry, side, 'ENTRY', slippageRate);
    if (!entry) { index++; continue; }
    const stop = side === 'LONG'
      ? entry - signal.riskPlan.stopDistance
      : entry + signal.riskPlan.stopDistance;
    const target = side === 'LONG'
      ? entry + signal.riskPlan.rewardDistance
      : entry - signal.riskPlan.rewardDistance;
    if (stop <= 0 || target <= 0) { index++; continue; }

    const quantity = Number.isFinite(signal.riskPlan.quantity) && signal.riskPlan.quantity > 0
      ? signal.riskPlan.quantity : 1;
    let exit = null;
    let exitIndex = entryBarIndex;
    const lastIndex = Math.min(candles.length - 1, entryBarIndex + maxHoldingBars - 1);
    for (let j = entryBarIndex; j <= lastIndex; j++) {
      const bar = candles[j];
      const hit = resolveIntrabarExit({ side, open: bar.open, high: bar.high, low: bar.low, stop, target });
      if (hit) {
        exit = { ...hit, index: j };
        exitIndex = j;
        break;
      }
    }
    if (!exit) {
      exitIndex = lastIndex;
      exit = { price: candles[lastIndex].close, reason: 'সময়-সীমা শেষে বন্ধ' };
    }
    const slippedExit = applyAdverseSlippage(exit.price, side, 'EXIT', slippageRate);
    const pnl = calculateTradePnl({ side, entry, exit: slippedExit, quantity, feeRate });
    if (!pnl.ok) return fail('Trade PnL হিসাব করা যায়নি।');
    const netPnl = pnl.netPnl;
    const riskPerUnit = signal.riskPlan.stopDistance + entry * (feeRate * 2 + slippageRate * 2);
    const initialRisk = riskPerUnit * quantity;
    const rMultiple = initialRisk > 0 ? netPnl / initialRisk : 0;
    equity += netPnl;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
    trades.push({
      side, signalTime: candles[index].time, entryTime: candles[entryBarIndex].time,
      exitTime: candles[exitIndex].time, entry, stop, target,
      exit: slippedExit, exitReason: exit.reason, quantity,
      grossPnl: pnl.grossPnl, fees: pnl.entryFee + pnl.exitFee,
      netPnl, rMultiple, equityAfter: equity,
      barsHeld: exitIndex - entryBarIndex + 1,
    });
    index = exitIndex + 1;
  }

  const wins = trades.filter(t => t.netPnl > 0);
  const losses = trades.filter(t => t.netPnl < 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.netPnl, 0));
  const netPnl = trades.reduce((sum, t) => sum + t.netPnl, 0);
  const metrics = {
    tradeCount: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: trades.length - wins.length - losses.length,
    winRatePct: trades.length ? wins.length / trades.length * 100 : 0,
    netPnl,
    returnPct: netPnl / initialBalance * 100,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
    expectancy: trades.length ? netPnl / trades.length : 0,
    averageR: trades.length ? trades.reduce((sum, t) => sum + t.rMultiple, 0) / trades.length : 0,
    maxDrawdownPct,
    finalBalance: equity,
    initialBalance,
    feesPaid: trades.reduce((sum, t) => sum + t.fees, 0),
  };
  return { ok: true, reason: '', trades, metrics };
}
