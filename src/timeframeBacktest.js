import { buildTimeframeRoleData, TIMEFRAME_INTERVAL_MS, TIMEFRAME_PROFILES } from './timeframeSelection.js';
import { selectClosedCandlesAsOf } from './historicalData.js';
import { evaluateMtfDecision } from './mtfDecision.js';
import { selectBestTimeframeSignal } from './timeframeSelection.js';
import { validateSignalRiskPlan } from './riskValidation.js';
import { applyAdverseSlippage, calculateTradePnl, resolveIntrabarExit } from './tradeExecution.js';

const REQUIRED_FRAMES = ['5m', '15m', '1h', '4h', '1d', '1w'];

function validRows(rows, frame) {
  const interval = TIMEFRAME_INTERVAL_MS[frame];
  if (!Array.isArray(rows) || rows.length < 2 || !interval) return false;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (![row?.time, row?.closeTime, row?.open, row?.high, row?.low, row?.close, row?.volume, row?.takerBuy].every(Number.isFinite)) return false;
    if (row.time <= 0 || row.closeTime < row.time || row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close) || row.high < row.low) return false;
    if (i > 0 && (row.time <= rows[i - 1].time || row.time - rows[i - 1].time !== interval)) return false;
  }
  return true;
}

/**
 * Historical replay for one concrete AUTO candidate profile.
 * The decision is evaluated at the completed entry candle close; the next
 * candle open is used only for the simulated fill. Higher frames are selected
 * strictly as-of that close, so future candles cannot leak into the decision.
 */
export function simulateTimeframeProfile({
  dataByFrame,
  timeframe,
  market = 'Futures',
  feeRate = 0.0005,
  slippageRate = 0.0002,
  accountBalance = 10000,
  evaluateFrame,
  startTime = -Infinity,
  endTime = Infinity,
} = {}) {
  const profile = TIMEFRAME_PROFILES[timeframe];
  const interval = TIMEFRAME_INTERVAL_MS[timeframe];
  if (!profile || !interval || typeof evaluateFrame !== 'function' ||
      !Number.isFinite(feeRate) || feeRate < 0 ||
      !Number.isFinite(slippageRate) || slippageRate < 0 ||
      !Number.isFinite(accountBalance) || accountBalance <= 0 ||
      !(Number.isFinite(startTime) || startTime === -Infinity) ||
      !(Number.isFinite(endTime) || endTime === Infinity) || endTime <= startTime) {
    return { ok: false, reason: 'Backtest configuration is invalid.' };
  }
  for (const frame of REQUIRED_FRAMES) {
    if (!validRows(dataByFrame?.[frame], frame)) {
      return { ok: false, reason: frame + ' historical candles are missing, malformed, duplicated, or contain a gap.' };
    }
  }

  const data = dataByFrame[timeframe];
  const frames = REQUIRED_FRAMES;
  let equity = accountBalance, peak = accountBalance, maxDrawdown = 0;
  let position = null, signals = 0;
  const trades = [];

  const closePosition = (rawExit, reason, time) => {
    const current = position;
    if (!current) return;
    const exit = applyAdverseSlippage(rawExit, current.side, 'EXIT', slippageRate);
    const accounting = calculateTradePnl({
      side: current.side, entry: current.entry, exit, quantity: current.quantity,
      feeRate, entryFee: current.entryFee,
    });
    if (!accounting.ok) return;
    equity += accounting.netPnl;
    trades.push({
      side: current.side, entry: current.entry, exit, quantity: current.quantity,
      pnl: accounting.netPnl, reason, entryTime: current.entryTime, exitTime: time,
    });
    position = null;
  };

  for (let i = 60; i < data.length - 1; i++) {
    const candle = data[i];
    if (candle.time < startTime) continue;
    if (candle.closeTime >= endTime) break;
    const decisionTime = candle.closeTime;
    const snapshots = Object.fromEntries(frames.map(frame => [
      frame, selectClosedCandlesAsOf(dataByFrame[frame], decisionTime, 120),
    ]));
    const roleData = buildTimeframeRoleData(snapshots, timeframe);
    if (!roleData) continue;

    const roles = Object.fromEntries(
      Object.entries(roleData).map(([frame, rows]) => [frame, evaluateFrame(rows, frame, decisionTime)])
    );
    if (['4h', '1h', '15m', '5m'].some(frame => !roles[frame])) continue;
    if (position) {
      const exit = resolveIntrabarExit({
        side: position.side, open: candle.open, high: candle.high, low: candle.low,
        stop: position.stop, target: position.target,
      });
      if (exit) closePosition(exit.price, exit.reason, candle.time);
    }
    const labels = {
      contextSlow: profile.contextSlow,
      contextFast: profile.contextFast,
      setup: profile.setup,
      entry: profile.entry,
    };
    const entryFrame = roles['5m'];
    const decision = evaluateMtfDecision({
      data: roles,
      flow: { takerRatio: entryFrame.takerRatio },
      flowMode: 'historical',
      entry: entryFrame.close,
      market,
      accountBalance: equity,
      feeRate,
      slippageRate,
      frameLabels: labels,
    });

    if (decision.decision !== 'NO TRADE') {
      signals++;
      if (!position && (market === 'Futures' || decision.decision === 'LONG')) {
        const nextOpen = data[i + 1].open;
        const entry = applyAdverseSlippage(nextOpen, decision.decision, 'ENTRY', slippageRate);
        const riskPlan = validateSignalRiskPlan({
          side: decision.decision, entry, atr: entryFrame.atr, market,
          accountBalance: equity, feeRate, slippageRate,
        });
        if (riskPlan.ok) {
          const quantity = riskPlan.quantity;
          const margin = entry * quantity / (market === 'Futures' ? 3 : 1);
          const entryFee = entry * quantity * feeRate;
          if (Number.isFinite(quantity) && quantity > 0 && margin + entryFee <= equity) {
            position = {
              side: decision.decision, entry, quantity, stop: riskPlan.stop,
              target: riskPlan.target, entryFee, entryTime: data[i + 1].time,
            };
          }
        }
      }
    }

    const active = position && position.entryTime <= candle.time;
    const estimatedExitCost = active ? candle.close * position.quantity * (feeRate + slippageRate) : 0;
    const marked = equity + (active
      ? ((candle.close - position.entry) * position.quantity * (position.side === 'LONG' ? 1 : -1) - position.entryFee - estimatedExitCost)
      : 0);
    peak = Math.max(peak, marked);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - marked) / peak * 100 : 0);
  }

  const finalCandle = [...data].reverse().find(candle => candle.time >= startTime && candle.closeTime < endTime);
  if (position && finalCandle) closePosition(finalCandle.close, 'END OF TEST', finalCandle.time);
  const wins = trades.filter(trade => trade.pnl > 0);
  const losses = trades.filter(trade => trade.pnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
  return {
    ok: true, timeframe, market, initialBalance: accountBalance, equity,
    net: equity - accountBalance, returnPct: (equity - accountBalance) / accountBalance * 100,
    tradeCount: trades.length, wins: wins.length, losses: losses.length,
    winRate: trades.length ? wins.length / trades.length * 100 : 0,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
    expectancy: trades.length ? (equity - accountBalance) / trades.length : 0,
    maxDrawdown, signals, trades,
  };
}


/**
 * Replay the actual AUTO selector on a common 5m event clock.
 * A 15m or 1h candidate is eligible only when its own entry candle has just
 * closed at the same event timestamp, preventing stale candidates from being
 * selected repeatedly between their entry-candle closes.
 */
export function simulateAutoTimeframeSelection({
  dataByFrame,
  market = 'Futures',
  feeRate = 0.0005,
  slippageRate = 0.0002,
  accountBalance = 10000,
  evaluateFrame,
  startTime = -Infinity,
  endTime = Infinity,
} = {}) {
  if (typeof evaluateFrame !== 'function' ||
      !Number.isFinite(feeRate) || feeRate < 0 ||
      !Number.isFinite(slippageRate) || slippageRate < 0 ||
      !Number.isFinite(accountBalance) || accountBalance <= 0 ||
      !(Number.isFinite(startTime) || startTime === -Infinity) ||
      !(Number.isFinite(endTime) || endTime === Infinity) || endTime <= startTime) {
    return { ok: false, reason: 'AUTO backtest configuration is invalid.' };
  }
  for (const frame of REQUIRED_FRAMES) {
    if (!validRows(dataByFrame?.[frame], frame)) {
      return { ok: false, reason: frame + ' historical candles are missing, malformed, duplicated, or contain a gap.' };
    }
  }

  const baseRows = dataByFrame['5m'];
  let equity = accountBalance, peak = accountBalance, maxDrawdown = 0;
  let position = null, signals = 0, conflicts = 0;
  const trades = [];
  const selectedCounts = { '5m': 0, '15m': 0, '1h': 0 };

  const closePosition = (rawExit, reason, time) => {
    const current = position;
    if (!current) return;
    const exit = applyAdverseSlippage(rawExit, current.side, 'EXIT', slippageRate);
    const accounting = calculateTradePnl({
      side: current.side, entry: current.entry, exit, quantity: current.quantity,
      feeRate, entryFee: current.entryFee,
    });
    if (!accounting.ok) return;
    equity += accounting.netPnl;
    trades.push({
      side: current.side, timeframe: current.timeframe,
      entry: current.entry, exit, quantity: current.quantity,
      pnl: accounting.netPnl, reason, entryTime: current.entryTime, exitTime: time,
    });
    position = null;
  };

  for (let i = 60; i < baseRows.length - 1; i++) {
    const candle = baseRows[i];
    if (candle.time < startTime) continue;
    if (candle.closeTime >= endTime) break;

    if (position) {
      const exit = resolveIntrabarExit({
        side: position.side, open: candle.open, high: candle.high, low: candle.low,
        stop: position.stop, target: position.target,
      });
      if (exit) closePosition(exit.price, exit.reason, candle.time);
    }

    const decisionTime = candle.closeTime;
    const snapshots = Object.fromEntries(REQUIRED_FRAMES.map(frame => [
      frame, selectClosedCandlesAsOf(dataByFrame[frame], decisionTime, 120),
    ]));
    const evaluations = {};
    const roleMetricsByTimeframe = {};

    for (const timeframe of ['5m', '15m', '1h']) {
      const profile = TIMEFRAME_PROFILES[timeframe];
      const roleRows = buildTimeframeRoleData(snapshots, timeframe);
      if (!roleRows) {
        evaluations[timeframe] = { decision: 'NO TRADE', score: 0 };
        continue;
      }
      const roles = Object.fromEntries(
        Object.entries(roleRows).map(([role, rows]) => [role, evaluateFrame(rows, role, decisionTime)])
      );
      if (['4h', '1h', '15m', '5m'].some(role => !roles[role])) {
        evaluations[timeframe] = { decision: 'NO TRADE', score: 0 };
        continue;
      }
      const entryRows = snapshots[profile.entry];
      if (entryRows.at(-1)?.closeTime !== decisionTime) {
        evaluations[timeframe] = { decision: 'NO TRADE', score: 0 };
        continue;
      }
      const labels = {
        contextSlow: profile.contextSlow,
        contextFast: profile.contextFast,
        setup: profile.setup,
        entry: profile.entry,
      };
      const entryFrame = roles['5m'];
      evaluations[timeframe] = evaluateMtfDecision({
        data: roles,
        flow: { takerRatio: entryFrame.takerRatio },
        flowMode: 'historical',
        entry: entryFrame.close,
        market,
        accountBalance: equity,
        feeRate,
        slippageRate,
        frameLabels: labels,
      });
      roleMetricsByTimeframe[timeframe] = roles;
    }

    const selected = selectBestTimeframeSignal(evaluations, 'AUTO');
    if (selected.selectionStatus === 'CONFLICT') conflicts++;
    if (selected.decision !== 'NO TRADE' && selected.selectedTimeframe) {
      const timeframe = selected.selectedTimeframe;
      selectedCounts[timeframe]++;
      signals++;
      if (!position && (market === 'Futures' || selected.decision === 'LONG')) {
        const entryRows = dataByFrame[timeframe];
        const entryIndex = entryRows.findIndex(row => row.closeTime === decisionTime);
        const nextCandle = entryRows[entryIndex + 1];
        const entryMetrics = roleMetricsByTimeframe[timeframe]?.['5m'];
        const entry = nextCandle
          ? applyAdverseSlippage(nextCandle.open, selected.decision, 'ENTRY', slippageRate)
          : null;
        const riskPlan = validateSignalRiskPlan({
          side: selected.decision, entry, atr: entryMetrics?.atr, market,
          accountBalance: equity, feeRate, slippageRate,
        });
        if (nextCandle && riskPlan.ok) {
          const quantity = riskPlan.quantity;
          const margin = entry * quantity / (market === 'Futures' ? 3 : 1);
          const entryFee = entry * quantity * feeRate;
          if (Number.isFinite(quantity) && quantity > 0 && margin + entryFee <= equity) {
            position = {
              side: selected.decision, timeframe, entry, quantity,
              stop: riskPlan.stop, target: riskPlan.target,
              entryFee, entryTime: nextCandle.time,
            };
          }
        }
      }
    }

    const active = position && position.entryTime <= candle.time;
    const estimatedExitCost = active ? candle.close * position.quantity * (feeRate + slippageRate) : 0;
    const marked = equity + (active
      ? ((candle.close - position.entry) * position.quantity * (position.side === 'LONG' ? 1 : -1) - position.entryFee - estimatedExitCost)
      : 0);
    peak = Math.max(peak, marked);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - marked) / peak * 100 : 0);
  }

  const finalCandle = [...baseRows].reverse().find(row => row.time >= startTime && row.closeTime < endTime);
  if (position && finalCandle) closePosition(finalCandle.close, 'END OF TEST', finalCandle.time);
  const wins = trades.filter(trade => trade.pnl > 0);
  const losses = trades.filter(trade => trade.pnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
  return {
    ok: true, timeframe: 'AUTO', market, initialBalance: accountBalance, equity,
    net: equity - accountBalance, returnPct: (equity - accountBalance) / accountBalance * 100,
    tradeCount: trades.length, wins: wins.length, losses: losses.length,
    winRate: trades.length ? wins.length / trades.length * 100 : 0,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
    expectancy: trades.length ? (equity - accountBalance) / trades.length : 0,
    maxDrawdown, signals, conflicts, selectedCounts, trades,
  };
}
