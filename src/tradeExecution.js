export function applyAdverseSlippage(price, side, action, slippageRate = 0) {
  if (!Number.isFinite(price) || price <= 0 ||
      !Number.isFinite(slippageRate) || slippageRate < 0 ||
      !['LONG', 'SHORT'].includes(side) ||
      !['ENTRY', 'EXIT'].includes(action)) return null;
  const isBuy = (side === 'LONG' && action === 'ENTRY') ||
    (side === 'SHORT' && action === 'EXIT');
  return price * (isBuy ? 1 + slippageRate : 1 - slippageRate);
}

export function calculateTradePnl({
  side, entry, exit, quantity, feeRate = 0.0005, entryFee = null,
} = {}) {
  if (!['LONG', 'SHORT'].includes(side) ||
      ![entry, exit, quantity, feeRate].every(Number.isFinite) ||
      entry <= 0 || exit <= 0 || quantity <= 0 || feeRate < 0 ||
      (entryFee !== null && (!Number.isFinite(entryFee) || entryFee < 0))) {
    return { ok: false, reason: 'Invalid trade accounting inputs' };
  }
  const grossPnl = (exit - entry) * quantity * (side === 'LONG' ? 1 : -1);
  const chargedEntryFee = entryFee === null ? entry * quantity * feeRate : entryFee;
  const exitFee = exit * quantity * feeRate;
  return {
    ok: true, grossPnl, entryFee: chargedEntryFee, exitFee,
    netPnl: grossPnl - chargedEntryFee - exitFee,
  };
}

export function resolveIntrabarExit({ side, high, low, stop, target } = {}) {
  if (!['LONG', 'SHORT'].includes(side) ||
      ![high, low, stop, target].every(Number.isFinite) ||
      high < low || stop <= 0 || target <= 0) return null;
  const stopHit = side === 'LONG' ? low <= stop : high >= stop;
  const targetHit = side === 'LONG' ? high >= target : low <= target;
  if (stopHit) return { price: stop, reason: 'STOP LOSS' };
  if (targetHit) return { price: target, reason: 'TAKE PROFIT' };
  return null;
}
