/** Sequential, non-overlapping OOS folds with a fixed pre-test warm-up only. */
export function createSequentialOosFolds(rows,testStartIndex,count=3,warmup=60){
 if(!Array.isArray(rows)||!Number.isInteger(testStartIndex)||!Number.isInteger(count)||!Number.isInteger(warmup)||count<1||warmup<1||testStartIndex<warmup||testStartIndex>=rows.length||rows.length-testStartIndex<count)return [];
 for(let i=0;i<rows.length;i++)if(!rows[i]||!Number.isFinite(rows[i].time)||(i&&rows[i].time<=rows[i-1].time))return [];
 const size=Math.floor((rows.length-testStartIndex)/count),folds=[];
 for(let n=0;n<count;n++){
  const from=testStartIndex+n*size,to=n===count-1?rows.length:testStartIndex+(n+1)*size,dataFrom=Math.max(0,from-warmup),data=rows.slice(dataFrom,to),warmupCount=from-dataFrom;
  if(data.length-warmupCount<1)return [];
  folds.push({index:n+1,data,warmupCount,testFrom:from,testTo:to,testStartTime:rows[from].time,testEndTime:rows[to-1].time});
 }
 return folds;
}
/** Aggregate independent OOS folds; expose the worst individual fold drawdown. */
export function aggregateWalkForwardResults(results,initialBalance=1000){
 if(!Array.isArray(results)||!results.length||!Number.isFinite(initialBalance)||initialBalance<=0||results.some(r=>!r?.ok||!r.metrics||!Array.isArray(r.trades)))throw new Error('Walk-Forward fold results invalid.');
 const trades=results.flatMap(r=>r.trades),wins=trades.filter(t=>t.netPnl>0),losses=trades.filter(t=>t.netPnl<0),grossProfit=wins.reduce((s,t)=>s+t.netPnl,0),grossLoss=Math.abs(losses.reduce((s,t)=>s+t.netPnl,0)),netPnl=trades.reduce((s,t)=>s+t.netPnl,0);
 return {tradeCount:trades.length,wins:wins.length,losses:losses.length,breakeven:trades.length-wins.length-losses.length,winRatePct:trades.length?wins.length/trades.length*100:0,netPnl,returnPct:netPnl/initialBalance*100,profitFactor:grossLoss>0?grossProfit/grossLoss:grossProfit>0?null:0,expectancy:trades.length?netPnl/trades.length:0,averageR:trades.length?trades.reduce((s,t)=>s+t.rMultiple,0)/trades.length:0,maxDrawdownPct:Math.max(...results.map(r=>r.metrics.maxDrawdownPct)),finalBalance:initialBalance+netPnl,initialBalance,feesPaid:trades.reduce((s,t)=>s+t.fees,0)};
}
