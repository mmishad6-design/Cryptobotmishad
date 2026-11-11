import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, Bell, BookOpen, CandlestickChart, ChevronDown, CircleHelp, Clock3, Command, Compass, Crosshair, Download, Eye, Filter, Globe2, Layers3, Menu, Moon, Newspaper, PanelLeftClose, Plus, Play, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Sun, Target, Trash2, TrendingDown, TrendingUp, Wallet, X } from 'lucide-react';

const WATCH = [
  ['BTCUSDT','Bitcoin','BTC'],['ETHUSDT','Ethereum','ETH'],['BNBUSDT','BNB','BNB'],['SOLUSDT','Solana','SOL'],
  ['XRPUSDT','XRP','XRP'],['DOGEUSDT','Dogecoin','DOGE'],['ADAUSDT','Cardano','ADA'],['AVAXUSDT','Avalanche','AVAX'],
  ['LINKUSDT','Chainlink','LINK'],['SUIUSDT','Sui','SUI'],['TONUSDT','Toncoin','TON'],['TRXUSDT','TRON','TRX']
];
const fmt = (n, digits=2) => Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}) : '—';
const compact = n => n >= 1e9 ? (n/1e9).toFixed(2)+'B' : n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e3 ? (n/1e3).toFixed(2)+'K' : fmt(n);
const intervals = ['1m','5m','15m','1h','4h','1d'];

function ChartPanel({symbol, interval, candles, loading, market}) {
  const host = useRef(null);
  const chartRef = useRef(null);
  const didFit = useRef(false);
  useEffect(() => {
    if (!host.current) return;
    const chart = createChart(host.current, {
      autoSize: true, layout: { background: { type: 'solid', color: '#101720' }, textColor: '#8190a3', fontFamily: 'Inter, ui-sans-serif, system-ui', fontSize: 11 },
      grid: { vertLines: { color: '#1b2632' }, horzLines: { color: '#1b2632' } },
      rightPriceScale: { borderColor: '#263341' }, timeScale: { borderColor: '#263341', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 }, handleScroll: true, handleScale: true
    });
    const series = chart.addSeries(CandlestickSeries, { upColor:'#19b88a', downColor:'#ef6472', borderUpColor:'#19b88a', borderDownColor:'#ef6472', wickUpColor:'#19b88a', wickDownColor:'#ef6472' });
    chartRef.current = {chart,series};
    didFit.current = false;
    const resize = new ResizeObserver(entries => { if(entries[0]) chart.applyOptions({width:entries[0].contentRect.width}); });
    resize.observe(host.current);
    return () => { resize.disconnect(); chart.remove(); chartRef.current = null; };
  }, []);
  useEffect(() => {
    if (!chartRef.current || !candles?.length) return;
    chartRef.current.series.setData(candles);
    if (!didFit.current) { chartRef.current.chart.timeScale().fitContent(); didFit.current = true; }
  }, [candles]);
  return <div className="chart-wrap"><div className="chart-label">{loading ? 'Updating market data…' : `Binance ${market} · Public market data`} <span>•</span> {symbol.replace('USDT','')}/USDT</div><div className="chart-canvas" ref={host}/>{!candles?.length && <div className="chart-empty">Waiting for candle data</div>}</div>;
}


function BacktestPanel({symbol,market,defaultInterval}) {
  const [tf,setTf]=useState(defaultInterval||'15m');
  const [days,setDays]=useState('30');
  const [fee,setFee]=useState('0.05');
  const [slippage,setSlippage]=useState('0.02');
  const [running,setRunning]=useState(false);
  const [result,setResult]=useState(null);
  const [error,setError]=useState('');
  const run=async()=>{
    setRunning(true);setError('');setResult(null);
    try{
      const base=market==='Futures'?'https://fapi.binance.com':'https://api.binance.com';
      const endpoint=market==='Futures'?'/fapi/v1/klines':'/api/v3/klines';
      const now=Date.now(),start=now-Number(days)*86400000;
      const intervalMs={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000}[tf];
      // Binance paginates klines; fetch up to 5,000 recent bars within the selected lookback.
      let cursor=Math.max(start,now-5000*intervalMs),raw=[];
      while(cursor<now&&raw.length<5000){
        const url=base+endpoint+'?symbol='+symbol+'&interval='+tf+'&startTime='+cursor+'&endTime='+now+'&limit=1000';
        const response=await fetch(url);if(!response.ok)throw new Error('Binance historical data request failed ('+response.status+').');
        const batch=await response.json();if(!Array.isArray(batch)||batch.length===0)break;
        raw=raw.concat(batch);cursor=Number(batch[batch.length-1][0])+intervalMs;
        if(batch.length<1000)break;
      }
      if(raw.length<70)throw new Error('Not enough historical candles returned. Choose a longer period or another timeframe.');
      raw=raw.slice(0,5000);
      const data=raw.map(k=>({time:k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4]}));
      const feeRate=Math.max(0,Math.min(1,Number(fee)||0))/100,slipRate=Math.max(0,Math.min(1,Number(slippage)||0))/100,starting=10000,leverage=market==='Futures'?3:1;
      let equity=starting,peak=starting,maxDrawdown=0,position=null,tradeList=[];
      const avg=(arr,end,n)=>{let sum=0;for(let j=end-n+1;j<=end;j++)sum+=arr[j].close;return sum/n;};
      const atrAt=i=>{let sum=0,count=0;for(let j=i-14;j<=i;j++){const prev=data[j-1]?.close??data[j].close;sum+=Math.max(data[j].high-data[j].low,Math.abs(data[j].high-prev),Math.abs(data[j].low-prev));count++;}return sum/count;};
      const closePosition=(rawExit,reason,time)=>{
        const p=position;if(!p)return;
        const exit=p.side==='LONG'?rawExit*(1-slipRate):rawExit*(1+slipRate);
        const gross=(exit-p.entry)*p.qty*(p.side==='LONG'?1:-1);
        const exitFee=exit*p.qty*feeRate,net=gross-p.entryFee-exitFee;
        equity+=net;
        tradeList.push({side:p.side,entry:p.entry,exit,qty:p.qty,pnl:net,reason,entryTime:new Date(p.entryTime).toISOString(),exitTime:new Date(time).toISOString()});
        position=null;
      };
      for(let i=50;i<data.length-1;i++){
        const c=data[i],next=data[i+1],closes=data.slice(0,i+1).map(x=>x.close);
        const last=c.close,ma20=avg(data,i,20),ma50=avg(data,i,50),prev=data[i-1].close,momentum=(last-prev)/prev*100;
        let score=50;if(last>ma20)score+=12;else score-=12;if(ma20>ma50)score+=15;else score-=15;if(momentum>0.08)score+=8;else if(momentum<-.08)score-=8;
        const bias=score>=65?'LONG':score<=35?'SHORT':'WAIT';
        if(position){
          const stopHit=position.side==='LONG'?c.low<=position.stop:c.high>=position.stop;
          const targetHit=position.side==='LONG'?c.high>=position.target:c.low<=position.target;
          // Conservative same-candle assumption: if both levels are touched, count the stop first.
          if(stopHit)closePosition(position.stop,'STOP LOSS',c.time);
          else if(targetHit)closePosition(position.target,'TAKE PROFIT',c.time);
        }
        if(!position&&next&&bias!=='WAIT'&&(market==='Futures'||bias==='LONG')){
          const atr=atrAt(i),rawEntry=next.open,entry=bias==='LONG'?rawEntry*(1+slipRate):rawEntry*(1-slipRate);
          const stopDistance=atr*1.5,riskCash=equity*0.01;
          let qty=riskCash/stopDistance;
          qty=Math.min(qty,(equity*leverage)/(entry*(1+feeRate)));
          if(Number.isFinite(qty)&&qty>0){
            const margin=entry*qty/leverage,entryFee=entry*qty*feeRate;
            if(margin+entryFee<=equity){
              position={side:bias,entry,qty,stop:bias==='LONG'?entry-stopDistance:entry+stopDistance,target:bias==='LONG'?entry+atr*3:entry-atr*3,entryFee,entryTime:next.time};
            }
          }
        }
        const marked=equity+(position?((c.close-position.entry)*position.qty*(position.side==='LONG'?1:-1)-position.entryFee):0);
        peak=Math.max(peak,marked);maxDrawdown=Math.max(maxDrawdown,(peak-marked)/peak*100);
      }
      if(position)closePosition(data[data.length-1].close,'END OF TEST',data[data.length-1].time);
      peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,(peak-equity)/peak*100);
      const wins=tradeList.filter(t=>t.pnl>0),losses=tradeList.filter(t=>t.pnl<0);
      const grossProfit=wins.reduce((a,t)=>a+t.pnl,0),grossLoss=Math.abs(losses.reduce((a,t)=>a+t.pnl,0));
      const net=equity-starting,winRate=tradeList.length?wins.length/tradeList.length*100:0;
      setResult({symbol,market,tf,days,from:data[0].time,to:data[data.length-1].time,candles:data.length,trades:tradeList.length,wins:wins.length,losses:losses.length,winRate,net,returnPct:net/starting*100,finalEquity:equity,maxDrawdown,profitFactor:grossLoss?grossProfit/grossLoss:grossProfit>0?null:0,expectancy:tradeList.length?net/tradeList.length:0,feeRate,slipRate,tradeList:tradeList.slice(-12).reverse(),assumption:'Signals use closed candles; entries occur at the next candle open. If SL and TP both touch in one candle, SL is assumed first. Up to 5,000 recent candles are tested within the selected lookback.'});
    }catch(e){setError(e.message||'Backtest failed. Please retry.');}
    finally{setRunning(false);}
  };
  return <section className="panel backtest-panel">
    <div className="panel-title"><div><h3>Historical strategy backtest</h3><p>Same SMA20/SMA50 + momentum rules · No future-candle lookahead</p></div><span className="tiny-live">RESEARCH MODE</span></div>
    <div className="backtest-controls">
      <label>MARKET TIMEFRAME<select value={tf} onChange={e=>setTf(e.target.value)}>{['1m','5m','15m','1h','4h','1d'].map(x=><option key={x}>{x}</option>)}</select></label>
      <label>HISTORY<select value={days} onChange={e=>setDays(e.target.value)}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option></select></label>
      <label>TRADING FEE (%)<input type="number" min="0" max="1" step="0.01" value={fee} onChange={e=>setFee(e.target.value)}/></label>
      <label>SLIPPAGE (%)<input type="number" min="0" max="1" step="0.01" value={slippage} onChange={e=>setSlippage(e.target.value)}/></label>
      <button className="primary-btn" disabled={running} onClick={run}><Play size={14}/>{running?'Running…':'Run backtest'}</button>
    </div>
    {error&&<div className="backtest-error">{error}</div>}
    {result&&<>
      <div className="backtest-meta"><span>{result.symbol.replace('USDT','')}/USDT · Binance {result.market}</span><span>{new Date(result.from).toLocaleDateString()} – {new Date(result.to).toLocaleDateString()}</span><span>{result.candles} candles</span></div>
      <div className="backtest-metrics">
        <div><span>NET P&L</span><b className={result.net>=0?'positive':'negative'}>{result.net>=0?'+':''}${fmt(result.net)}</b></div>
        <div><span>RETURN</span><b className={result.returnPct>=0?'positive':'negative'}>{result.returnPct>=0?'+':''}{fmt(result.returnPct)}%</b></div>
        <div><span>WIN RATE</span><b>{fmt(result.winRate)}%</b></div>
        <div><span>TRADES</span><b>{result.trades}</b></div>
        <div><span>PROFIT FACTOR</span><b>{result.profitFactor===null?'∞':fmt(result.profitFactor)}</b></div>
        <div><span>MAX DRAWDOWN</span><b className="negative">{fmt(result.maxDrawdown)}%</b></div>
        <div><span>EXPECTANCY / TRADE</span><b className={result.expectancy>=0?'positive':'negative'}>${fmt(result.expectancy)}</b></div>
        <div><span>ENDING EQUITY</span><b>${fmt(result.finalEquity)}</b></div>
      </div>
      <p className="backtest-assumption">{result.assumption} Starting capital: $10,000. Fee {fmt(Number(fee),3)}% per side; slippage {fmt(Number(slippage),3)}% per side. Futures simulation uses 3x notional cap. Funding, liquidation, spread and partial fills are not modelled.</p>
      <div className="backtest-table-wrap"><table className="backtest-table"><thead><tr><th>Side</th><th>Entry</th><th>Exit</th><th>Net P&L</th><th>Exit reason</th></tr></thead><tbody>{result.tradeList.map((t,i)=><tr key={i}><td>{t.side}</td><td>{fmt(t.entry, t.entry<1?5:3)}</td><td>{fmt(t.exit,t.exit<1?5:3)}</td><td className={t.pnl>=0?'positive':'negative'}>{t.pnl>=0?'+':''}${fmt(t.pnl)}</td><td>{t.reason}</td></tr>)}</tbody></table></div>
    </>}
    <div className="backtest-disclaimer"><ShieldCheck size={14}/> Historical simulation only. Results are not forecasts, and a profitable backtest does not prove future profitability.</div>
  </section>;
}


function StrategyOptimizer({symbol,market}) {
  const [tf,setTf]=useState('15m'),[days,setDays]=useState('30'),[fee,setFee]=useState('0.05'),[slippage,setSlippage]=useState('0.02');
  const [running,setRunning]=useState(false),[result,setResult]=useState(null),[error,setError]=useState('');
  const [history,setHistory]=useState(()=>{try{return JSON.parse(localStorage.getItem('cryptobot.strategyRuns')||'[]');}catch{return [];}});
  useEffect(()=>{try{localStorage.setItem('cryptobot.strategyRuns',JSON.stringify(history.slice(0,10)));}catch{}},[history]);
  const exportCsv=()=>{if(!result)return;const rows=[['Rank','Symbol','Market','Timeframe','Fast SMA','Slow SMA','Stop ATR','Target ATR','Train Return %','Train Max Drawdown %','Test Return %','Test Max Drawdown %','Test Win Rate %','Test Trades','Test Profit Factor'],...result.ranked.map((x,i)=>[i+1,result.symbol,result.market,result.tf,x.fast,x.slow,x.sl,x.tp,x.train.returnPct,x.train.maxDD,x.test.returnPct,x.test.maxDD,x.test.winRate,x.test.trades,x.test.profitFactor===null?'Infinity':x.test.profitFactor])];const csv=rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='cryptobot-strategy-'+result.symbol+'-'+result.tf+'-'+Date.now()+'.csv';a.click();URL.revokeObjectURL(url);};
  const run=async()=>{
    setRunning(true);setError('');setResult(null);
    try{
      const base=market==='Futures'?'https://fapi.binance.com':'https://api.binance.com';
      const endpoint=market==='Futures'?'/fapi/v1/klines':'/api/v3/klines';
      const now=Date.now(),start=now-Number(days)*86400000;
      const ms={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000}[tf];
      let cursor=Math.max(start,now-5000*ms),raw=[];
      while(cursor<now&&raw.length<5000){
        const r=await fetch(base+endpoint+'?symbol='+symbol+'&interval='+tf+'&startTime='+cursor+'&endTime='+now+'&limit=1000');
        if(!r.ok)throw new Error('Binance historical data request failed ('+r.status+').');
        const batch=await r.json();if(!Array.isArray(batch)||!batch.length)break;
        raw=raw.concat(batch);cursor=Number(batch[batch.length-1][0])+ms;if(batch.length<1000)break;
      }
      const data=raw.slice(0,5000).map(k=>({time:k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4]}));
      if(data.length<180)throw new Error('At least 180 candles are required. Choose a longer history or timeframe.');
      const feeRate=Math.max(0,Math.min(1,Number(fee)||0))/100,slipRate=Math.max(0,Math.min(1,Number(slippage)||0))/100;
      const split=Math.floor(data.length*.7),starting=10000;
      const configs=[];
      [10,20].forEach(fast=>[50,100].forEach(slow=>{if(fast>=slow)return;[1,1.5].forEach(sl=>[2,3].forEach(tp=>configs.push({fast,slow,sl,tp})));}));
      const simulate=(cfg,from,to)=>{
        let equity=starting,peak=starting,maxDD=0,pos=null,trades=[];
        const avg=(i,n)=>{let s=0;for(let j=i-n+1;j<=i;j++)s+=data[j].close;return s/n;};
        const atr=i=>{let s=0;for(let j=i-14;j<=i;j++){const p=data[j-1]?.close??data[j].close;s+=Math.max(data[j].high-data[j].low,Math.abs(data[j].high-p),Math.abs(data[j].low-p));}return s/15;};
        const close=(raw,reason,time)=>{const p=pos;if(!p)return;const exit=p.side==='LONG'?raw*(1-slipRate):raw*(1+slipRate);const gross=(exit-p.entry)*p.qty*(p.side==='LONG'?1:-1);const net=gross-p.entry* p.qty*feeRate-exit*p.qty*feeRate;equity+=net;trades.push({pnl:net,reason});pos=null;};
        for(let i=Math.max(cfg.slow,from);i<to-1;i++){
          const c=data[i],next=data[i+1],last=c.close,mf=avg(i,cfg.fast),mslow=avg(i,cfg.slow),mom=(last-data[i-1].close)/data[i-1].close*100;
          let score=50;if(last>mf)score+=12;else score-=12;if(mf>mslow)score+=15;else score-=15;if(mom>.08)score+=8;else if(mom<-.08)score-=8;
          const bias=score>=65?'LONG':score<=35?'SHORT':'WAIT';
          if(pos){const stop=pos.side==='LONG'?c.low<=pos.stop:c.high>=pos.stop;const target=pos.side==='LONG'?c.high>=pos.target:c.low<=pos.target;if(stop)close(pos.stop,'SL',c.time);else if(target)close(pos.target,'TP',c.time);}
          if(!pos&&bias!=='WAIT'&&(market==='Futures'||bias==='LONG')){
            const a=atr(i),entryRaw=next.open,entry=bias==='LONG'?entryRaw*(1+slipRate):entryRaw*(1-slipRate),distance=a*cfg.sl,risk=equity*.01;
            let qty=risk/distance;qty=Math.min(qty,equity*(market==='Futures'?3:1)/(entry*(1+feeRate)));
            const margin=entry*qty/(market==='Futures'?3:1),entryFee=entry*qty*feeRate;
            if(Number.isFinite(qty)&&qty>0&&margin+entryFee<=equity)pos={side:bias,entry,qty,stop:bias==='LONG'?entry-distance:entry+distance,target:bias==='LONG'?entry+a*cfg.tp:entry-a*cfg.tp};
          }
          const marked=equity+(pos?((c.close-pos.entry)*pos.qty*(pos.side==='LONG'?1:-1)-pos.entry*pos.qty*feeRate):0);
          peak=Math.max(peak,marked);maxDD=Math.max(maxDD,(peak-marked)/peak*100);
        }
        if(pos)close(data[to-1].close,'END',data[to-1].time);
        const wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<0),gp=wins.reduce((s,t)=>s+t.pnl,0),gl=Math.abs(losses.reduce((s,t)=>s+t.pnl,0));
        return {trades:trades.length,winRate:trades.length?wins.length/trades.length*100:0,net:equity-starting,returnPct:(equity-starting)/starting*100,maxDD,profitFactor:gl?gp/gl:gp>0?null:0,expectancy:trades.length?(equity-starting)/trades.length:0};
      };
      const tested=configs.map(cfg=>({...cfg,train:simulate(cfg,0,split)})).filter(x=>x.train.trades>=5);
      if(!tested.length)throw new Error('No parameter set produced at least 5 training trades. Try a longer history or another timeframe.');
      tested.sort((a,b)=>{
        const score=x=>(x.train.profitFactor===null?3:x.train.profitFactor)+x.train.returnPct*.015-x.train.maxDD*.08;
        return score(b)-score(a);
      });
      const ranked=tested.slice(0,8).map(x=>({...x,test:simulate(x,split,data.length)}));
      const completed={id:Date.now(),createdAt:new Date().toISOString(),symbol,market,tf,days,candles:data.length,from:data[0].time,split:data[split].time,to:data[data.length-1].time,trainingCandles:split,testCandles:data.length-split,ranked,feeRate,slipRate};setResult(completed);setHistory(prev=>[completed,...prev.filter(x=>x.id!==completed.id)].slice(0,10));
    }catch(e){setError(e.message||'Optimization failed. Please retry.');}
    finally{setRunning(false);}
  };
  return <section className="panel optimizer-panel">
    <div className="panel-title"><div><h3>Strategy optimization & validation</h3><p>Parameter search on the first 70% · independent validation on the final 30%</p></div><span className="tiny-live">RESEARCH MODE</span></div>
    <div className="backtest-controls optimizer-controls">
      <label>TIMEFRAME<select value={tf} onChange={e=>setTf(e.target.value)}>{['5m','15m','1h','4h','1d'].map(x=><option key={x}>{x}</option>)}</select></label>
      <label>HISTORY<select value={days} onChange={e=>setDays(e.target.value)}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option></select></label>
      <label>FEE (%)<input type="number" min="0" max="1" step="0.01" value={fee} onChange={e=>setFee(e.target.value)}/></label>
      <label>SLIPPAGE (%)<input type="number" min="0" max="1" step="0.01" value={slippage} onChange={e=>setSlippage(e.target.value)}/></label>
      <button className="primary-btn" disabled={running} onClick={run}><Play size={14}/>{running?'Testing…':'Optimize strategy'}</button>
    </div>
    {error&&<div className="backtest-error">{error}</div>}
    {result&&<>
      <div className="backtest-meta"><span>{result.symbol.replace('USDT','')}/USDT · Binance {result.market}</span><span>{new Date(result.from).toLocaleDateString()} – {new Date(result.to).toLocaleDateString()}</span><span>{result.candles} candles · {result.ranked.length} candidates ranked</span></div>
      <div className="validation-split"><div><b>IN-SAMPLE · 70%</b><span>{result.trainingCandles} candles · used to rank settings</span></div><div><b>OUT-OF-SAMPLE · 30%</b><span>{result.testCandles} candles · unseen validation period</span></div></div>
      <div className="backtest-table-wrap"><table className="backtest-table optimizer-table"><thead><tr><th>Rank</th><th>Parameters (Fast / Slow)</th><th>SL × ATR</th><th>TP × ATR</th><th>Train return</th><th>Train DD</th><th>Test return</th><th>Test DD</th><th>Test win rate</th><th>Test trades</th><th>Test PF</th></tr></thead><tbody>{result.ranked.map((x,i)=><tr key={x.fast+'-'+x.slow+'-'+x.sl+'-'+x.tp}><td>{i+1}</td><td>SMA {x.fast}/{x.slow}</td><td>{x.sl}×</td><td>{x.tp}×</td><td className={x.train.returnPct>=0?'positive':'negative'}>{x.train.returnPct>=0?'+':''}{fmt(x.train.returnPct)}%</td><td>{fmt(x.train.maxDD)}%</td><td className={x.test.returnPct>=0?'positive':'negative'}>{x.test.returnPct>=0?'+':''}{fmt(x.test.returnPct)}%</td><td className='negative'>{fmt(x.test.maxDD)}%</td><td>{fmt(x.test.winRate)}%</td><td>{x.test.trades}</td><td>{x.test.profitFactor===null?'∞':fmt(x.test.profitFactor)}</td></tr>)}</tbody></table></div>
      <p className="backtest-assumption">Ranking uses training-period results only. The final 30% is evaluated after selecting candidates and is not used to rank them. Starting capital $10,000 per simulation; 1% risk budget per trade; Futures notional capped at 3×. Fees and slippage applied on entry/exit. Funding, liquidation, spread, partial fills and market impact are excluded. Up to 5,000 recent candles.</p>
    </>}
    {history.length>0&&<div className="optimizer-history"><div className="optimizer-history-head"><div><h4>Saved optimization runs</h4><p>Stored locally in this browser · latest 10 runs</p></div><button className="icon-btn" title="Clear saved runs" onClick={()=>{if(window.confirm('Clear all saved Strategy Lab runs from this browser?'))setHistory([]);}}><Trash2 size={15}/></button></div><div className="optimizer-history-list">{history.map(item=><button key={item.id} className={`optimizer-history-item ${result?.id===item.id?'active':''}`} onClick={()=>setResult(item)}><span><b>{item.symbol.replace('USDT','')}/USDT · {item.market}</b><small>{item.tf} · {new Date(item.createdAt).toLocaleString()}</small></span><span><b className={(item.ranked[0]?.test.returnPct??0)>=0?'positive':'negative'}>{item.ranked[0]?((item.ranked[0].test.returnPct>=0?'+':'')+fmt(item.ranked[0].test.returnPct)+'%'):'—'}</b><small>Top candidate OOS return</small></span></button>)}</div></div>}\n    <div className="backtest-disclaimer"><ShieldCheck size={14}/> This is a parameter sensitivity experiment, not proof of a trading edge. Small samples and historical regimes can mislead; compare out-of-sample results and drawdown before drawing conclusions.</div>
  </section>;
}


function MultiAssetScanner({market}) {
 const [tfs,setTfs]=useState(['15m','1h','4h']),[fee,setFee]=useState('0.05'),[slip,setSlip]=useState('0.02'),[busy,setBusy]=useState(false),[rows,setRows]=useState([]),[error,setError]=useState(''),[sort,setSort]=useState('returnPct'),[done,setDone]=useState(false);
 const toggle=tf=>setTfs(v=>v.includes(tf)?v.filter(x=>x!==tf):[...v,tf]);
 const run=async()=>{
  if(!tfs.length){setError('Select at least one timeframe.');return;}
  setBusy(true);setError('');setRows([]);setDone(false);
  const base=market==='Futures'?'https://fapi.binance.com':'https://api.binance.com',path=market==='Futures'?'/fapi/v1/klines':'/api/v3/klines',feeRate=Math.max(0,Math.min(1,+fee||0))/100,slipRate=Math.max(0,Math.min(1,+slip||0))/100;
  const jobs=WATCH.flatMap(a=>tfs.map(tf=>({a,tf}))),all=[];
  try{
   for(let n=0;n<jobs.length;n+=6){
    const batch=await Promise.all(jobs.slice(n,n+6).map(async job=>{
     try{
      const res=await fetch(base+path+'?symbol='+job.a[0]+'&interval='+job.tf+'&limit=500');if(!res.ok)throw Error('HTTP '+res.status);
      const raw=await res.json();if(!Array.isArray(raw)||raw.length<120)throw Error('Not enough candles');
      const d=raw.map(k=>({time:+k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4]}));
      const avg=(i,len)=>d.slice(i-len+1,i+1).reduce((s,x)=>s+x.close,0)/len;
      const atr=i=>{let v=0;for(let j=i-14;j<=i;j++){let p=d[j-1]?.close??d[j].close;v+=Math.max(d[j].high-d[j].low,Math.abs(d[j].high-p),Math.abs(d[j].low-p));}return v/15;};
      let eq=10000,peak=10000,dd=0,pos=null,trades=[];
      const close=(price)=>{let x=pos.side==='LONG'?price*(1-slipRate):price*(1+slipRate),p=(x-pos.entry)*pos.qty*(pos.side==='LONG'?1:-1)-pos.entry*pos.qty*feeRate-x*pos.qty*feeRate;eq+=p;trades.push(p);pos=null;};
      for(let i=50;i<d.length-1;i++){
       const c=d[i],m20=avg(i,20),m50=avg(i,50),mom=(c.close-d[i-1].close)/d[i-1].close*100;
       let score=50+(c.close>m20?12:-12)+(m20>m50?15:-15)+(mom>.08?8:mom<-.08?-8:0),bias=score>=65?'LONG':score<=35?'SHORT':'WAIT';
       if(pos){let stop=pos.side==='LONG'?c.low<=pos.stop:c.high>=pos.stop,target=pos.side==='LONG'?c.high>=pos.target:c.low<=pos.target;if(stop)close(pos.stop);else if(target)close(pos.target);}
       if(!pos&&bias!=='WAIT'&&(market==='Futures'||bias==='LONG')){let a=atr(i),entry0=d[i+1].open,entry=bias==='LONG'?entry0*(1+slipRate):entry0*(1-slipRate),dist=a*1.5,qty=Math.min(eq*.01/dist,eq*(market==='Futures'?3:1)/(entry*(1+feeRate)));if(Number.isFinite(qty)&&qty>0)pos={side:bias,entry,qty,stop:bias==='LONG'?entry-dist:entry+dist,target:bias==='LONG'?entry+a*3:entry-a*3};}
       let marked=eq+(pos?(c.close-pos.entry)*pos.qty*(pos.side==='LONG'?1:-1)-pos.entry*pos.qty*feeRate:0);peak=Math.max(peak,marked);dd=Math.max(dd,(peak-marked)/peak*100);
      }
      if(pos)close(d[d.length-1].close);
      const wins=trades.filter(x=>x>0),losses=trades.filter(x=>x<0),gp=wins.reduce((s,x)=>s+x,0),gl=Math.abs(losses.reduce((s,x)=>s+x,0)),last=d.length-1,m20=avg(last,20),m50=avg(last,50),mom=(d[last].close-d[last-1].close)/d[last-1].close*100,score=50+(d[last].close>m20?12:-12)+(m20>m50?15:-15)+(mom>.08?8:mom<-.08?-8:0);
      return {symbol:job.a[0],ticker:job.a[2],name:job.a[1],tf:job.tf,price:d[last].close,bias:score>=65?'LONG':score<=35?'SHORT':'WAIT',score,returnPct:(eq-10000)/100,trades:trades.length,winRate:trades.length?wins.length/trades.length*100:0,maxDD:dd,pf:gl?gp/gl:gp>0?null:0,candles:d.length,start:d[0].time,end:d[last].time};
     }catch(e){return {symbol:job.a[0],ticker:job.a[2],name:job.a[1],tf:job.tf,error:e.message||'Unavailable'};}
    }));
    all.push(...batch);setRows([...all]);
   }
   setDone(true);
  }catch(e){setError(e.message||'Scanner failed.');}
  finally{setBusy(false);}
 };
 const sorted=[...rows].sort((a,b)=>a.error?1:b.error?-1:(b[sort]??0)-(a[sort]??0));
 const exportCsv=()=>{const fields=['Asset','Symbol','Market','Timeframe','Price','Bias','Score','Return %','Max Drawdown %','Win Rate %','Trades','Profit Factor','Candles','Start','End'];const csv=[fields,...rows.map(x=>[x.name,x.symbol,market,x.tf,x.price,x.bias,x.score,x.returnPct,x.maxDD,x.winRate,x.trades,x.pf,x.candles,x.start?new Date(x.start).toISOString():'',x.end?new Date(x.end).toISOString():''])].map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\\r\\n');const blob=new Blob(['\\ufeff'+csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='cryptobot-multi-asset.csv';a.click();URL.revokeObjectURL(url);};
 return <section className="panel multi-scanner-panel">
  <div className="panel-title"><div><h3>Multi-asset strategy scanner</h3><p>Same SMA 20/50 + momentum + ATR rules across all 12 watchlist assets</p></div><span className="tiny-live">RESEARCH MODE</span></div>
  <div className="scanner-controls"><div className="scanner-control-group"><span>TIMEFRAMES</span><div className="scanner-chips">{['5m','15m','1h','4h','1d'].map(tf=><button key={tf} className={tfs.includes(tf)?'active':''} onClick={()=>toggle(tf)}>{tf}</button>)}</div></div><label>FEE (%)<input type="number" min="0" max="1" step="0.01" value={fee} onChange={e=>setFee(e.target.value)}/></label><label>SLIPPAGE (%)<input type="number" min="0" max="1" step="0.01" value={slip} onChange={e=>setSlip(e.target.value)}/></label><button className="primary-btn" disabled={busy} onClick={run}><Play size={14}/>{busy?'Scanning…':'Run market scan'}</button></div>
  {error&&<div className="backtest-error">{error}</div>}
  {busy&&<div className="scanner-progress"><span>Processed {rows.length} / {WATCH.length*tfs.length} asset/timeframe pairs</span><div><i style={{width:(rows.length/(WATCH.length*tfs.length)*100)+'%'}}/></div></div>}
  {done&&<div className="scanner-summary"><span>{rows.filter(x=>!x.error).length} / {rows.length} pairs scanned · {market}</span><button className="secondary-btn" onClick={exportCsv}><Download size={14}/> Export CSV</button></div>}
  {rows.length>0&&<div className="backtest-table-wrap"><table className="backtest-table scanner-table"><thead><tr><th>Asset</th><th>TF</th><th>Price</th><th>Current bias</th><th>Score</th><th><button onClick={()=>setSort('returnPct')}>Return ↕</button></th><th><button onClick={()=>setSort('maxDD')}>Max DD ↕</button></th><th><button onClick={()=>setSort('winRate')}>Win rate ↕</button></th><th>Trades</th><th>PF</th></tr></thead><tbody>{sorted.map(x=><tr key={x.symbol+x.tf}><td><b>{x.ticker}</b><small>{x.name}</small></td><td>{x.tf}</td>{x.error?<td colSpan="8" className="negative">{x.error}</td>:<><td>{"$"+fmt(x.price,x.price<1?6:3)}</td><td><span className={'scanner-bias '+x.bias.toLowerCase()}>{x.bias}</span></td><td>{x.score}/100</td><td className={x.returnPct>=0?'positive':'negative'}>{x.returnPct>=0?'+':''}{fmt(x.returnPct)}%</td><td className="negative">{fmt(x.maxDD)}%</td><td>{fmt(x.winRate)}%</td><td>{x.trades}</td><td>{x.pf===null?'∞':fmt(x.pf)}</td></>}</tr>)}</tbody></table></div>}
  <p className="backtest-assumption">Each pair uses up to 500 recent Binance candles; actual date range is included in the CSV. Each simulation starts with $10,000, risks 1% per trade, uses 1.5× ATR stop and 3× ATR target, and applies fee/slippage on both sides. Futures uses a 3× notional cap. Funding, liquidation, spread and partial fills are not modelled.</p>
  <div className="backtest-disclaimer"><ShieldCheck size={14}/> Historical comparisons only. A current LONG/SHORT label is a rule-based snapshot, not a forecast or recommendation. No strategy edge or future profitability is established.</div>
 </section>;
}


function MarketRegimeScanner({market}) {
 const [tf,setTf]=useState('1h'),[busy,setBusy]=useState(false),[rows,setRows]=useState([]),[error,setError]=useState(''),[done,setDone]=useState(false),[sort,setSort]=useState('adx');
 const run=async()=>{
  setBusy(true);setError('');setRows([]);setDone(false);
  const base=market==='Futures'?'https://fapi.binance.com':'https://api.binance.com';
  const path=market==='Futures'?'/fapi/v1/klines':'/api/v3/klines';const all=[];
  try{
   for(let n=0;n<WATCH.length;n+=6){
    const batch=await Promise.all(WATCH.slice(n,n+6).map(async asset=>{
     try{
      const res=await fetch(base+path+'?symbol='+asset[0]+'&interval='+tf+'&limit=220');
      if(!res.ok)throw new Error('Binance HTTP '+res.status);
      const raw=await res.json();if(!Array.isArray(raw)||raw.length<100)throw new Error('Insufficient candle history');
      const d=raw.slice(0,-1).map(k=>({time:+k[0],high:+k[2],low:+k[3],close:+k[4]}));
      const tr=[],plus=[],minus=[],atrSeries=[];
      for(let i=1;i<d.length;i++){
       const up=d[i].high-d[i-1].high,down=d[i-1].low-d[i].low;
       tr.push(Math.max(d[i].high-d[i].low,Math.abs(d[i].high-d[i-1].close),Math.abs(d[i].low-d[i-1].close)));
       plus.push(up>down&&up>0?up:0);minus.push(down>up&&down>0?down:0);
       if(tr.length>=14){const k=tr.length-1,atr=tr.slice(k-13,k+1).reduce((s,x)=>s+x,0)/14;atrSeries.push({atr,pct:atr/d[i].close*100});}
      }
      const dx=[];
      for(let i=13;i<tr.length;i++){
       const sumTR=tr.slice(i-13,i+1).reduce((s,x)=>s+x,0),p=plus.slice(i-13,i+1).reduce((s,x)=>s+x,0),m=minus.slice(i-13,i+1).reduce((s,x)=>s+x,0);
       const pdi=sumTR?p/sumTR*100:0,mdi=sumTR?m/sumTR*100:0;dx.push(pdi+mdi?Math.abs(pdi-mdi)/(pdi+mdi)*100:0);
      }
      const recentDX=dx.slice(-14),adx=recentDX.reduce((s,x)=>s+x,0)/Math.max(1,recentDX.length);
      const latest=atrSeries[atrSeries.length-1],recentAtr=atrSeries.slice(-100).map(x=>x.pct).sort((a,b)=>a-b);
      const median=recentAtr[Math.floor(recentAtr.length/2)],rank=atrSeries.filter(x=>x.pct<=latest.pct).length/atrSeries.length*100;
      const closes=d.map(x=>x.close),avg=(end,len)=>closes.slice(end-len+1,end+1).reduce((s,x)=>s+x,0)/len,end=closes.length-1;
      const sma20=avg(end,20),sma50=avg(end,50),sma20prev=avg(end-5,20),slope=(sma20-sma20prev)/sma20prev*100,spread=(sma20-sma50)/sma50*100;
      const mean=avg(end,20),variance=closes.slice(-20).reduce((s,x)=>s+(x-mean)**2,0)/20,bbWidth=4*Math.sqrt(variance)/mean*100;
      const highVol=rank>=80||latest.pct>=median*1.6;
      let regime,direction;
      if(highVol){regime='HIGH VOLATILITY';direction='CAUTION';}
      else if(adx>=22&&Math.abs(spread)>=0.12){regime='TRENDING';direction=spread>0?'UPTREND':'DOWNTREND';}
      else if(adx<18){regime='RANGING';direction='SIDEWAYS';}
      else{regime='TRANSITION';direction='MIXED';}
      return {symbol:asset[0],ticker:asset[2],name:asset[1],price:closes[end],regime,direction,adx,atrPct:latest.pct,atrRank:rank,bbWidth,slope,spread,time:d[end].time};
     }catch(e){return {symbol:asset[0],ticker:asset[2],name:asset[1],error:e.message||'Unavailable'};}
    }));
    all.push(...batch);setRows([...all]);
   }
   setDone(true);
  }catch(e){setError(e.message||'Regime scan failed.');}
  finally{setBusy(false);}
 };
 const sorted=[...rows].sort((a,b)=>a.error?1:b.error?-1:(b[sort]??0)-(a[sort]??0));
 const counts=['TRENDING','RANGING','HIGH VOLATILITY','TRANSITION'].map(name=>({name,count:rows.filter(x=>x.regime===name).length}));
 const regimeClass=v=>v==='TRENDING'?'long':v==='HIGH VOLATILITY'?'short':v==='RANGING'?'wait':'mixed';
 return <section className="panel regime-panel">
  <div className="panel-title"><div><h3>Market regime detection</h3><p>ADX trend strength · ATR volatility percentile · Bollinger bandwidth · completed candles only</p></div><span className="tiny-live">MARKET CONTEXT</span></div>
  <div className="scanner-controls"><div className="scanner-control-group"><span>TIMEFRAME</span><div className="scanner-chips">{['15m','1h','4h','1d'].map(x=><button key={x} className={tf===x?'active':''} onClick={()=>setTf(x)}>{x}</button>)}</div></div><button className="primary-btn" disabled={busy} onClick={run}><Play size={14}/>{busy?'Analysing…':'Detect market regimes'}</button></div>
  {error&&<div className="backtest-error">{error}</div>}
  {busy&&<div className="scanner-progress"><span>Analysed {rows.length} / {WATCH.length} markets</span><div><i style={{width:(rows.length/WATCH.length*100)+'%'}}/></div></div>}
  {done&&<><div className="regime-counts">{counts.map(x=><div key={x.name}><span>{x.name}</span><b>{x.count}</b></div>)}</div><div className="scanner-summary"><span>{rows.filter(x=>!x.error).length} / {rows.length} assets · Binance {market} · {tf}</span><span>Updated {new Date().toLocaleTimeString()}</span></div></>}
  {rows.length>0&&<div className="backtest-table-wrap"><table className="backtest-table regime-table"><thead><tr><th>Asset</th><th>Regime</th><th>Direction</th><th><button onClick={()=>setSort('adx')}>ADX ↕</button></th><th><button onClick={()=>setSort('atrPct')}>ATR % ↕</button></th><th>ATR rank</th><th>BB width</th><th>Price</th></tr></thead><tbody>{sorted.map(x=><tr key={x.symbol}>{x.error?<><td><b>{x.ticker}</b></td><td colSpan="7" className="negative">{x.error}</td></>:<><td><b>{x.ticker}</b><small>{x.name}</small></td><td><span className={'scanner-bias '+regimeClass(x.regime)}>{x.regime}</span></td><td>{x.direction}</td><td>{fmt(x.adx,1)}</td><td>{fmt(x.atrPct,3)}%</td><td>{fmt(x.atrRank,0)}th</td><td>{fmt(x.bbWidth,2)}%</td><td>{'$'+fmt(x.price,x.price<1?6:3)}</td></>}</tr>)}</tbody></table></div>}
  <div className="regime-guide"><b>Regime rules</b><span><strong>Trending:</strong> ADX ≥ 22 and directional moving-average spread.</span><span><strong>Ranging:</strong> ADX below 18.</span><span><strong>High volatility:</strong> ATR percentile ≥ 80 or ATR% at least 1.6× recent median.</span><span><strong>Transition:</strong> mixed conditions; wait for clearer structure.</span></div>
  <p className="backtest-assumption">12 watchlist assets · up to 219 completed candles per market. Indicators describe current conditions; regimes can change quickly. High volatility is a risk warning, not a trade signal. This module does not open trades.</p>
 </section>;
}


function MarketStructureScanner({market}) {
 const [tf,setTf]=useState('15m'),[busy,setBusy]=useState(false),[rows,setRows]=useState([]),[error,setError]=useState(''),[selected,setSelected]=useState('BTCUSDT');
 const scan=async()=>{setBusy(true);setError('');setRows([]);const base=market==='Futures'?'https://fapi.binance.com':'https://api.binance.com',ep=market==='Futures'?'/fapi/v1/klines':'/api/v3/klines',out=[];
 try{for(let n=0;n<WATCH.length;n+=4){const batch=await Promise.all(WATCH.slice(n,n+4).map(async a=>{try{
 const r=await fetch(base+ep+'?symbol='+a[0]+'&interval='+tf+'&limit=300');if(!r.ok)throw Error('Binance HTTP '+r.status);const raw=await r.json();if(raw.length<80)throw Error('Insufficient candles');
 const d=raw.slice(0,-1).map(k=>({time:+k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4]})),piv=[],rad=3;
 for(let i=rad;i<d.length-rad;i++){let h=true,l=true;for(let j=i-rad;j<=i+rad;j++)if(j!==i){if(d[j].high>=d[i].high)h=false;if(d[j].low<=d[i].low)l=false;}if(h)piv.push({type:'H',i,price:d[i].high});if(l)piv.push({type:'L',i,price:d[i].low});}
 const highs=piv.filter(x=>x.type==='H'),lows=piv.filter(x=>x.type==='L'),last=d.at(-1),ph=highs.at(-1),pl=lows.at(-1),hh=highs.slice(-3),ll=lows.slice(-3);
 const up=hh.length>1&&ll.length>1&&hh.at(-1).price>hh.at(-2).price&&ll.at(-1).price>ll.at(-2).price,down=hh.length>1&&ll.length>1&&hh.at(-1).price<hh.at(-2).price&&ll.at(-1).price<ll.at(-2).price;
 const structure=up?'BULLISH STRUCTURE':down?'BEARISH STRUCTURE':'NEUTRAL',bull=!!ph&&last.close>ph.price,bear=!!pl&&last.close<pl.price,bos=bull?'BULLISH BOS':bear?'BEARISH BOS':'—',choch=bull&&down?'BULLISH CHoCH':bear&&up?'BEARISH CHoCH':'—';
 const sweep=ph&&last.high>ph.price&&last.close<ph.price?'HIGH-SIDE SWEEP':pl&&last.low<pl.price&&last.close>pl.price?'LOW-SIDE SWEEP':'NONE';
 const near=(xs)=>xs.filter(x=>x.i>=d.length-100).sort((x,y)=>Math.abs(x.price-last.close)-Math.abs(y.price-last.close))[0]?.price??null;
 let fvg=null;for(let i=Math.max(2,d.length-80);i<d.length-1;i++){if(d[i].low>d[i-2].high)fvg={type:'BULLISH FVG',low:d[i-2].high,high:d[i].low};if(d[i].high<d[i-2].low)fvg={type:'BEARISH FVG',low:d[i].high,high:d[i-2].low};}
 let ob=null;if(bos!=='—'){for(let i=d.length-2;i>=Math.max(0,d.length-25);i--){if((bull&&d[i].close<d[i].open)||(bear&&d[i].close>d[i].open)){ob={type:bull?'BULLISH OB':'BEARISH OB',low:d[i].low,high:d[i].high};break;}}}
 return {symbol:a[0],ticker:a[2],name:a[1],price:last.close,structure,bos,choch,sweep,support:near(lows),resistance:near(highs),fvg,ob,candles:d.length,time:last.time};
 }catch(e){return {symbol:a[0],ticker:a[2],error:e.message};}}));out.push(...batch);setRows([...out]);}if(!out.some(x=>x.symbol===selected&&!x.error))setSelected(out.find(x=>!x.error)?.symbol||'BTCUSDT');
 }catch(e){setError(e.message||'Scan failed');}finally{setBusy(false);}};
 const active=rows.find(x=>x.symbol===selected)||rows.find(x=>!x.error);
 const money=v=>v==null?'—':'$'+fmt(v,v<1?6:3);
 const exportCsv=()=>{const h=['Symbol','Price','Structure','BOS','CHoCH','Sweep','Support','Resistance','FVG','OB'];const data=rows.map(x=>[x.symbol,x.price,x.structure,x.bos,x.choch,x.sweep,x.support,x.resistance,x.fvg?.type,x.ob?.type]);const blob=new Blob([h.concat(data).map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\n')],{type:'text/csv'});const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='cryptobot-structure-'+tf+'.csv';a.click();URL.revokeObjectURL(u);};
 return <section className="panel structure-panel">
 <div className="panel-title"><div><h3>Market structure & liquidity</h3><p>BOS / CHoCH · swing pivots · liquidity sweeps · FVG · order blocks</p></div><span className="tiny-live">PRICE ACTION</span></div>
 <div className="scanner-controls"><div className="scanner-control-group"><span>TIMEFRAME</span><div className="scanner-chips">{['5m','15m','1h','4h','1d'].map(x=><button key={x} className={tf===x?'active':''} onClick={()=>setTf(x)}>{x}</button>)}</div></div><button className="primary-btn" disabled={busy} onClick={scan}><Play size={14}/>{busy?'Scanning…':'Scan market structure'}</button>{rows.length>0&&<button className="secondary-btn" onClick={exportCsv}><Download size={14}/> Export CSV</button>}</div>
 {error&&<div className="backtest-error">{error}</div>}
 {busy&&<div className="scanner-progress"><span>Processed {rows.length} / {WATCH.length}</span><div><i style={{width:rows.length/WATCH.length*100+'%'}}/></div></div>}
 {rows.length>0&&<><div className="scanner-summary"><span>{rows.filter(x=>!x.error).length} assets · Binance {market} · {tf}</span><span>Completed candles only</span></div><div className="backtest-table-wrap"><table className="backtest-table structure-table"><thead><tr><th>Asset</th><th>Structure</th><th>BOS</th><th>CHoCH</th><th>Liquidity sweep</th><th>Price</th></tr></thead><tbody>{rows.map(x=><tr key={x.symbol} onClick={()=>!x.error&&setSelected(x.symbol)} className={selected===x.symbol?'structure-selected':''}><td><b>{x.ticker}</b></td>{x.error?<td colSpan="5" className="negative">{x.error}</td>:<><td>{x.structure}</td><td>{x.bos}</td><td>{x.choch}</td><td>{x.sweep}</td><td>{money(x.price)}</td></>}</tr>)}</tbody></table></div></>}
 {active&&!active.error&&<div className="structure-detail"><div className="structure-detail-head"><div><b>{active.name} / USDT</b><small>{active.ticker} · {tf} · {active.candles} completed candles</small></div><b>{money(active.price)}</b></div><div className="structure-levels"><div><span>NEAREST SUPPORT</span><b>{money(active.support)}</b></div><div><span>NEAREST RESISTANCE</span><b>{money(active.resistance)}</b></div><div><span>LATEST FVG</span><b>{active.fvg?.type||'None found'}</b><small>{active.fvg?money(active.fvg.low)+' – '+money(active.fvg.high):'No recent gap'}</small></div><div><span>ORDER BLOCK HEURISTIC</span><b>{active.ob?.type||'No recent BOS'}</b><small>{active.ob?money(active.ob.low)+' – '+money(active.ob.high):'No qualifying candle'}</small></div></div></div>}
 <div className="regime-guide"><b>How the scan works</b><span><strong>BOS:</strong> completed candle closes beyond a confirmed swing pivot.</span><span><strong>CHoCH:</strong> break against recent pivot trend; not proof of reversal.</span><span><strong>Liquidity sweep:</strong> wick crosses a prior swing then closes back inside.</span><span><strong>FVG:</strong> three-candle gap. Order block is a simplified last-opposite-candle heuristic before a break.</span><span>Three candles on the right are required to confirm each swing pivot.</span></div>
 <p className="backtest-assumption">Rules-based approximation, not actual order-flow or resting-order data. No liquidation clusters or institutional positions are read. Levels may fail quickly; no trades are placed.</p>
 </section>;
}


function PublicDerivativesPanel({symbol}) {
  const [data,setData]=useState({bids:null,asks:null,globalRatio:null,topRatio:null,takerRatio:null,oiChange:null,updated:null});
  const [liquidations,setLiquidations]=useState([]);
  const [status,setStatus]=useState('CONNECTING');
  const [error,setError]=useState('');
  useEffect(()=>{
    let live=true,timer=null,ws=null,retry=null,delay=1500;
    const load=async()=>{
      const base='https://fapi.binance.com';
      const urls=[
        base+'/fapi/v1/depth?symbol='+symbol+'&limit=20',
        base+'/futures/data/globalLongShortAccountRatio?symbol='+symbol+'&period=5m&limit=2',
        base+'/futures/data/topLongShortPositionRatio?symbol='+symbol+'&period=5m&limit=1',
        base+'/futures/data/takerlongshortRatio?symbol='+symbol+'&period=5m&limit=1',
        base+'/futures/data/openInterestHist?symbol='+symbol+'&period=5m&limit=2'
      ];
      const results=await Promise.allSettled(urls.map(url=>fetch(url).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})));
      if(!live)return;
      const next={};
      if(results[0].status==='fulfilled'){const book=results[0].value;next.bids=book.bids.reduce((s,x)=>s+Number(x[0])*Number(x[1]),0);next.asks=book.asks.reduce((s,x)=>s+Number(x[0])*Number(x[1]),0);}
      if(results[1].status==='fulfilled'&&results[1].value.length)next.globalRatio=Number(results[1].value.at(-1).longShortRatio);
      if(results[2].status==='fulfilled'&&results[2].value.length)next.topRatio=Number(results[2].value[0].longShortRatio);
      if(results[3].status==='fulfilled'&&results[3].value.length)next.takerRatio=Number(results[3].value[0].buySellRatio);
      if(results[4].status==='fulfilled'&&results[4].value.length>1){const a=Number(results[4].value.at(-2).sumOpenInterestValue),b=Number(results[4].value.at(-1).sumOpenInterestValue);if(a>0)next.oiChange=(b-a)/a*100;}
      setData(prev=>({...prev,...next,updated:new Date()}));
      const failed=results.filter(x=>x.status==='rejected').length;
      setStatus(failed===0?'LIVE':failed===5?'UNAVAILABLE':'PARTIAL');
      setError(failed===5?'Binance public derivatives endpoints are temporarily unavailable.':failed?failed+' data endpoint(s) unavailable; remaining metrics are still updating.':'');
    };
    const connect=()=>{
      if(!live)return;
      try{
        ws=new WebSocket('wss://fstream.binance.com/ws/'+symbol.toLowerCase()+'@forceOrder');
        ws.onopen=()=>{delay=1500;};
        ws.onmessage=e=>{try{const event=JSON.parse(e.data)?.o;if(!event||!live)return;setLiquidations(prev=>[{id:Date.now()+Math.random(),side:event.S==='SELL'?'LONG LIQUIDATED':'SHORT LIQUIDATED',price:Number(event.ap),qty:Number(event.z),time:new Date(Number(event.T||event.E||Date.now()))},...prev].slice(0,10));}catch{}};
        ws.onerror=()=>{try{ws.close();}catch{}};
        ws.onclose=()=>{if(!live)return;retry=window.setTimeout(connect,delay);delay=Math.min(delay*2,15000);};
      }catch{retry=window.setTimeout(connect,delay);}
    };
    load();timer=window.setInterval(load,15000);connect();
    return()=>{live=false;if(timer)clearInterval(timer);if(retry)clearTimeout(retry);try{ws?.close();}catch{}};
  },[symbol]);
  const money=n=>Number.isFinite(n)?(n>=1e9?(n/1e9).toFixed(2)+'B':n>=1e6?(n/1e6).toFixed(2)+'M':n.toLocaleString('en-US',{maximumFractionDigits:2})):'—';
  const ratioText=n=>Number.isFinite(n)?n.toFixed(3):'—';
  const depthTotal=(data.bids||0)+(data.asks||0),bidPct=depthTotal?data.bids/depthTotal*100:0;
  return <section className="panel public-derivatives-panel">
    <div className="panel-title"><div><h3>Live derivatives & order flow</h3><p>{symbol.replace('USDT','')}/USDT · Binance Futures public endpoints</p></div><span className={'tiny-live '+(status==='LIVE'?'':'data-status-warn')}>{status}</span></div>
    <div className="public-data-grid">
      <div className="public-data-card"><span>ORDER BOOK BID VALUE</span><b className="positive">{data.bids!==null?String.fromCharCode(36)+money(data.bids):'—'}</b><small>Top 20 bid levels</small></div>
      <div className="public-data-card"><span>ORDER BOOK ASK VALUE</span><b className="negative">{data.asks!==null?String.fromCharCode(36)+money(data.asks):'—'}</b><small>Top 20 ask levels</small></div>
      <div className="public-data-card"><span>GLOBAL LONG / SHORT</span><b>{ratioText(data.globalRatio)}</b><small>Accounts · 5 minute</small></div>
      <div className="public-data-card"><span>TOP TRADER POSITION RATIO</span><b>{ratioText(data.topRatio)}</b><small>Positions · 5 minute</small></div>
      <div className="public-data-card"><span>TAKER BUY / SELL RATIO</span><b>{ratioText(data.takerRatio)}</b><small>Above 1 = more taker buy volume</small></div>
      <div className="public-data-card"><span>OPEN INTEREST CHANGE</span><b className={data.oiChange===null?'':data.oiChange>=0?'positive':'negative'}>{data.oiChange===null?'—':(data.oiChange>=0?'+':'')+data.oiChange.toFixed(3)+'%'}</b><small>Latest 5m interval vs previous</small></div>
    </div>
    <div className="depth-balance"><div><span>ORDER BOOK DEPTH BALANCE</span><b>{depthTotal?bidPct.toFixed(1)+'% bids / '+(100-bidPct).toFixed(1)+'% asks':'Waiting for depth data'}</b></div><div className="depth-track"><i style={{width:bidPct+'%'}}/></div></div>
    {error&&<p className="public-data-error">{error}</p>}
    <div className="liquidation-head"><div><b>Recent liquidation feed</b><small>Symbol-specific Binance force-order stream · Live events only</small></div><span>{liquidations.length} events</span></div>
    {liquidations.length===0?<div className="liquidation-empty">Waiting for liquidation events. No event does not mean there are no liquidations across the wider market.</div>:<div className="liquidation-list">{liquidations.map(x=><div className="liquidation-row" key={x.id}><b className={x.side.startsWith('LONG')?'negative':'positive'}>{x.side}</b><span>{x.qty.toLocaleString('en-US',{maximumFractionDigits:4})} {symbol.replace('USDT','')}</span><span>{String.fromCharCode(36)}{x.price.toLocaleString('en-US',{maximumFractionDigits:5})}</span><small>{x.time.toLocaleTimeString()}</small></div>)}</div>}
    <p className="public-data-foot">Updated: {data.updated?data.updated.toLocaleTimeString():'Waiting…'} · Public endpoints can be delayed, rate-limited or unavailable. Order book is a top-20 snapshot, not full market liquidity. Liquidation feed is not a complete market-wide liquidation history.</p>
  </section>;
}

function App() {
  const [symbol,setSymbol] = useState('BTCUSDT');
  const [interval,setTimeframe] = useState('15m');
  const [market,setMarket] = useState('Futures');
  const [theme,setTheme] = useState('dark');
  const [prices,setPrices] = useState({});
  const [candles,setCandles] = useState([]);
  const [loading,setLoading] = useState(true);
  const [updated,setUpdated] = useState(null);
  const [query,setQuery] = useState('');
  const [tab,setTab] = useState('Overview');
  const [mobileNav,setMobileNav] = useState(false);
  const [watchOnly,setWatchOnly] = useState(false);
  const [demoBalance,setDemoBalance] = useState(()=>{try{return Number(localStorage.getItem('cryptobot.demoBalance'))||10000;}catch{return 10000;}});
  const [paperTrades,setPaperTrades] = useState(()=>{try{return JSON.parse(localStorage.getItem('cryptobot.paperTrades')||'[]');}catch{return [];}});
  const closingIds=useRef(new Set());
  const [notice,setNotice] = useState('');

  const active = WATCH.find(c=>c[0]===symbol) || WATCH[0];
  const ticker = prices[symbol];
  const price = Number(ticker?.lastPrice || 0);
  const change = Number(ticker?.priceChangePercent || 0);
  const filtered = WATCH.filter(c => (c[0]+c[1]+c[2]).toLowerCase().includes(query.toLowerCase()));
  const apiBase = market==='Futures'?'https://fapi.binance.com':'https://api.binance.com';
  const candleUrl = useMemo(()=>`${apiBase}${market==='Futures'?'/fapi/v1/klines':'/api/v3/klines'}?symbol=${symbol}&interval=${interval}&limit=160`,[symbol,interval,market]);
  const [futuresMetrics,setFuturesMetrics] = useState({openInterest:null,fundingRate:null,updated:null});
  const [feedStatus,setFeedStatus] = useState('CONNECTING');
  const [feedMeta,setFeedMeta] = useState({});
  const [feedClock,setFeedClock] = useState(Date.now());
  useEffect(()=>{const id=window.setInterval(()=>setFeedClock(Date.now()),5000);return ()=>window.clearInterval(id);},[]);

  // Push-based 24h ticker feed: Binance WebSocket, with REST snapshot/fallback.
  useEffect(()=>{
    let live=true,ws=null,reconnect=null,fallback=null,snapshotTimer=null,delay=1000;
    const endpoint=market==='Futures'?'https://fapi.binance.com/fapi/v1/ticker/24hr':'https://api.binance.com/api/v3/ticker/24hr';
    const snapshot=async()=>{try{const r=await fetch(endpoint);if(!r.ok)throw new Error();const rows=await r.json();if(!live)return;setPrices(prev=>{const next={...prev};rows.forEach(x=>{if(WATCH.some(w=>w[0]===x.symbol)){const meta=prev[x.symbol]||{};const wsFresh=meta.wsAt&&Date.now()-meta.wsAt<=15000;next[x.symbol]={...x,lastPrice:wsFresh?(prev[x.symbol]?.lastPrice||x.lastPrice):x.lastPrice};}});return next;});setUpdated(new Date());setFeedMeta(prev=>{const next={...prev};rows.forEach(x=>{if(WATCH.some(w=>w[0]===x.symbol)){const old=prev[x.symbol]||{},restPrice=Number(x.lastPrice),wsPrice=Number(prices[x.symbol]?.lastPrice||0),divergence=wsPrice>0&&restPrice>0?Math.abs(wsPrice-restPrice)/restPrice*100:null;next[x.symbol]={...old,priceAt:old.wsAt&&Date.now()-old.wsAt<=15000?old.wsAt:Date.now(),priceSource:old.wsAt&&Date.now()-old.wsAt<=15000?'WEBSOCKET':'REST',restAt:Date.now(),restPrice,divergencePct:divergence};}});return next;});}catch{if(live)setNotice('Live feed reconnecting; using the latest available market snapshot.');}};
    const startFallback=()=>{if(fallback===null){setFeedStatus('REST FALLBACK');snapshot();fallback=window.setInterval(snapshot,5000);}};
    const connect=()=>{if(!live)return;setFeedStatus('CONNECTING');const host=market==='Futures'?'wss://fstream.binance.com/stream?streams=':'wss://stream.binance.com:9443/stream?streams=';
      const streams=WATCH.map(w=>w[0].toLowerCase()+'@trade').join('/');
      const url=host+streams;try{ws=new WebSocket(url);}catch{startFallback();return;}
      ws.onopen=()=>{delay=1000;if(fallback!==null){clearInterval(fallback);fallback=null;}setFeedStatus('LIVE');};
      ws.onmessage=e=>{try{const x=JSON.parse(e.data).data;if(!x?.s||!x?.p)return;setPrices(prev=>({...prev,[x.s]:{...(prev[x.s]||{}),symbol:x.s,lastPrice:x.p}}));setFeedMeta(prev=>{const old=prev[x.s]||{},restPrice=Number(old.restPrice||0),wsPrice=Number(x.p);return {...prev,[x.s]:{...old,priceAt:Date.now(),wsAt:Date.now(),wsExchangeAt:Number(x.T||x.E||0),priceSource:'WEBSOCKET',divergencePct:restPrice>0?Math.abs(wsPrice-restPrice)/restPrice*100:null}};});setUpdated(new Date());setFeedStatus('LIVE');}catch{}};
      ws.onerror=()=>{try{ws.close();}catch{}};
      ws.onclose=()=>{if(!live)return;setFeedStatus('RECONNECTING');startFallback();reconnect=window.setTimeout(connect,delay);delay=Math.min(delay*2,15000);};
    };
    snapshot();snapshotTimer=window.setInterval(snapshot,30000);connect();return()=>{live=false;if(reconnect)clearTimeout(reconnect);if(fallback!==null)clearInterval(fallback);if(snapshotTimer!==null)clearInterval(snapshotTimer);try{ws?.close();}catch{}};
  },[market]);
  // Load candle history once, then stream the active candle in real time.
  useEffect(()=>{
    let live=true,ws=null,retryTimer=null,fallbackTimer=null,delay=1000;
    const history=async()=>{try{const r=await fetch(candleUrl);if(!r.ok)throw new Error();const rows=await r.json();if(live){setCandles(rows.filter(k=>Number(k[6])>Number(k[0])).map(k=>({time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],closeTime:Number(k[6]),isClosed:Number(k[6])<Date.now()})));setFeedMeta(prev=>({...prev,[symbol]:{...(prev[symbol]||{}),candleAt:Date.now(),candleSource:'REST'}}));setLoading(false);}}catch{if(live){setLoading(false);setNotice('Could not load Binance candle data. Retrying.');}}};
    const connect=()=>{if(!live)return;const host=market==='Futures'?'wss://fstream.binance.com/ws/':'wss://stream.binance.com:9443/ws/';try{ws=new WebSocket(host+symbol.toLowerCase()+'@kline_'+interval);}catch{fallback();return;}
      ws.onopen=()=>{delay=1000;if(fallbackTimer){clearInterval(fallbackTimer);fallbackTimer=null;}};
      ws.onmessage=e=>{try{const k=JSON.parse(e.data).k;if(!k||!live)return;const c={time:Math.floor(k.t/1000),open:+k.o,high:+k.h,low:+k.l,close:+k.c,closeTime:Number(k.T),isClosed:Boolean(k.x),exchangeAt:Number(k.T)};setFeedMeta(prev=>({...prev,[symbol]:{...(prev[symbol]||{}),candleAt:Date.now(),candleSource:'WEBSOCKET',candleExchangeAt:Number(k.T)}}));setCandles(prev=>{if(!prev.length)return[c];const last=prev[prev.length-1];return last.time===c.time?[...prev.slice(0,-1),c]:[...prev,c].slice(-160);});}catch{}};
      ws.onerror=()=>{try{ws.close();}catch{}};
      ws.onclose=()=>{if(!live)return;fallback();retryTimer=window.setTimeout(connect,delay);delay=Math.min(delay*2,15000);};
    };
    const fallback=()=>{if(fallbackTimer===null)fallbackTimer=window.setInterval(history,10000);};
    setLoading(true);history();connect();return()=>{live=false;if(retryTimer)clearTimeout(retryTimer);if(fallbackTimer)clearInterval(fallbackTimer);try{ws?.close();}catch{}};
  },[candleUrl,market,symbol,interval]);

  useEffect(()=>{
    let live=true;
    if(market!=='Futures'){setFuturesMetrics({openInterest:null,fundingRate:null,updated:null});return ()=>{live=false;};}
    Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`).then(r=>{if(!r.ok)throw new Error('Open interest unavailable');return r.json();}),
      fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`).then(r=>{if(!r.ok)throw new Error('Funding rate unavailable');return r.json();})
    ]).then(([oi,funding])=>{if(live)setFuturesMetrics({openInterest:oi.openInterest,fundingRate:funding?.[0]?.fundingRate??null,updated:new Date()});})
      .catch(()=>{if(live)setFuturesMetrics({openInterest:null,fundingRate:null,updated:new Date()});});
    return ()=>{live=false;};
  },[market,symbol]);

  const activeFeed = feedMeta[symbol] || {};
  const priceAge = activeFeed.priceAt ? feedClock-activeFeed.priceAt : Infinity;
  const candleAge = activeFeed.candleAt ? feedClock-activeFeed.candleAt : Infinity;
  const validClosed=candles.filter(c=>c.isClosed&&[c.open,c.high,c.low,c.close].every(v=>Number.isFinite(v)&&v>0));
  const expectedCandleMs={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000}[interval];
  const candleGaps=validClosed.slice(1).filter((c,i)=>c.time-validClosed[i].time!==expectedCandleMs).length;
  const restReferenceFresh=Boolean(activeFeed.restAt&&feedClock-activeFeed.restAt<=60000&&Number(activeFeed.restPrice)>0);
  const reconciliationOk=restReferenceFresh&&Number.isFinite(activeFeed.divergencePct)&&activeFeed.divergencePct<=0.5;
  const signalHealth = { priceFresh:priceAge<=30000, candleFresh:candleAge<=30000, hasTicker:Number.isFinite(Number(prices[symbol]?.lastPrice))&&Number(prices[symbol]?.lastPrice)>0, hasClosedCandles:validClosed.length>=50, reconciliationOk, candleGaps };
  const analysis = useMemo(()=>{
    const closed=candles.filter(c=>c.isClosed&&[c.open,c.high,c.low,c.close].every(v=>Number.isFinite(v)&&v>0));
    const valid=signalHealth.priceFresh&&signalHealth.candleFresh&&signalHealth.hasTicker&&signalHealth.reconciliationOk&&signalHealth.candleGaps===0&&closed.length>=50;
    if(!valid)return {bias:'WAIT',score:0,atr:null,stop:null,target:null,positionSize:0,riskUsd:demoBalance*0.01,reason:'Signal blocked: stale data, REST/stream mismatch, missing candles, or fewer than 50 completed candles.'};
    const data=closed.slice(-160),closes=data.map(c=>c.close),avg=n=>closes.slice(-n).reduce((a,b)=>a+b,0)/n;
    const e20=avg(20),e50=avg(50),last=closes.at(-1),prev=closes.at(-2),momentum=(last-prev)/prev*100;
    let score=50;if(last>e20)score+=12;else score-=12;if(e20>e50)score+=15;else score-=15;if(momentum>0.08)score+=8;else if(momentum<-.08)score-=8;
    const bias=score>=65?'LONG':score<=35?'SHORT':'WAIT';
    const ranges=data.slice(-15).map((c,i)=>{const p=data[data.length-16+i]?.close??c.close;return Math.max(c.high-c.low,Math.abs(c.high-p),Math.abs(c.low-p));});
    const atr=ranges.reduce((a,b)=>a+b,0)/ranges.length,stop=bias==='LONG'?last-atr*1.5:bias==='SHORT'?last+atr*1.5:null,target=bias==='LONG'?last+atr*3:bias==='SHORT'?last-atr*3:null;
    const riskUsd=demoBalance*0.01,positionSize=stop?riskUsd/Math.abs(last-stop):0;
    return {bias,score:Math.max(0,Math.min(100,score)),e20,e50,momentum,atr,stop,target,positionSize,riskUsd,reason:'Closed-candle check: price is '+(last>e20?'above':'below')+' the 20-period average; short-term trend is '+(e20>e50?'positive':'negative')+' versus the 50-period average.'};
  },[candles,demoBalance,signalHealth.priceFresh,signalHealth.candleFresh,signalHealth.hasTicker,signalHealth.hasClosedCandles,signalHealth.reconciliationOk,signalHealth.candleGaps]);
  const navItems=[['Overview',Activity],['Market Scanner',Compass],['Spot Analysis',CandlestickChart],['Futures Analysis',Layers3],['Paper Trading',Wallet],['Trade Journal',BookOpen],['Backtesting',BarChart3],['Strategy Lab',SlidersHorizontal],['Multi-Asset Scanner',Globe2],['Market Regime',Activity],['Market Structure',Layers3],['News & Events',Newspaper]];
  const showNotice = msg => {setNotice(msg);setTimeout(()=>setNotice(''),4200);};
  useEffect(()=>{try{localStorage.setItem('cryptobot.demoBalance',String(demoBalance));localStorage.setItem('cryptobot.paperTrades',JSON.stringify(paperTrades));}catch{showNotice('Browser storage unavailable; paper trade history may not persist.');}},[demoBalance,paperTrades]);
  const closeTrade=(id,exitPrice,reason='MANUAL')=>{
    const t=paperTrades.find(x=>x.id===id);if(!t||t.status!=='OPEN')return;
    const gross=(exitPrice-t.entry)*t.quantity*(t.side==='LONG'?1:-1),exitFee=exitPrice*t.quantity*0.0005;
    const netPnl=gross-(t.entryFee||0)-exitFee;
    setDemoBalance(b=>b+(t.margin||t.entry*t.quantity/(t.leverage||1))+gross-exitFee);
    setPaperTrades(rows=>rows.map(x=>x.id===id?{...x,status:'CLOSED',exit:exitPrice,pnl:netPnl,exitReason:reason}:x));
    closingIds.current.delete(id);
  };
  const addPaperTrade=()=>{
    if(!price){showNotice('Market price is not available yet.');return;}
    if(analysis.bias==='WAIT'||!analysis.atr){showNotice('No trade opened: setup is WAIT or ATR data is unavailable.');return;}
    if(paperTrades.some(t=>t.status==='OPEN'&&t.market!==market)){showNotice('Close open paper positions in the other market before opening a new one.');return;}
    if(market==='Spot'&&analysis.bias==='SHORT'){showNotice('Spot mode cannot open short positions. Switch to Futures or wait for a LONG setup.');return;}
    const side=analysis.bias,leverage=market==='Futures'?3:1;
    const stop=side==='LONG'?price-analysis.atr*1.5:price+analysis.atr*1.5;
    const target=side==='LONG'?price+analysis.atr*3:price-analysis.atr*3;
    const riskQuantity=analysis.riskUsd/Math.abs(price-stop),affordableQuantity=demoBalance/(price/leverage+price*0.0005);
    const quantity=Math.min(riskQuantity,affordableQuantity);
    if(!Number.isFinite(quantity)||quantity<=0){showNotice('Insufficient demo balance for this position.');return;}
    const margin=price*quantity/leverage,entryFee=price*quantity*0.0005;
    if(margin+entryFee>demoBalance){showNotice('Insufficient demo balance.');return;}
    const trade={id:Date.now(),symbol,side,market,entry:price,quantity,stop,target,leverage,margin,entryFee,status:'OPEN',time:new Date().toLocaleString()};
    setPaperTrades(rows=>[trade,...rows]);setDemoBalance(b=>b-margin-entryFee);
    showNotice('Paper '+side+' opened with '+leverage+'x leverage and a 1% risk cap.');
  };
  useEffect(()=>{
    paperTrades.filter(t=>t.status==='OPEN').forEach(t=>{
      const live=Number(prices[t.symbol]?.lastPrice||0);if(!live||closingIds.current.has(t.id))return;
      const stopHit=t.side==='LONG'?live<=t.stop:live>=t.stop,targetHit=t.side==='LONG'?live>=t.target:live<=t.target;
      if(stopHit||targetHit){closingIds.current.add(t.id);closeTrade(t.id,stopHit?t.stop:t.target,stopHit?'STOP LOSS':'TAKE PROFIT');}
    });
  },[prices,paperTrades]);

  const unrealizedPnl=paperTrades.filter(t=>t.status==='OPEN').reduce((sum,t)=>{const live=Number(prices[t.symbol]?.lastPrice||t.entry);return sum+(live-t.entry)*t.quantity*(t.side==='LONG'?1:-1);},0);
  return <div className={`app ${theme}`}>
    <aside className={`sidebar ${mobileNav?'open':''}`}>
      <div className="brand"><div className="brand-mark"><Activity size={19}/></div><div><b>Crypto<span>Bot</span></b><small>TRADING TERMINAL</small></div><button className="icon-btn mobile-close" onClick={()=>setMobileNav(false)}><X size={17}/></button></div>
      <div className="workspace"><div className="workspace-icon"><Command size={16}/></div><div><b>Market Desk</b><small>Personal workspace</small></div><ChevronDown size={14}/></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav>{navItems.map(([name,Icon])=><button key={name} className={`nav-item ${tab===name?'selected':''}`} onClick={()=>{setTab(name);setMobileNav(false);}}><Icon size={17}/><span>{name}</span>{name==='Paper Trading'&&<i>{paperTrades.filter(t=>t.status==='OPEN').length}</i>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="status-line"><span className="pulse"/> PUBLIC DATA FEED</div><div className="sidebar-note"><ShieldCheck size={15}/><span>No exchange keys connected<br/>Manual execution only</span></div><div className="profile"><div className="avatar">M</div><div><b>Mishad</b><small>Free workspace</small></div><Settings2 size={16}/></div></div>
    </aside>
    {mobileNav&&<div className="scrim" onClick={()=>setMobileNav(false)}/>}
    <main className="main">
      <header className="topbar"><div className="top-left"><button className="icon-btn mobile-menu" onClick={()=>setMobileNav(true)}><Menu size={19}/></button><span className="crumb">Workspace</span><span className="slash">/</span><b>{tab}</b></div><div className="top-actions"><div className="feed"><span className={`pulse ${feedStatus==='LIVE'?'':'feed-warn'}`}/> <span>{feedStatus}</span></div><button className="icon-btn" onClick={()=>setTheme(t=>t==='dark'?'light':'dark')} title="Toggle theme">{theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}</button><button className="icon-btn" onClick={()=>showNotice('Notifications are not configured yet.')}><Bell size={17}/></button><div className="top-avatar">M</div></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow">WEDNESDAY, NOVEMBER 11, 2026 <span>·</span> MARKET OVERVIEW</div><h1>{tab==='Overview'?'Market overview':tab}</h1><p>Read the market. Respect the risk. Trade with a plan.</p></div><div className="heading-actions"><button className="secondary-btn" onClick={()=>{setLoading(true);fetch(candleUrl).then(r=>r.json()).then(rows=>setCandles(rows.filter(k=>Number(k[6])>Number(k[0])).map(k=>({time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],closeTime:Number(k[6]),isClosed:Number(k[6])<Date.now()})))).finally(()=>setLoading(false));}}><RefreshCw size={15}/> Refresh</button><button className="primary-btn" onClick={()=>setTab('Paper Trading')}><Plus size={16}/> New paper trade</button></div></div>
        {notice&&<div className="notice"><CircleHelp size={15}/>{notice}<button onClick={()=>setNotice('')}><X size={14}/></button></div>}
        <section className="data-integrity-panel">
          <div className="integrity-heading"><div><b>DATA INTEGRITY</b><small>Signal gate · active market / timeframe</small></div><span className={signalHealth.priceFresh&&signalHealth.candleFresh&&signalHealth.hasTicker&&signalHealth.hasClosedCandles?"integrity-ok":"integrity-warn"}>{signalHealth.priceFresh&&signalHealth.candleFresh&&signalHealth.hasTicker&&signalHealth.hasClosedCandles?"DATA VALID":"SIGNAL BLOCKED"}</span></div>
          <div className="integrity-grid">
            <div><span>PRICE FEED</span><b>{signalHealth.hasTicker?(signalHealth.priceFresh?"FRESH":"STALE"):"MISSING"}</b><small>{activeFeed.priceSource||"No source"} · {Number.isFinite(priceAge)?Math.max(0,Math.round(priceAge/1000))+"s ago":"—"}</small></div>
            <div><span>CANDLE FEED</span><b>{signalHealth.hasClosedCandles?(signalHealth.candleFresh?"FRESH":"STALE"):"INSUFFICIENT"}</b><small>{activeFeed.candleSource||"No source"} · {Number.isFinite(candleAge)?Math.max(0,Math.round(candleAge/1000))+"s ago":"—"}</small></div>
            <div><span>REST / STREAM DELTA</span><b>{signalHealth.reconciliationOk? "MATCHED":"CHECK"}</b><small>{Number.isFinite(activeFeed.divergencePct)?fmt(activeFeed.divergencePct,4)+"% difference":"Awaiting REST reference"} · max 0.50%</small></div>
            <div><span>CANDLE SEQUENCE</span><b>{signalHealth.candleGaps===0?"CONTIGUOUS":"GAP DETECTED"}</b><small>{signalHealth.candleGaps} missing interval(s)</small></div>
            <div><span>COMPLETED CANDLES</span><b>{candles.filter(c=>c.isClosed).length}</b><small>Open candle excluded from signal</small></div>
            <div><span>DECISION</span><b>{analysis.bias==="WAIT"?"NO TRADE":analysis.bias}</b><small>30s freshness limit</small></div>
          </div><p>Age is measured from browser receipt time. This check cannot guarantee zero exchange/network latency.</p>
        </section>
        <section className="market-strip">
          <div className="market-stat"><span>BTC / USDT</span><b>{prices.BTCUSDT?'$'+fmt(prices.BTCUSDT.lastPrice):'Loading…'}</b><em className={Number(prices.BTCUSDT?.priceChangePercent)>=0?'positive':'negative'}>{prices.BTCUSDT?fmt(prices.BTCUSDT.priceChangePercent)+'%':'—'}</em></div>
          <div className="market-stat"><span>ETH / USDT</span><b>{prices.ETHUSDT?'$'+fmt(prices.ETHUSDT.lastPrice):'Loading…'}</b><em className={Number(prices.ETHUSDT?.priceChangePercent)>=0?'positive':'negative'}>{prices.ETHUSDT?fmt(prices.ETHUSDT.priceChangePercent)+'%':'—'}</em></div>
          <div className="market-stat"><span>BNB / USDT</span><b>{prices.BNBUSDT?'$'+fmt(prices.BNBUSDT.lastPrice):'Loading…'}</b><em className={Number(prices.BNBUSDT?.priceChangePercent)>=0?'positive':'negative'}>{prices.BNBUSDT?fmt(prices.BNBUSDT.priceChangePercent)+'%':'—'}</em></div>
          <div className="market-stat"><span>SOL / USDT</span><b>{prices.SOLUSDT?'$'+fmt(prices.SOLUSDT.lastPrice):'Loading…'}</b><em className={Number(prices.SOLUSDT?.priceChangePercent)>=0?'positive':'negative'}>{prices.SOLUSDT?fmt(prices.SOLUSDT.priceChangePercent)+'%':'—'}</em></div>
          <div className="market-stat market-update"><span>DATA UPDATED</span><b>{updated?updated.toLocaleTimeString():'Connecting…'}</b><small><span className={`pulse ${feedStatus==='LIVE'?'':'feed-warn'}`}/> Binance {feedStatus==='LIVE'?'WebSocket':'REST fallback'}</small></div>
        </section>
        <div className="section-row"><div><h2>Market workspace</h2><p>Live {market.toLowerCase()} prices and multi-timeframe chart analysis</p></div><div className="market-actions"><button className="sui-focus-btn" onClick={()=>setSymbol('SUIUSDT')}>SUI / USDT <span>FOCUS</span></button><div className="market-toggle"><button className={market==='Spot'?'active':''} onClick={()=>{if(paperTrades.some(t=>t.status==='OPEN'&&t.market!=='Spot')){showNotice('Close open Futures paper positions before switching to Spot.');return;}setMarket('Spot');}}>Spot</button><button className={market==='Futures'?'active':''} onClick={()=>{if(paperTrades.some(t=>t.status==='OPEN'&&t.market!=='Futures')){showNotice('Close open Spot paper positions before switching to Futures.');return;}setMarket('Futures');}}>Futures</button></div></div></div>
        <section className="workspace-grid">
          <div className="panel chart-panel">
            <div className="panel-head"><div className="asset-title"><div className="coin-icon">{active[2].slice(0,1)}</div><div><b>{active[1]} <span>{active[2]}/USDT</span></b><small>Binance · {market} market</small></div><ChevronDown size={14}/></div><div className="chart-tools">{intervals.map(i=><button key={i} className={interval===i?'chosen':''} onClick={()=>setTimeframe(i)}>{i}</button>)}<button className="tool-icon" onClick={()=>showNotice('Chart indicators are coming in the next build.')}><SlidersHorizontal size={15}/></button></div></div>
            <div className="price-line"><div><strong>{price?'$'+fmt(price,price<1?5:2):'—'}</strong><span className={change>=0?'positive':'negative'}>{price?(change>=0?'+':'')+fmt(change)+'%':'Waiting for feed'} <small>24h</small></span></div><div className="range"><span>24H HIGH</span><b>{ticker?'$'+fmt(ticker.highPrice):'—'}</b><span>24H LOW</span><b>{ticker?'$'+fmt(ticker.lowPrice):'—'}</b></div></div>
            <ChartPanel symbol={symbol} interval={interval} candles={candles} loading={loading} market={market}/>
            <div className="chart-foot"><span><span className="legend-dot"/> Candlesticks</span><span>Timeframe: {interval}</span><span>Source: Binance public API</span></div>
          </div>
          <div className="right-stack">
            <div className="panel signal-panel"><div className="panel-title"><div><h3>Setup assessment</h3><p>Closed-candle rules · Data-gated</p></div><span className="tiny-live">{analysis.bias==="WAIT"?"BLOCKED":"CHECKED"}</span></div><div className={`signal-badge ${analysis.bias.toLowerCase()}`}>{analysis.bias==='LONG'?<TrendingUp size={19}/>:analysis.bias==='SHORT'?<TrendingDown size={19}/>:<Crosshair size={19}/>}<b>{analysis.bias}</b></div><div className="score-row"><span>Directional score</span><b>{analysis.score}/100</b></div><div className="score-track"><i style={{width:analysis.score+'%'}}/></div><p className="analysis-reason">{analysis.reason}</p><div className="signal-warning"><ShieldCheck size={15}/><span>Signal engine is preliminary. No backtested edge or verified win rate is claimed.</span></div><button className="outline-btn full" onClick={()=>setTab('Futures Analysis')}>View analysis details <ArrowUpRight size={15}/></button></div>
            <div className="panel metrics-panel"><div className="panel-title"><div><h3>Market metrics</h3><p>{active[2]} · 24 hour</p></div><BarChart3 size={17}/></div><div className="metric-row"><span>24h Volume (USDT)</span><b>{ticker?compact(+ticker.quoteVolume):'—'}</b></div><div className="metric-row"><span>24h High</span><b className="positive">{ticker?'$'+fmt(ticker.highPrice):'—'}</b></div><div className="metric-row"><span>24h Low</span><b className="negative">{ticker?'$'+fmt(ticker.lowPrice):'—'}</b></div><div className="metric-row"><span>24h Trades</span><b>{ticker?compact(+ticker.count):'—'}</b></div><div className="metric-row"><span>Market source</span><b className="source-label">Binance {market}</b></div>{market==='Futures'&&<><div className="metric-row"><span>Open interest</span><b>{futuresMetrics.openInterest?compact(+futuresMetrics.openInterest):'—'}</b></div><div className="metric-row"><span>Funding rate</span><b className={Number(futuresMetrics.fundingRate)>=0?'positive':'negative'}>{futuresMetrics.fundingRate!==null?fmt(Number(futuresMetrics.fundingRate)*100,4)+'%':'—'}</b></div></>}</div>
          </div>
        </section>
        {tab==='Backtesting'&&<BacktestPanel symbol={symbol} market={market} defaultInterval={interval}/>}
        {tab==='Strategy Lab'&&<StrategyOptimizer symbol={symbol} market={market}/>}
        {tab==='Multi-Asset Scanner'&&<MultiAssetScanner market={market}/>}
        {tab==='Market Regime'&&<MarketRegimeScanner market={market}/>}
        {tab==='Market Structure'&&<MarketStructureScanner market={market}/ >}
        {tab==='Futures Analysis'&&<PublicDerivativesPanel symbol={symbol}/>}
        {tab==='Futures Analysis'&&(
          <section className="panel risk-panel">
            <div className="panel-title">
              <div><h3>Futures risk plan</h3><p>{active[2]}/USDT · {interval} timeframe · ATR-based levels</p></div>
              <ShieldCheck size={18}/>
            </div>
            <div className="risk-grid">
              <div><span>SETUP</span><b className={analysis.bias==='LONG'?'positive':analysis.bias==='SHORT'?'negative':''}>{analysis.bias}</b></div>
              <div><span>ENTRY REFERENCE</span><b>{price ? '$'+fmt(price,price<1?5:4) : '—'}</b></div>
              <div><span>STOP LOSS</span><b>{analysis.stop ? '$'+fmt(analysis.stop,price<1?5:4) : '—'}</b></div>
              <div><span>TAKE PROFIT (2R)</span><b>{analysis.target ? '$'+fmt(analysis.target,price<1?5:4) : '—'}</b></div>
              <div><span>RISK BUDGET (1%)</span><b>$ {fmt(analysis.riskUsd)}</b></div>
              <div><span>EST. POSITION SIZE</span><b>{analysis.positionSize ? fmt(analysis.positionSize,3)+' '+active[2] : '—'}</b></div>
              <div><span>OPEN INTEREST</span><b>{futuresMetrics.openInterest ? compact(+futuresMetrics.openInterest) : '—'}</b></div>
              <div><span>FUNDING RATE</span><b>{futuresMetrics.fundingRate!==null ? fmt(+futuresMetrics.fundingRate*100,4)+'%' : '—'}</b></div>
            </div>
            <p className="risk-note">Risk sizing uses a simulated $10,000 account and a 1% risk budget. Stop and target are volatility-based estimates, not guaranteed execution prices. Funding and open interest are informational; verify liquidity and slippage before any manual trade.</p>
            <div className="signal-warning"><ShieldCheck size={15}/><span>Not a validated strategy. No win probability is claimed. If the setup says WAIT, do not force a trade.</span></div>
          </section>
        )}
        <section className="lower-grid">
          <div className="panel watch-panel"><div className="panel-title"><div><h3>Watchlist</h3><p>Selected liquid markets</p></div><button className="icon-btn" onClick={()=>setWatchOnly(!watchOnly)}><Filter size={16}/></button></div><div className="watch-search"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search assets…"/></div><div className="watch-table"><div className="watch-header"><span>ASSET</span><span>LAST PRICE</span><span>24H CHANGE</span></div>{filtered.map(c=>{const p=prices[c[0]];const up=Number(p?.priceChangePercent)>=0;return <button className={`watch-row ${symbol===c[0]?'active':''}`} key={c[0]} onClick={()=>setSymbol(c[0])}><span className="watch-asset"><i>{c[2][0]}</i><b>{c[2]} <small>{c[1]}</small></b></span><b>{p?'$'+fmt(p.lastPrice,p.lastPrice<1?5:2):'—'}</b><em className={up?'positive':'negative'}>{p?(up?'+':'')+fmt(p.priceChangePercent)+'%':'—'}</em></button>})}</div><div className="table-foot">Live WebSocket stream · REST fallback · {filtered.length} assets shown</div></div>
          <div className="panel paper-panel"><div className="panel-title"><div><h3>Paper account</h3><p>Simulated balance · No real funds</p></div><Wallet size={17}/></div><div className="balance-label">AVAILABLE BALANCE</div><div className="balance-value">${fmt(demoBalance)}</div><div className="balance-change"><span className="positive">Virtual USD</span><span>Starting balance: $10,000</span></div><div className="paper-stats"><div><span>OPEN TRADES</span><b>{paperTrades.filter(t=>t.status==='OPEN').length}</b></div><div><span>UNREALIZED P&L</span><b className={unrealizedPnl>=0?'positive':'negative'}>{unrealizedPnl>=0?'+':''}${fmt(unrealizedPnl)}</b></div></div><button className="primary-btn full" onClick={()=>setTab('Paper Trading')}>Open paper trading <ArrowUpRight size={15}/></button><p className="disclaimer">Paper trading is a simulation and does not represent real execution or guaranteed results.</p></div>
        </section>
        {(tab==='Paper Trading'||tab==='Trade Journal')&&(
          <section className="panel journal-panel">
            <div className="panel-title">
              <div><h3>Paper trade journal</h3><p>Auto stop-loss / take-profit · Saved in this browser</p></div>
              <button className="primary-btn" onClick={addPaperTrade}><Plus size={15}/> Open {analysis.bias==='WAIT'?'trade':' '+analysis.bias}</button>
            </div>
            {paperTrades.length===0?<div className="empty-state">No paper trades yet. A trade can only be opened when the setup assessment is LONG or SHORT.</div>:(
              <div className="trade-list">
                {paperTrades.map(t=>(
                  <div className="trade-row" key={t.id}>
                    <b>{t.symbol.replace('USDT','')}/USDT <small>{t.side}</small></b>
                    <span>Entry: ${fmt(t.entry)}</span>
                    <span>{t.status==='OPEN'?('Live: $'+fmt(prices[t.symbol]?.lastPrice||t.entry)):('Exit: $'+fmt(t.exit))}</span>
                    <span>SL: ${fmt(t.stop)} · TP: ${fmt(t.target)}</span>
                    {t.status==='OPEN'
                      ? <button className="secondary-btn" onClick={()=>closeTrade(t.id,Number(prices[t.symbol]?.lastPrice||t.entry),'MANUAL')}>Close at market</button>
                      : <b className={t.pnl>=0?'positive':'negative'}>{t.pnl>=0?'+':''}${fmt(t.pnl)} <small>{t.exitReason||'CLOSED'}</small></b>}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        <footer><span>CryptoBot <b>·</b> Designed by Mishad</span><span><ShieldCheck size={13}/> Analysis only · Manual execution · Not financial advice</span></footer>
      </div>
    </main>
  </div>;
}
export default App;
