export function suggestConservativeLeverage({ entry, atr, maxLeverage = 5, riskPerMargin = 0.02 } = {}) {
  if (![entry, atr, maxLeverage, riskPerMargin].every(Number.isFinite) ||
      entry <= 0 || atr <= 0 || maxLeverage < 1 || riskPerMargin <= 0) return null;
  const stopDistancePct = (atr * 1.5) / entry;
  if (!Number.isFinite(stopDistancePct) || stopDistancePct <= 0) return null;
  return Math.max(1, Math.min(Math.floor(maxLeverage), Math.floor(riskPerMargin / stopDistancePct)));
}

export function calculatePaperQuantity({
  entry, margin, leverage = 1, feeRate = 0, riskQuantity, availableBalance,
} = {}) {
  if (![entry, margin, leverage, feeRate, riskQuantity, availableBalance].every(Number.isFinite) ||
      entry <= 0 || margin <= 0 || leverage < 1 || feeRate < 0 ||
      riskQuantity <= 0 || availableBalance <= 0 || margin > availableBalance) return 0;
  const quantityWithinMargin = margin / (entry / leverage + entry * feeRate);
  const quantity = Math.min(riskQuantity, quantityWithinMargin);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}
