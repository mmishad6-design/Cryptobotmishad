import React, { useEffect, useMemo, useRef, useState } from 'react';
import { translateText } from './i18n.js';
import { validateSignalRiskPlan } from './riskValidation.js';
import { evaluateMtfDecision } from './mtfDecision.js';
import { buildTimeframeRoleData, selectBestTimeframeSignal, TIMEFRAME_PROFILES, TIMEFRAME_INTERVAL_MS } from './timeframeSelection.js';
import { calculateCandleFlow, calculateOrderBookDepth } from './flowMetrics.js';
import { applyAdverseSlippage, calculateTradePnl, resolveIntrabarExit } from './tradeExecution.js';
import { selectClosedCandlesAsOf } from './historicalData.js';
import { createSequentialOosFolds } from './walkForward.js';
import { findConfirmedSwingPivots } from './marketStructure.js';
import { evaluateStructureEvent } from './structureEvents.js';
import { suggestConservativeLeverage, calculatePaperQuantity } from './paperTrading.js';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, Bell, BookOpen, CandlestickChart, ChevronDown, CircleHelp, Clock3, Command, Compass, Crosshair, Download, Eye, Filter, Globe2, Layers3, Menu, Moon, Newspaper, PanelLeftClose, Plus, Play, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Sun, Target, Trash2, TrendingDown, TrendingUp, Wallet, X } from 'lucide-react';

const WATCH = [
  ['BTCUSDT','Bitcoin','BTC'],['ETHUSDT','Ethereum','ETH'],['BNBUSDT','BNB','BNB'],['SOLUSDT','Solana','SOL'],
  ['XRPUSDT','XRP','XRP'],['DOGEUSDT','Dogecoin','DOGE'],['ADAUSDT','Cardano','ADA'],['AVAXUSDT','Avalanche','AVAX'],
  ['LINKUSDT','Chainlink','LINK'],['SUIUSDT','Sui','SUI'],['TONUSDT','Toncoin','TON'],['TRXUSDT','TRON','TRX']
];
const fmt = (n, digits=2) => Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}) : '—';
const compact = n => n >= 1e9 ? (n/1e9).toFixed(2)+'B' : n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e3 ? (n/1e3).toFixed(2)+'K' : fmt(n);
const calculateWilderIndicators = (rows, period=14) => {
  if(!Array.isArray(rows)||rows.length<period+1)return {rsi:null,atr:null,adx:null,plusDI:null,minusDI:null};
  const tr=[],plusDM=[],minusDM=[],gains=[],losses=[];
  for(let i=1;i<rows.length;i++){
    const cur=rows[i],prev=rows[i-1],up=cur.high-prev.high,down=prev.low-cur.low,change=cur.close-prev.close;
    tr.push(Math.max(cur.high-cur.low,Math.abs(cur.high-prev.close),Math.abs(cur.low-prev.close)));
    plusDM.push(up>down&&up>0?up:0);
    minusDM.push(down>up&&down>0?down:0);
    gains.push(Math.max(0,change));losses.push(Math.max(0,-change));
  }
  let avgGain=gains.slice(0,period).reduce((a,b)=>a+b,0)/period;
  let avgLoss=losses.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for(let i=period;i<gains.length;i++){avgGain=(avgGain*(period-1)+gains[i])/period;avgLoss=(avgLoss*(period-1)+losses[i])/period;}
  const rsi=avgLoss===0?(avgGain===0?50:100):100-100/(1+avgGain/avgLoss);
  let atr=tr.slice(0,period).reduce((a,b)=>a+b,0)/period;
  let smPlus=plusDM.slice(0,period).reduce((a,b)=>a+b,0)/period;
  let smMinus=minusDM.slice(0,period).reduce((a,b)=>a+b,0)/period;
  const dx=[];
  const directional=()=>{const plus=atr?smPlus/atr*100:0,minus=atr?smMinus/atr*100:0;return {plus,minus,dx:plus+minus?Math.abs(plus-minus)/(plus+minus)*100:0};};
  dx.push(directional().dx);
  for(let i=period;i<tr.length;i++){
    atr=(atr*(period-1)+tr[i])/period;
    smPlus=(smPlus*(period-1)+plusDM[i])/period;
    smMinus=(smMinus*(period-1)+minusDM[i])/period;
    dx.push(directional().dx);
  }
  let adx=null;
  if(dx.length>=period){
    adx=dx.slice(0,period).reduce((a,b)=>a+b,0)/period;
    for(let i=period;i<dx.length;i++)adx=(adx*(period-1)+dx[i])/period;
  }
  const latest=directional();
  return {rsi,atr,adx,plusDI:latest.plus,minusDI:latest.minus};
};
const wilderATRAt = (rows,endIndex,period=14) => {
  if(!Array.isArray(rows)||endIndex<period)return null;
  const sample=rows.slice(Math.max(0,endIndex-119),endIndex+1);
  if(sample.length<period+1)return null;
  let atr=0;
  for(let i=1;i<=period;i++){const c=sample[i],p=sample[i-1];atr+=Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close));}
  atr/=period;
  for(let i=period+1;i<sample.length;i++){const c=sample[i],p=sample[i-1],tr=Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close));atr=(atr*(period-1)+tr)/period;}
  return atr;
};
const intervals = ['1m','5m','15m','1h','4h','1d'];

async function fetchJsonWithRetry(url, { attempts = 3, timeoutMs = 10000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) {
        const error = new Error('HTTP ' + response.status);
        error.status = response.status;
        if (response.status !== 429 && response.status < 500) throw error;
        lastError = error;
      } else {
        return await response.json();
      }
    } catch (error) {
      lastError = error;
      if (error?.status && error.status !== 429 && error.status < 500) throw error;
    } finally {
      window.clearTimeout(timeout);
    }
    if (attempt < attempts - 1) await new Promise(resolve => window.setTimeout(resolve, 500 * (2 ** attempt)));
  }
  throw lastError || new Error('Binance API request failed');
}
const profileName = name => ({Balanced:'ভারসাম্যপূর্ণ', 'Strict trend':'কঠোর Trend', 'Early momentum':'প্রাথমিক Momentum', 'Volume confirmed':'Volume নিশ্চিত', 'High conviction':'উচ্চ আস্থার সেটআপ', 'Baseline fallback':'বিকল্প Baseline'}[name] || name);

const regimeLabel = value => ({TRENDING:'Trend চলমান',RANGING:'সীমাবদ্ধ Market', 'HIGH VOLATILITY':'উচ্চ Volatility',TRANSITION:'পরিবর্তনশীল অবস্থা'}[value] || value);
const directionLabel = value => ({UPTREND:'ঊর্ধ্বমুখী',DOWNTREND:'নিম্নমুখী',SIDEWAYS:'একই সীমায়',MIXED:'মিশ্র',CAUTION:'সতর্কতা'}[value] || value);
const trendLabel = value => ({BULLISH:'ঊর্ধ্বমুখী',BEARISH:'নিম্নমুখী',MIXED:'মিশ্র'}[value] || value);
const structureLabel = value => ({NONE:'নেই','BULLISH Sweep':'ঊর্ধ্বমুখী Liquidity Sweep','BEARISH Sweep':'নিম্নমুখী Liquidity Sweep','BULLISH STRUCTURE':'ঊর্ধ্বমুখী Structure','BEARISH STRUCTURE':'নিম্নমুখী Structure','BULLISH BOS':'ঊর্ধ্বমুখী BOS','BEARISH BOS':'নিম্নমুখী BOS','BULLISH CHoCH':'ঊর্ধ্বমুখী CHoCH','BEARISH CHoCH':'নিম্নমুখী CHoCH','BULLISH SWEEP':'ঊর্ধ্বমুখী Liquidity Sweep','BEARISH SWEEP':'নিম্নমুখী Liquidity Sweep','BULLISH FVG':'ঊর্ধ্বমুখী FVG','BEARISH FVG':'নিম্নমুখী FVG','BULLISH OB':'ঊর্ধ্বমুখী Order Block','BEARISH OB':'নিম্নমুখী Order Block'}[value] || value);
const liquidationLabel = value => value==='LONG LIQUIDATED'?'LONG Position Liquidation':value==='SHORT LIQUIDATED'?'SHORT Position Liquidation':value;

function ChartPanel({symbol, interval, candles, loading, market, resetKey, onReset}) {
  const host = useRef(null);
  const chartRef = useRef(null);
  const didFit = useRef(false);
  const lastKey = useRef('');
  useEffect(() => {
    if (!host.current) return;
    const chart = createChart(host.current, {
      autoSize: true, layout: { background: { type: 'solid', color: '#101720' }, textColor: '#8190a3', fontFamily: 'Inter, ui-sans-serif, system-ui', fontSize: 11 },
      grid: { vertLines: { color: '#1b2632' }, horzLines: { color: '#1b2632' } },
      rightPriceScale: { borderColor: '#263341' }, timeScale: { borderColor: '#263341', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 }, handleScroll: true, handleScale: true
    });
    const series = chart.addSeries(CandlestickSeries, { upColor:'#19b88a', downColor:'#ef6472', borderUpColor:'#19b88a', borderDownColor:'#ef6472', wickUpColor:'#19b88a', wickDownColor:'#ef6472' });
    const ema20Series = chart.addSeries(LineSeries, { color:'#f0b95b', lineWidth:2, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false, title:'EMA 20' });
    const ema50Series = chart.addSeries(LineSeries, { color:'#69a9ff', lineWidth:2, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false, title:'EMA 50' });
    chartRef.current = {chart,series,ema20Series,ema50Series};
    didFit.current = false;
    const resize = new ResizeObserver(entries => { if(entries[0]) chart.applyOptions({width:entries[0].contentRect.width}); });
    resize.observe(host.current);
    return () => { resize.disconnect(); chart.remove(); chartRef.current = null; };
  }, []);
  useEffect(() => {
    if (!chartRef.current || !candles?.length) return;
    const unique = new Map();
    candles.forEach(c=>{if(Number.isFinite(c.time)&&[c.open,c.high,c.low,c.close].every(v=>Number.isFinite(Number(v))&&Number(v)>0))unique.set(c.time,c);});
    const valid = [...unique.values()].sort((a,b)=>a.time-b.time);
    if (!valid.length) return;
    chartRef.current.series.setData(valid.map(c=>({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close})));
    const makeEma = period => {
      if (valid.length < period) return [];
      const alpha=2/(period+1), points=[];
      let value=valid.slice(0,period).reduce((sum,c)=>sum+c.close,0)/period;
      points.push({time:valid[period-1].time,value});
      for(let i=period;i<valid.length;i++){value=valid[i].close*alpha+value*(1-alpha);points.push({time:valid[i].time,value});}
      return points;
    };
    chartRef.current.ema20Series.setData(makeEma(20));
    chartRef.current.ema50Series.setData(makeEma(50));
    const key=symbol+'_'+interval+'_'+market;
    if (!didFit.current || lastKey.current!==key) {
      chartRef.current.chart.timeScale().fitContent();
      didFit.current=true;
      lastKey.current=key;
    }
  }, [candles,symbol,interval,market]);
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.chart.timeScale().fitContent();
    chartRef.current.series.priceScale().applyOptions({ autoScale: true });
    chartRef.current.ema20Series.priceScale().applyOptions({ autoScale: true });
    chartRef.current.ema50Series.priceScale().applyOptions({ autoScale: true });
    didFit.current = true;
    lastKey.current = symbol+'_'+interval+'_'+market;
  }, [resetKey, symbol, interval, market]);
  return <div className="chart-wrap"><div className="chart-label"><span>{loading ? 'Updating market data…' : `Binance ${market} · Live kline stream`} <span>•</span> {symbol.replace('USDT','')}/USDT</span><button className="chart-reset-btn" onClick={() => { if (chartRef.current) { chartRef.current.chart.timeScale().fitContent(); chartRef.current.series.priceScale().applyOptions({ autoScale: true }); } onReset?.(); }} title="Reload candles and reset chart view"><RefreshCw size={13}/> Reset chart</button></div><div className="chart-canvas" ref={host}/>{!candles?.length && <div className="chart-empty">{loading ? 'Loading fresh candle history…' : 'Candle data unavailable — press Reset chart to retry'}</div>}<div className="chart-indicator-legend"><span><i className="ema20-dot"/> EMA 20 · live candle</span><span><i className="ema50-dot"/> EMA 50 · live candle</span><small>চলমান ক্যান্ডেলসহ প্রতি WebSocket আপডেটে হিসাব</small></div></div>;
}

function BacktestPanel({symbol,market,defaultInterval}) {
  const [tf,setTf]=useState('5m'),[days,setDays]=useState('30'),[fee,setFee]=useState('0.05'),[slippage,setSlippage]=useState('0.02'),[running,setRunning]=useState(false),[result,setResult]=useState(null),[error,setError]=useState('');
  const frames=['4h','1h','15m','5m'];
  const intervalMs={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000};
  const toRows=(raw,ms)=>{const unique=new Map();for(const k of raw){if(Number(k[6])<Date.now())unique.set(Number(k[0]),{time:+k[0],closeTime:+k[6],open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5],takerBuy:k[9]===undefined?null:Number(k[9])});}return [...unique.values()].sort((a,b)=>a.time-b.time);};
  const evaluate=(rows)=>{
    if(rows.length<60)return null;
    const d=rows.slice(-120),closes=d.map(x=>x.close);
    const ema=n=>{const a=2/(n+1);let v=closes.slice(0,n).reduce((s,x)=>s+x,0)/n;for(let i=n;i<closes.length;i++)v=closes[i]*a+v*(1-a);return v;};
    const e20=ema(20),e50=ema(50),last=d.at(-1),prev=d.at(-2);
    const indicators=calculateWilderIndicators(d,14),rsi=indicators.rsi,atr=indicators.atr,adx=indicators.adx;
    const flowMetrics=calculateCandleFlow(d,20),volumeRatio=flowMetrics.volumeRatio;
    const pivots=findConfirmedSwingPivots(d,3);
    const {bos,choch,sweep}=evaluateStructureEvent(d,pivots);
    const takerRatio=flowMetrics.takerRatio;
    return {trend:last.close>e20&&e20>e50?'BULLISH':last.close<e20&&e20<e50?'BEARISH':'MIXED',rsi,volumeRatio,adx,atr,atrPct:last.close?atr/last.close*100:0,bos,choch,sweep,takerRatio,close:last.close,flowValid:flowMetrics.valid};
  };
  const simulate=(data,feeRate,slipRate,historyByFrame,cfg={adx15:18,adxTrend:15,rsiLong:50,rsiShort:50,volume:0.8,taker:1.05})=>{
    let equity=10000,peak=10000,maxDrawdown=0,position=null,trades=[],signals=0;
    const atrAt=i=>wilderATRAt(data,i,14);
    const close=(rawExit,reason,time)=>{const p=position;if(!p)return;const exit=applyAdverseSlippage(rawExit,p.side,'EXIT',slipRate);const accounting=calculateTradePnl({side:p.side,entry:p.entry,exit,quantity:p.qty,feeRate,entryFee:p.entryFee});if(!accounting.ok)return;equity+=accounting.netPnl;trades.push({side:p.side,entry:p.entry,exit,qty:p.qty,pnl:accounting.netPnl,grossPnl:accounting.grossPnl,entryFee:accounting.entryFee,exitFee:accounting.exitFee,reason,entryTime:p.entryTime,exitTime:time});position=null;};
    for(let i=60;i<data.length-1;i++){
      const c=data[i],availableAt=c.time+intervalMs['5m']-1;
      const snap={};
      for(const frame of frames){const rows=historyByFrame[frame];snap[frame]=evaluate(selectClosedCandlesAsOf(rows,availableAt,120));}
      const [h4,h1,m15,m5]=frames.map(f=>snap[f]);
      if(position){const intrabarExit=resolveIntrabarExit({side:position.side,open:c.open,high:c.high,low:c.low,stop:position.stop,target:position.target});if(intrabarExit)close(intrabarExit.price,intrabarExit.reason,c.time);}
      let bias='WAIT',riskPlan=null;
      if(h4&&h1&&m15&&m5){
        // Signal eligibility is decided using information available at the 5m close only.
        // The next candle open is used later solely as the simulated execution fill.
        const evaluated=evaluateMtfDecision({
          data:snap, flow:{takerRatio:m5.takerRatio}, flowMode:'historical',
          entry:m5.close, market, accountBalance:equity, feeRate, slippageRate:slipRate,
          thresholds:{adx15:cfg.adx15,adxTrend:cfg.adxTrend,rsiLong:cfg.rsiLong,rsiShort:cfg.rsiShort,volume:cfg.volume,taker:cfg.taker},
        });
        if(evaluated.decision!=='NO TRADE'){
          const simulatedEntry=applyAdverseSlippage(data[i+1].open,evaluated.decision,'Entry',slipRate);
          riskPlan=validateSignalRiskPlan({
            side:evaluated.decision, entry:simulatedEntry, atr:m5.atr, market,
            accountBalance:equity, feeRate, slippageRate:slipRate,
          });
          bias=riskPlan?.ok?evaluated.decision:'WAIT';
        }
      }
      if(bias!=='WAIT')signals++;
      if(!position&&bias!=='WAIT'&&riskPlan?.ok&&(market==='Futures'||bias==='LONG')){
        const entry=riskPlan.entry,qty=riskPlan.quantity;
        const margin=entry*qty/(market==='Futures'?3:1),entryFee=entry*qty*feeRate;
        if(Number.isFinite(qty)&&qty>0&&margin+entryFee<=equity)position={side:bias,entry,qty,stop:riskPlan.stop,target:riskPlan.target,entryFee,entryTime:data[i+1].time};
      }
      const positionActiveAtClose=position&&position.entryTime<=c.time;
      const estimatedExitCost=positionActiveAtClose?c.close*position.qty*(feeRate+slipRate):0;
      const marked=equity+(positionActiveAtClose?((c.close-position.entry)*position.qty*(position.side==='LONG'?1:-1)-position.entryFee-estimatedExitCost):0);peak=Math.max(peak,marked);maxDrawdown=Math.max(maxDrawdown,(peak-marked)/peak*100);
    }
    if(position)close(data.at(-1).close,'END OF TEST',data.at(-1).time);
    const wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<0),gp=wins.reduce((s,t)=>s+t.pnl,0),gl=Math.abs(losses.reduce((s,t)=>s+t.pnl,0));
    return {equity,net:equity-10000,returnPct:(equity-10000)/100,tradeCount:trades.length,wins:wins.length,losses:losses.length,winRate:trades.length?wins.length/trades.length*100:0,profitFactor:gl?gp/gl:gp>0?null:0,expectancy:trades.length?(equity-10000)/trades.length:0,maxDrawdown,signals,trades};
  };
  const run=async()=>{
    setRunning(true);setError('');setResult(null);
    try{
      const base=market==='Futures'?'https://fapi.binance.com':'https://api.binance.com',endpoint=market==='Futures'?'/fapi/v1/klines':'/api/v3/klines',now=Date.now(),startTime=now-Number(days)*86400000,warmupMs=30*86400000,fetchStart=startTime-warmupMs;
      const fetchFrame=async frame=>{const ms=intervalMs[frame];let cursor=fetchStart,raw=[],pages=0;while(cursor<now&&pages<100){const response=await fetch(base+endpoint+'?symbol='+symbol+'&interval='+frame+'&startTime='+cursor+'&endTime='+now+'&limit=1000',{cache:'no-store'});if(!response.ok)throw new Error(frame+' historical data request failed ('+response.status+').');const batch=await response.json();if(!Array.isArray(batch)||!batch.length)break;raw=raw.concat(batch);const next=Number(batch.at(-1)[0])+ms;if(next<=cursor)throw new Error(frame+' pagination did not advance; stopping to avoid duplicate data.');cursor=next;pages++;if(batch.length<1000)break;}if(pages>=100&&cursor<now)throw new Error(frame+' history exceeded the safe pagination limit.');const rows=toRows(raw,ms),gapIndex=rows.slice(1).findIndex((x,i)=>x.time-rows[i].time!==ms);if(gapIndex>=0)throw new Error(frame+' historical candles contain a missing interval near '+new Date(rows[gapIndex+1].time).toISOString()+'. Validation stopped.');return rows;};
      const fetched=await Promise.all(frames.map(fetchFrame)),historyByFrame=Object.fromEntries(frames.map((f,i)=>[f,fetched[i]]));
      const data=historyByFrame['5m'],requestedStartIndex=data.findIndex(x=>x.time>=startTime);if(requestedStartIndex<0||data.length-requestedStartIndex<240)throw new Error('Not enough completed 5m candles in the requested period. Try a longer history window.');
      const requestedCount=data.length-requestedStartIndex,split=requestedStartIndex+Math.floor(requestedCount*.7);if(split-requestedStartIndex<60||data.length-split<180)throw new Error('Selected period is too short for the 70/30 split and three validation folds. Choose 30 days or more.');
      const feeRate=Math.max(0,Math.min(1,Number(fee)||0))/100,slipRate=Math.max(0,Math.min(1,Number(slippage)||0))/100;
      const trainData=data.slice(Math.max(0,requestedStartIndex-60),split),testData=data.slice(split-60),candidates=[{name:'Balanced',adx15:18,adxTrend:15,rsiLong:50,rsiShort:50,volume:0.8,taker:1.05},{name:'Strict trend',adx15:22,adxTrend:18,rsiLong:52,rsiShort:48,volume:1,taker:1.1},{name:'Early momentum',adx15:16,adxTrend:13,rsiLong:48,rsiShort:52,volume:0.8,taker:1.03},{name:'Volume confirmed',adx15:18,adxTrend:15,rsiLong:50,rsiShort:50,volume:1.1,taker:1.1},{name:'High conviction',adx15:25,adxTrend:20,rsiLong:53,rsiShort:47,volume:1.1,taker:1.15}];
      const ranked=candidates.map(cfg=>({...cfg,train:simulate(trainData,feeRate,slipRate,historyByFrame,cfg)})).filter(x=>x.train.tradeCount>=5).sort((a,b)=>{const score=x=>(x.train.profitFactor===null?2:x.train.profitFactor)+x.train.returnPct*.01-x.train.maxDrawdown*.12+x.train.expectancy*.001;return score(b)-score(a);});
      const selected=ranked[0]||{...candidates[0],train:simulate(trainData,feeRate,slipRate,historyByFrame,candidates[0]),name:'Baseline fallback'};const cfg={adx15:selected.adx15,adxTrend:selected.adxTrend,rsiLong:selected.rsiLong,rsiShort:selected.rsiShort,volume:selected.volume,taker:selected.taker};
      const training=selected.train,outOfSample=simulate(testData,feeRate,slipRate,historyByFrame,cfg),folds=createSequentialOosFolds(data,split,3,60).map(fold=>({
        label:'ধারাবাহিক OOS ধাপ '+fold.index,
        from:fold.testStartTime,
        to:fold.testEndTime,
        warmupCandles:fold.warmupCount,
        ...simulate(fold.data,feeRate,slipRate,historyByFrame,cfg),
      }));
      setResult({symbol,market,tf:'5m execution · 4H/1H/15M context',days,from:data[requestedStartIndex].time,to:data.at(-1).time,candles:requestedCount,warmupCandles:requestedStartIndex,splitAt:data[split].time,training,outOfSample,folds,selected:{name:selected.name,adx15:selected.adx15,adxTrend:selected.adxTrend,rsiLong:selected.rsiLong,rsiShort:selected.rsiShort,volume:selected.volume,taker:selected.taker},candidates:ranked.map(x=>({name:x.name,returnPct:x.train.returnPct,tradeCount:x.train.tradeCount,winRate:x.train.winRate,profitFactor:x.train.profitFactor,maxDrawdown:x.train.maxDrawdown})),feeRate,slipRate,tradeList:outOfSample.trades.slice(-12).reverse(),coverage:{'4h':historyByFrame['4h'].length,'1h':historyByFrame['1h'].length,'15m':historyByFrame['15m'].length,'5m':historyByFrame['5m'].length},assumption:'পাঁচটি নির্দিষ্ট MTF Parameter Profile কেবল সময়ের ক্রমে সাজানো Training ডেটা দিয়ে মূল্যায়ন করা হয়। যোগ্য Profile-গুলোর মধ্যে সেরা Profile নির্বাচন করে স্থির রাখা হয়; এরপর সেটিকে অদেখা শেষ ৩০% Test ডেটা এবং পরস্পর-অতিক্রম না করা তিনটি ধারাবাহিক OOS ভাগে পরীক্ষা করা হয়। প্রতিটি ভাগের আগে থাকা ৬০টি 5M Candle শুধু Indicator প্রস্তুত করতে ব্যবহৃত হয়, ফলাফলের হিসাবে ধরা হয় না। সব ভাগে একই স্থির Profile ব্যবহৃত হয়; তাই এটি নতুন করে Parameter Optimise করা Walk-Forward Test নয়। কোনো Profile-এ Training চলাকালে অন্তত পাঁচটি Trade না হলে Balanced Baseline ব্যবহার করা হয় এবং সেটি Fallback হিসেবে চিহ্নিত থাকে।'});
    }catch(e){setError(e.message||'Multi-Timeframe যাচাই সম্পন্ন হয়নি।');}finally{setRunning(false);}
  };
  const metric=x=>x?((x.returnPct>=0?'+':'')+fmt(x.returnPct)+'% · '+x.tradeCount+'টি Trade · '+fmt(x.winRate)+'% জয়ের হার · Profit Factor '+(x.profitFactor===null?'∞':fmt(x.profitFactor))+' · সর্বোচ্চ Drawdown '+fmt(x.maxDrawdown)+'%'):'—';
  return <section className="panel backtest-panel">
    <div className="panel-title"><div><h3>উন্নত Multi-Timeframe যাচাই</h3><p>4H ট্রেন্ড → 1H মিল → 15M সেটআপ → 5M এন্ট্রি · সময়ের ক্রম অনুযায়ী Train/Test ভাগ · ধারাবাহিক Out-of-Sample পরীক্ষা</p></div><span className="tiny-live">RESEARCH MODE</span></div>
    <div className="backtest-controls">
      <label>ট্রেড কার্যকর করার Timeframe<select value={tf} onChange={e=>setTf(e.target.value)}><option value="5m">5m (আবশ্যক)</option></select></label>
      <label>ঐতিহাসিক ডেটার সময়সীমা<select value={days} onChange={e=>setDays(e.target.value)}><option value="7">৭ দিন</option><option value="30">৩০ দিন</option><option value="90">৯০ দিন</option><option value="180">১৮০ দিন</option></select></label>
      <label>Trading Fee (%)<input type="number" min="0" max="1" step="0.01" value={fee} onChange={e=>setFee(e.target.value)}/></label>
      <label>Slippage (%)<input type="number" min="0" max="1" step="0.01" value={slippage} onChange={e=>setSlippage(e.target.value)}/></label>
      <button className="primary-btn" disabled={running} onClick={run}><Play size={14}/>{running?'যাচাই হচ্ছে…':'MTF যাচাই চালাও'}</button>
    </div>
    {error&&<div className="backtest-error">{error}</div>}
    {result&&<>
      <div className="backtest-meta"><span>{result.symbol.replace('USDT','')}/USDT · Binance {result.market}</span><span>{new Date(result.from).toLocaleDateString()} – {new Date(result.to).toLocaleDateString()}</span><span>{result.candles} টি সম্পূর্ণ 5M Candle</span></div>
      <div className="backtest-meta"><span>4H: {result.coverage['4h']} · 1H: {result.coverage['1h']} · 15M: {result.coverage['15m']} · 5M: {result.coverage['5m']} টি Candle</span><span>{result.warmupCandles.toLocaleString()} টি অতিরিক্ত 5M প্রস্তুতিমূলক Candle; ফলাফলের হিসাবে ধরা হয়নি</span></div>
      <div className="backtest-metrics">
        <div><span>অব্যবহৃত ডেটায় Return</span><b className={result.outOfSample.returnPct>=0?'positive':'negative'}>{result.outOfSample.returnPct>=0?'+':''}{fmt(result.outOfSample.returnPct)}%</b></div>
        <div><span>অব্যবহৃত ডেটায় জয়ের হার</span><b>{fmt(result.outOfSample.winRate)}%</b></div><div><span>অব্যবহৃত ডেটায় মোট Trade</span><b>{result.outOfSample.tradeCount}</b></div>
        <div><span>অব্যবহৃত ডেটায় Profit Factor</span><b>{result.outOfSample.profitFactor===null?'∞':fmt(result.outOfSample.profitFactor)}</b></div>
        <div><span>অব্যবহৃত ডেটায় সর্বোচ্চ Drawdown</span><b className="negative">{fmt(result.outOfSample.maxDrawdown)}%</b></div>
        <div><span>প্রতি Trade-এর প্রত্যাশিত ফল</span><b className={result.outOfSample.expectancy>=0?'positive':'negative'}>&#36;{fmt(result.outOfSample.expectancy)}</b></div>
        <div><span>শেষের মোট Balance</span><b>&#36;{fmt(result.outOfSample.equity)}</b></div>
        <div><span>অব্যবহৃত ডেটায় সিগন্যাল</span><b>{result.outOfSample.signals}</b></div>
        <div><span>Training পর্যায়ের Return</span><b className={result.training.returnPct>=0?'positive':'negative'}>{result.training.returnPct>=0?'+':''}{fmt(result.training.returnPct)}%</b></div>
      </div>
      <div className="backtest-meta"><span>Training: {new Date(result.from).toLocaleDateString()} – {new Date(result.splitAt).toLocaleDateString()}</span><span>অদেখা Test: {new Date(result.splitAt).toLocaleDateString()} – {new Date(result.to).toLocaleDateString()}</span></div>
      <div className="mtf-reasons"><span>নির্বাচিত Training Profile: {profileName(result.selected.name)}</span><span>Training ফলাফল: {metric(result.training)}</span><span>অব্যবহৃত ডেটায় ফলাফল: {metric(result.outOfSample)}</span></div>
      <h4 className="section-subtitle">পরীক্ষার আগে স্থির করা Parameters</h4><div className="backtest-meta"><span>ADX 15M ≥ {result.selected.adx15} · ADX trend ≥ {result.selected.adxTrend}</span><span>RSI LONG ≥ {result.selected.rsiLong} · RSI SHORT ≤ {result.selected.rsiShort}</span><span>Volume ≥ {result.selected.volume}× · Taker ratio ≥ {result.selected.taker}</span></div>
      <h4 className="section-subtitle">শুধু Training ডেটায় Candidate-এর ক্রম</h4><div className="backtest-table-wrap"><table className="backtest-table"><thead><tr><th>Profile</th><th>Training Return</th><th>Trade সংখ্যা</th><th>জয়ের হার</th><th>Profit Factor</th><th>সর্বোচ্চ Drawdown</th></tr></thead><tbody>{result.candidates.map(x=><tr key={x.name}><td>{profileName(x.name)}</td><td className={x.returnPct>=0?'positive':'negative'}>{x.returnPct>=0?'+':''}{fmt(x.returnPct)}%</td><td>{x.tradeCount}</td><td>{fmt(x.winRate)}%</td><td>{x.profitFactor===null?'∞':fmt(x.profitFactor)}</td><td>{fmt(x.maxDrawdown)}%</td></tr>)}</tbody></table></div>
      <h4 className="section-subtitle">ধারাবাহিক Out-of-Sample ভাগ</h4>
      <div className="backtest-table-wrap"><table className="backtest-table"><thead><tr><th>পরীক্ষার ধাপ</th><th>পরীক্ষার সময়সীমা</th><th>Return</th><th>Trade সংখ্যা</th><th>জয়ের হার</th><th>Profit Factor</th><th>সর্বোচ্চ Drawdown</th></tr></thead><tbody>{result.folds.map(x=><tr key={x.label}><td>{x.label}</td><td>{new Date(x.from).toLocaleDateString()} – {new Date(x.to).toLocaleDateString()}</td><td className={x.returnPct>=0?'positive':'negative'}>{x.returnPct>=0?'+':''}{fmt(x.returnPct)}%</td><td>{x.tradeCount}</td><td>{fmt(x.winRate)}%</td><td>{x.profitFactor===null?'∞':fmt(x.profitFactor)}</td><td className="negative">{fmt(x.maxDrawdown)}%</td></tr>)}</tbody></table></div>
      <p className="backtest-assumption">{result.assumption} প্রতিটি ভাগে প্রারম্ভিক Balance ১০,০০০ USDT ধরা হয়। প্রতি পাশে Fee {fmt(Number(fee),3)}% এবং Slippage {fmt(Number(slippage),3)}% হিসাব করা হয়। একই Candle-এ Stop ও Target দুটিই স্পর্শ করলে Stop আগে কার্যকর হয়েছে ধরা হয়। ATR Stop ১.৫ গুণ, Target ৩ গুণ, প্রতি Trade-এ Risk ১%, Futures Notional সীমা ৩ গুণ। পুরোনো Order Book Snapshot পাওয়া যায় না, তাই Live Engine-এর Top-20 Depth Confirmation পরীক্ষা করা হয়নি; 5M Candle-এর Taker Buy Volume বিকল্প মাপকাঠি হিসেবে ব্যবহৃত হয়েছে। Funding, Liquidation, Spread, Partial Fill ও Market Impact হিসাবের অন্তর্ভুক্ত নয়। এটি গবেষণামূলক ফলাফল—ভবিষ্যৎ লাভের নিশ্চয়তা নয়।</p>
      <div className="backtest-table-wrap"><table className="backtest-table"><thead><tr><th>OOS দিক</th><th>Entry</th><th>Exit</th><th>নিট লাভ/ক্ষতি</th><th>বন্ধ হওয়ার কারণ</th></tr></thead><tbody>{result.tradeList.map((t,i)=><tr key={i}><td>{t.side}</td><td>{fmt(t.entry,t.entry<1?5:3)}</td><td>{fmt(t.exit,t.exit<1?5:3)}</td><td className={t.pnl>=0?'positive':'negative'}>{t.pnl>=0?'+':''}{String.fromCharCode(36)}{fmt(t.pnl)}</td><td>{t.reason}</td></tr>)}</tbody></table></div>
    </>}
    <div className="backtest-disclaimer"><ShieldCheck size={14}/> ৩০ দিনের Indicator প্রস্তুতির ডেটাসহ ঐতিহাসিক MTF Simulation। ভবিষ্যতের Candle আগেভাগে ব্যবহার করা হয় না এবং অদেখা Test ভাগের ফল দেখানো হয়। তবে ঐতিহাসিক Order Book Depth ও বাস্তব Trade-এর কয়েকটি খরচ এতে নেই। জয়ের হার বা লাভজনকতার কোনো নিশ্চয়তা দেওয়া হচ্ছে না।</div>
  </section>;
}
function StrategyOptimizer({symbol,market}) {
  const [tf,setTf]=useState('15m'),[days,setDays]=useState('30'),[fee,setFee]=useState('0.05'),[slippage,setSlippage]=useState('0.02');
  const [running,setRunning]=useState(false),[result,setResult]=useState(null),[error,setError]=useState('');
  const [history,setHistory]=useState(()=>{try{return JSON.parse(localStorage.getItem('cryptobot.strategyRuns')||'[]');}catch{return [];}});
  useEffect(()=>{try{localStorage.setItem('cryptobot.strategyRuns',JSON.stringify(history.slice(0,10)));}catch{}},[history]);
  const exportCsv=()=>{if(!result)return;const rows=[['ক্রম','Symbol','Market','Timeframe','দ্রুত SMA','ধীর SMA','Stop ATR','Target ATR','Training Return %','Training সর্বোচ্চ Drawdown %','Test Return %','Test সর্বোচ্চ Drawdown %','Test জয়ের হার %','Test Trade সংখ্যা','Test Profit Factor'],...result.ranked.map((x,i)=>[i+1,result.symbol,result.market,result.tf,x.fast,x.slow,x.sl,x.tp,x.train.returnPct,x.train.maxDD,x.test.returnPct,x.test.maxDD,x.test.winRate,x.test.trades,x.test.profitFactor===null?'Infinity':x.test.profitFactor])];const csv=rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='cryptobot-strategy-'+result.symbol+'-'+result.tf+'-'+Date.now()+'.csv';a.click();URL.revokeObjectURL(url);};
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
      const data=raw.filter(k=>Number(k[6])<Date.now()&&Number(k[6])>Number(k[0])).slice(0,5000).map(k=>({time:k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4]}));
      if(data.length<180)throw new Error('কমপক্ষে ১৮০টি Candle প্রয়োজন। বেশি সময়ের History অথবা অন্য Timeframe বেছে নাও।');
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
            if(Number.isFinite(qty)&&qty>0&&margin+entryFee<=equity)pos={side:bias,entry,qty,stop:bias==='LONG'?entry-distance:entry+distance,target:bias==='LONG'?entry+a*cfg.tp:entry-a*cfg.tp,entryTime:next.time};
          }
          const positionActiveAtClose=pos&&pos.entryTime<=c.time;
          const marked=equity+(positionActiveAtClose?((c.close-pos.entry)*pos.qty*(pos.side==='LONG'?1:-1)-pos.entry*pos.qty*feeRate):0);
          peak=Math.max(peak,marked);maxDD=Math.max(maxDD,(peak-marked)/peak*100);
        }
        if(pos)close(data[to-1].close,'END',data[to-1].time);
        const wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<0),gp=wins.reduce((s,t)=>s+t.pnl,0),gl=Math.abs(losses.reduce((s,t)=>s+t.pnl,0));
        return {trades:trades.length,winRate:trades.length?wins.length/trades.length*100:0,net:equity-starting,returnPct:(equity-starting)/starting*100,maxDD,profitFactor:gl?gp/gl:gp>0?null:0,expectancy:trades.length?(equity-starting)/trades.length:0};
      };
      const tested=configs.map(cfg=>({...cfg,train:simulate(cfg,0,split)})).filter(x=>x.train.trades>=5);
      if(!tested.length)throw new Error('কোনো Parameter-ই Training ডেটায় অন্তত ৫টি Trade তৈরি করতে পারেনি। বেশি সময়ের History অথবা অন্য Timeframe বেছে নাও।');
      tested.sort((a,b)=>{
        const score=x=>(x.train.profitFactor===null?3:x.train.profitFactor)+x.train.returnPct*.015-x.train.maxDD*.08;
        return score(b)-score(a);
      });
      const ranked=tested.slice(0,8).map(x=>({...x,test:simulate(x,split,data.length)}));
      const completed={id:Date.now(),createdAt:new Date().toISOString(),symbol,market,tf,days,candles:data.length,actualDays:(data.at(-1).time-data[0].time)/86400000,from:data[0].time,split:data[split].time,to:data[data.length-1].time,trainingCandles:split,testCandles:data.length-split,ranked,feeRate,slipRate};setResult(completed);setHistory(prev=>[completed,...prev.filter(x=>x.id!==completed.id)].slice(0,10));
    }catch(e){setError(e.message||'Parameter যাচাই ব্যর্থ হয়েছে। আবার চেষ্টা করো।');}
    finally{setRunning(false);}
  };
  return <section className="panel optimizer-panel">
    <div className="panel-title"><div><h3>Strategy-এর Parameter খোঁজা ও যাচাই</h3><p>প্রথম ৭০% ডেটায় Parameter নির্বাচন · শেষ ৩০% ডেটায় আলাদা যাচাই</p></div><span className="tiny-live">RESEARCH MODE</span></div>
    <div className="backtest-controls optimizer-controls">
      <label>Timeframe<select value={tf} onChange={e=>setTf(e.target.value)}>{['5m','15m','1h','4h','1d'].map(x=><option key={x}>{x}</option>)}</select></label>
      <label>ঐতিহাসিক ডেটার সময়সীমা<select value={days} onChange={e=>setDays(e.target.value)}><option value="7">৭ দিন</option><option value="30">৩০ দিন</option><option value="90">৯০ দিন</option><option value="180">১৮০ দিন</option></select></label>
      <label>ফি (%)<input type="number" min="0" max="1" step="0.01" value={fee} onChange={e=>setFee(e.target.value)}/></label>
      <label>Slippage (%)<input type="number" min="0" max="1" step="0.01" value={slippage} onChange={e=>setSlippage(e.target.value)}/></label>
      <button className="primary-btn" disabled={running} onClick={run}><Play size={14}/>{running?'পরীক্ষা চলছে…':'Strategy যাচাই করো'}</button>
    </div>
    {error&&<div className="backtest-error">{error}</div>}
    {result&&<>
      <div className="backtest-meta"><span>{result.symbol.replace('USDT','')}/USDT · Binance {result.market}</span><span>{new Date(result.from).toLocaleDateString()} – {new Date(result.to).toLocaleDateString()}</span><span>{result.candles} টি সম্পূর্ণ Candle · {fmt(result.actualDays,1)} দিনের প্রকৃত ডেটা · {result.ranked.length} টি Candidate মূল্যায়ন</span></div>
      <div className="validation-split"><div><b>Training ডেটা · ৭০%</b><span>{result.trainingCandles} টি Candle · Parameter সাজাতে ব্যবহৃত</span></div><div><b>অদেখা Test ডেটা · ৩০%</b><span>{result.testCandles} টি Candle · আগে ব্যবহার না করা যাচাইয়ের সময়</span></div></div>
      <div className="backtest-table-wrap"><table className="backtest-table optimizer-table"><thead><tr><th>ক্রম</th><th>Parameter (Fast / Slow)</th><th>Stop Loss × ATR</th><th>Take Profit × ATR</th><th>Training Return</th><th>Training Drawdown</th><th>Test Return</th><th>Test Drawdown</th><th>Test জয়ের হার</th><th>Test Trade</th><th>Test Profit Factor</th></tr></thead><tbody>{result.ranked.map((x,i)=><tr key={x.fast+'-'+x.slow+'-'+x.sl+'-'+x.tp}><td>{i+1}</td><td>SMA {x.fast}/{x.slow}</td><td>{x.sl}×</td><td>{x.tp}×</td><td className={x.train.returnPct>=0?'positive':'negative'}>{x.train.returnPct>=0?'+':''}{fmt(x.train.returnPct)}%</td><td>{fmt(x.train.maxDD)}%</td><td className={x.test.returnPct>=0?'positive':'negative'}>{x.test.returnPct>=0?'+':''}{fmt(x.test.returnPct)}%</td><td className='negative'>{fmt(x.test.maxDD)}%</td><td>{fmt(x.test.winRate)}%</td><td>{x.test.trades}</td><td>{x.test.profitFactor===null?'∞':fmt(x.test.profitFactor)}</td></tr>)}</tbody></table></div>
      <p className="backtest-assumption">Parameter-এর ক্রম নির্ধারণে শুধু Training সময়ের ফল ব্যবহার করা হয়। Candidate বাছাইয়ের পর শেষ ৩০% ডেটা দিয়ে আলাদা পরীক্ষা করা হয়; এই অংশ Ranking-এ ব্যবহার করা হয় না। প্রতিটি Simulation-এর প্রারম্ভিক মূলধন ১০,০০০ USDT, প্রতি Trade-এ Risk Budget ১% এবং Futures Notional সীমা ৩ গুণ। Entry ও Exit—দুই পাশেই Fee ও Slippage ধরা হয়। Funding, Liquidation, Spread, Partial Fill ও Market Impact হিসাবের অন্তর্ভুক্ত নয়। সর্বোচ্চ ৫,০০০টি সাম্প্রতিক Candle ব্যবহার করা হয়।</p>
    </>}
    {history.length>0&&<div className="optimizer-history"><div className="optimizer-history-head"><div><h4>সংরক্ষিত Strategy পরীক্ষার ফল</h4><p>এই Browser-এ সংরক্ষিত · সর্বশেষ ১০টি পরীক্ষা</p></div><button className="icon-btn" title="Clear saved runs" onClick={()=>{if(window.confirm('এই Browser থেকে Strategy Lab-এর সব সংরক্ষিত ফল মুছে ফেলবে?'))setHistory([]);}}><Trash2 size={15}/></button></div><div className="optimizer-history-list">{history.map(item=><button key={item.id} className={`optimizer-history-item ${result?.id===item.id?'active':''}`} onClick={()=>setResult(item)}><span><b>{item.symbol.replace('USDT','')}/USDT · {item.market}</b><small>{item.tf} · {new Date(item.createdAt).toLocaleString()}</small></span><span><b className={(item.ranked[0]?.test.returnPct??0)>=0?'positive':'negative'}>{item.ranked[0]?((item.ranked[0].test.returnPct>=0?'+':'')+fmt(item.ranked[0].test.returnPct)+'%'):'—'}</b><small>সেরা Candidate-এর অদেখা ডেটায় Return</small></span></button>)}</div></div>}\n    <div className="backtest-disclaimer"><ShieldCheck size={14}/> এটি বিভিন্ন Parameter-এর প্রভাব যাচাইয়ের পরীক্ষা; কোনো নিশ্চিত Trading সুবিধার প্রমাণ নয়। অল্প Sample ও অতীতের Market Regime ভুল ধারণা দিতে পারে। সিদ্ধান্ত নেওয়ার আগে অদেখা ডেটার ফল ও Drawdown তুলনা করো।</div>
  </section>;
}


function MultiAssetScanner({market}) {
 const [tfs,setTfs]=useState(['15m','1h','4h']),[fee,setFee]=useState('0.05'),[slip,setSlip]=useState('0.02'),[busy,setBusy]=useState(false),[rows,setRows]=useState([]),[error,setError]=useState(''),[sort,setSort]=useState('returnPct'),[done,setDone]=useState(false);
 const toggle=tf=>setTfs(v=>v.includes(tf)?v.filter(x=>x!==tf):[...v,tf]);
 const run=async()=>{
  if(!tfs.length){setError('অন্তত একটি Timeframe নির্বাচন করো।');return;}
  setBusy(true);setError('');setRows([]);setDone(false);
  const base=market==='Futures'?'https://fapi.binance.com':'https://api.binance.com',path=market==='Futures'?'/fapi/v1/klines':'/api/v3/klines',feeRate=Math.max(0,Math.min(1,+fee||0))/100,slipRate=Math.max(0,Math.min(1,+slip||0))/100;
  const jobs=WATCH.flatMap(a=>tfs.map(tf=>({a,tf}))),all=[];
  try{
   for(let n=0;n<jobs.length;n+=6){
    const batch=await Promise.all(jobs.slice(n,n+6).map(async job=>{
     try{
      const res=await fetch(base+path+'?symbol='+job.a[0]+'&interval='+job.tf+'&limit=500');if(!res.ok)throw Error('HTTP '+res.status);
      const raw=await res.json();if(!Array.isArray(raw)||raw.length<120)throw Error('Not enough candles');
      const d=raw.filter(k=>Number(k[6])<Date.now()&&Number(k[6])>Number(k[0])).map(k=>({time:+k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4]}));
      const avg=(i,len)=>d.slice(i-len+1,i+1).reduce((s,x)=>s+x.close,0)/len;
      const atr=i=>{let v=0;for(let j=i-14;j<=i;j++){let p=d[j-1]?.close??d[j].close;v+=Math.max(d[j].high-d[j].low,Math.abs(d[j].high-p),Math.abs(d[j].low-p));}return v/15;};
      let eq=10000,peak=10000,dd=0,pos=null,trades=[];
      const close=(price)=>{let x=pos.side==='LONG'?price*(1-slipRate):price*(1+slipRate),p=(x-pos.entry)*pos.qty*(pos.side==='LONG'?1:-1)-pos.entry*pos.qty*feeRate-x*pos.qty*feeRate;eq+=p;trades.push(p);pos=null;};
      for(let i=50;i<d.length-1;i++){
       const c=d[i],m20=avg(i,20),m50=avg(i,50),mom=(c.close-d[i-1].close)/d[i-1].close*100;
       let score=50+(c.close>m20?12:-12)+(m20>m50?15:-15)+(mom>.08?8:mom<-.08?-8:0),bias=score>=65?'LONG':score<=35?'SHORT':'WAIT';
       if(pos){let stop=pos.side==='LONG'?c.low<=pos.stop:c.high>=pos.stop,target=pos.side==='LONG'?c.high>=pos.target:c.low<=pos.target;if(stop)close(pos.stop);else if(target)close(pos.target);}
       if(!pos&&bias!=='WAIT'&&(market==='Futures'||bias==='LONG')){let a=atr(i),entry0=d[i+1].open,entry=bias==='LONG'?entry0*(1+slipRate):entry0*(1-slipRate),dist=a*1.5,qty=Math.min(eq*.01/dist,eq*(market==='Futures'?3:1)/(entry*(1+feeRate)));if(Number.isFinite(qty)&&qty>0)pos={side:bias,entry,qty,stop:bias==='LONG'?entry-dist:entry+dist,target:bias==='LONG'?entry+a*3:entry-a*3,entryTime:d[i+1].time};}
       const positionActiveAtClose=pos&&pos.entryTime<=c.time;let marked=eq+(positionActiveAtClose?(c.close-pos.entry)*pos.qty*(pos.side==='LONG'?1:-1)-pos.entry*pos.qty*feeRate:0);peak=Math.max(peak,marked);dd=Math.max(dd,(peak-marked)/peak*100);
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
 const exportCsv=()=>{const fields=['Asset','Symbol','Market','Timeframe','Price','দিক','Score','Return %','সর্বোচ্চ Drawdown %','জয়ের হার %','Trade সংখ্যা','Profit Factor','Candle সংখ্যা','শুরু','শেষ'];const csv=[fields,...rows.map(x=>[x.name,x.symbol,market,x.tf,x.price,x.bias,x.score,x.returnPct,x.maxDD,x.winRate,x.trades,x.pf,x.candles,x.start?new Date(x.start).toISOString():'',x.end?new Date(x.end).toISOString():''])].map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\\r\\n');const blob=new Blob(['\\ufeff'+csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='cryptobot-multi-asset.csv';a.click();URL.revokeObjectURL(url);};
 return <section className="panel multi-scanner-panel">
  <div className="panel-title"><div><h3>একাধিক Asset-এর Strategy Scanner</h3><p>Watchlist-এর ১২টি Asset-এ একই SMA 20/50, Momentum ও ATR নিয়ম প্রয়োগ করা হয়</p></div><span className="tiny-live">RESEARCH MODE</span></div>
  <div className="scanner-controls"><div className="scanner-control-group"><span>টাইমফ্রেম</span><div className="scanner-chips">{['5m','15m','1h','4h','1d'].map(tf=><button key={tf} className={tfs.includes(tf)?'active':''} onClick={()=>toggle(tf)}>{tf}</button>)}</div></div><label>ফি (%)<input type="number" min="0" max="1" step="0.01" value={fee} onChange={e=>setFee(e.target.value)}/></label><label>Slippage (%)<input type="number" min="0" max="1" step="0.01" value={slip} onChange={e=>setSlip(e.target.value)}/></label><button className="primary-btn" disabled={busy} onClick={run}><Play size={14}/>{busy?'Scan চলছে…':'Market Scan চালাও'}</button></div>
  {error&&<div className="backtest-error">{error}</div>}
  {busy&&<div className="scanner-progress"><span>প্রক্রিয়াকরণ হয়েছে {rows.length} / {WATCH.length*tfs.length} asset/timeframe pairs</span><div><i style={{width:(rows.length/(WATCH.length*tfs.length)*100)+'%'}}/></div></div>}
  {done&&<div className="scanner-summary"><span>{rows.filter(x=>!x.error).length} / {rows.length}টি Pair Scan হয়েছে · {market}</span><button className="secondary-btn" onClick={exportCsv}><Download size={14}/> CSV Export</button></div>}
  {rows.length>0&&<div className="backtest-table-wrap"><table className="backtest-table scanner-table"><thead><tr><th>Asset</th><th>TF</th><th>Price</th><th>বর্তমান দিক</th><th>Score</th><th><button onClick={()=>setSort('returnPct')}>Return ↕</button></th><th><button onClick={()=>setSort('maxDD')}>সর্বোচ্চ Drawdown ↕</button></th><th><button onClick={()=>setSort('winRate')}>জয়ের হার ↕</button></th><th>Trades</th><th>PF</th></tr></thead><tbody>{sorted.map(x=><tr key={x.symbol+x.tf}><td><b>{x.ticker}</b><small>{x.name}</small></td><td>{x.tf}</td>{x.error?<td colSpan="8" className="negative">{x.error}</td>:<><td>{"$"+fmt(x.price,x.price<1?6:3)}</td><td><span className={'scanner-bias '+x.bias.toLowerCase()}>{x.bias}</span></td><td>{x.score}/100</td><td className={x.returnPct>=0?'positive':'negative'}>{x.returnPct>=0?'+':''}{fmt(x.returnPct)}%</td><td className="negative">{fmt(x.maxDD)}%</td><td>{fmt(x.winRate)}%</td><td>{x.trades}</td><td>{x.pf===null?'∞':fmt(x.pf)}</td></>}</tr>)}</tbody></table></div>}
  <p className="backtest-assumption">প্রতিটি Pair-এর জন্য Binance-এর সর্বশেষ ৫০০টি পর্যন্ত Candle ব্যবহার করা হয়; CSV-তে প্রকৃত সময়সীমা থাকে। প্রতিটি Simulation ১০,০০০ USDT দিয়ে শুরু হয়, প্রতি Trade-এ ১% Risk নেয়, ATR-এর ১.৫ গুণ Stop ও ৩ গুণ Target ব্যবহার করে এবং Entry/Exit—দুই পাশে Fee ও Slippage ধরে। Futures-এ Notional সীমা ৩ গুণ। Funding, Liquidation, Spread ও Partial Fill হিসাব করা হয় না।</p>
  <div className="backtest-disclaimer"><ShieldCheck size={14}/> এগুলো শুধু অতীতের ডেটার তুলনা। বর্তমান LONG/SHORT লেবেল নিয়মভিত্তিক Snapshot—ভবিষ্যদ্বাণী বা বিনিয়োগের পরামর্শ নয়। কোনো Strategy-এর বাড়তি সুবিধা বা ভবিষ্যৎ লাভ প্রমাণিত নয়।</div>
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
  <div className="panel-title"><div><h3>Market Regime শনাক্তকরণ</h3><p>ADX দিয়ে Trend-এর শক্তি · ATR দিয়ে Volatility-এর অবস্থান · Bollinger Band-এর প্রস্থ · শুধু সম্পূর্ণ হওয়া Candle</p></div><span className="tiny-live">MARKET CONTEXT</span></div>
  <div className="scanner-controls"><div className="scanner-control-group"><span>Timeframe</span><div className="scanner-chips">{['15m','1h','4h','1d'].map(x=><button key={x} className={tf===x?'active':''} onClick={()=>setTf(x)}>{x}</button>)}</div></div><button className="primary-btn" disabled={busy} onClick={run}><Play size={14}/>{busy?'বিশ্লেষণ চলছে…':'Market Regime শনাক্ত করো'}</button></div>
  {error&&<div className="backtest-error">{error}</div>}
  {busy&&<div className="scanner-progress"><span>বিশ্লেষণ হয়েছে {rows.length} / {WATCH.length}টি Market</span><div><i style={{width:(rows.length/WATCH.length*100)+'%'}}/></div></div>}
  {done&&<><div className="regime-counts">{counts.map(x=><div key={x.name}><span>{regimeLabel(x.name)}</span><b>{x.count}</b></div>)}</div><div className="scanner-summary"><span>{rows.filter(x=>!x.error).length} / {rows.length} assets · Binance {market} · {tf}</span><span>সর্বশেষ হালনাগাদ {new Date().toLocaleTimeString()}</span></div></>}
  {rows.length>0&&<div className="backtest-table-wrap"><table className="backtest-table regime-table"><thead><tr><th>Asset</th><th>Regime</th><th>Direction</th><th><button onClick={()=>setSort('adx')}>ADX ↕</button></th><th><button onClick={()=>setSort('atrPct')}>ATR % ↕</button></th><th>ATR rank</th><th>BB width</th><th>Price</th></tr></thead><tbody>{sorted.map(x=><tr key={x.symbol}>{x.error?<><td><b>{x.ticker}</b></td><td colSpan="7" className="negative">{x.error}</td></>:<><td><b>{x.ticker}</b><small>{x.name}</small></td><td><span className={'scanner-bias '+regimeClass(x.regime)}>{regimeLabel(x.regime)}</span></td><td>{directionLabel(x.direction)}</td><td>{fmt(x.adx,1)}</td><td>{fmt(x.atrPct,3)}%</td><td>{fmt(x.atrRank,0)}th</td><td>{fmt(x.bbWidth,2)}%</td><td>{'$'+fmt(x.price,x.price<1?6:3)}</td></>}</tr>)}</tbody></table></div>}
  <div className="regime-guide"><b>Market Regime নির্ধারণের নিয়ম</b><span><strong>Trend চলমান:</strong> ADX ≥ ২২ এবং Moving Average-এর পার্থক্য একই দিক নির্দেশ করে।</span><span><strong>একটি সীমার মধ্যে:</strong> ADX ১৮-এর নিচে।</span><span><strong>অতিরিক্ত Volatility:</strong> ATR Percentile ≥ ৮০ অথবা ATR% সাম্প্রতিক Median-এর অন্তত ১.৬ গুণ।</span><span><strong>পরিবর্তনশীল অবস্থা:</strong> শর্তগুলো মিশ্র; পরিষ্কার Market Structure না পাওয়া পর্যন্ত অপেক্ষা করো।</span></div>
  <p className="backtest-assumption">Watchlist-এর ১২টি Asset · প্রতি Market-এ সর্বোচ্চ ২১৯টি সম্পূর্ণ Candle। Indicator বর্তমান অবস্থা দেখায়; Market Regime দ্রুত বদলাতে পারে। অতিরিক্ত Volatility ঝুঁকির সতর্কতা, Trade Signal নয়। এই অংশ কোনো Trade খোলে না।</p>
 </section>;
}


function MarketStructureScanner({market}) {
 const [tf,setTf]=useState('15m'),[busy,setBusy]=useState(false),[rows,setRows]=useState([]),[error,setError]=useState(''),[selected,setSelected]=useState('BTCUSDT');
 const scan=async()=>{setBusy(true);setError('');setRows([]);const base=market==='Futures'?'https://fapi.binance.com':'https://api.binance.com',ep=market==='Futures'?'/fapi/v1/klines':'/api/v3/klines',out=[];
 try{for(let n=0;n<WATCH.length;n+=4){const batch=await Promise.all(WATCH.slice(n,n+4).map(async a=>{try{
 const r=await fetch(base+ep+'?symbol='+a[0]+'&interval='+tf+'&limit=300');if(!r.ok)throw Error('Binance HTTP '+r.status);const raw=await r.json();if(raw.length<80)throw Error('Insufficient candles');
 const d=raw.slice(0,-1).map(k=>({time:+k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4]})),piv=findConfirmedSwingPivots(d,3);
 const highs=piv.filter(x=>x.type==='H'),lows=piv.filter(x=>x.type==='L');
  const last=d.at(-1),events=evaluateStructureEvent(d,piv),structure=events.structure+' Structure';
  const bos=events.bos==='NONE'?'—':events.bos+' '+(events.choch!=='NONE'?'CHoCH':'BOS');
  const choch=events.choch==='NONE'?'—':events.choch+' CHoCH';
  const sweep=events.sweep==='NONE'?'NONE':events.sweep+' Sweep';
 const near=(xs)=>xs.filter(x=>x.index>=d.length-100).sort((x,y)=>Math.abs(x.price-last.close)-Math.abs(y.price-last.close))[0]?.price??null;
 let fvg=null;for(let i=Math.max(2,d.length-80);i<d.length-1;i++){if(d[i].low>d[i-2].high)fvg={type:'BULLISH FVG',low:d[i-2].high,high:d[i].low};if(d[i].high<d[i-2].low)fvg={type:'BEARISH FVG',low:d[i].high,high:d[i-2].low};}
 let ob=null;if(events.bos!=='NONE'){const bullishBreak=events.bos==='BULLISH';for(let i=d.length-2;i>=Math.max(0,d.length-25);i--){if((bullishBreak&&d[i].close<d[i].open)||(!bullishBreak&&d[i].close>d[i].open)){ob={type:bullishBreak?'BULLISH OB':'BEARISH OB',low:d[i].low,high:d[i].high};break;}}}
 return {symbol:a[0],ticker:a[2],name:a[1],price:last.close,structure,bos,choch,sweep,support:near(lows),resistance:near(highs),fvg,ob,candles:d.length,time:last.time};
 }catch(e){return {symbol:a[0],ticker:a[2],error:e.message};}}));out.push(...batch);setRows([...out]);}if(!out.some(x=>x.symbol===selected&&!x.error))setSelected(out.find(x=>!x.error)?.symbol||'BTCUSDT');
 }catch(e){setError(e.message||'Scan failed');}finally{setBusy(false);}};
 const active=rows.find(x=>x.symbol===selected)||rows.find(x=>!x.error);
 const money=v=>v==null?'—':'$'+fmt(v,v<1?6:3);
 const exportCsv=()=>{const h=['Symbol','Price','Structure','BOS','CHoCH','Liquidity Sweep','Support','Resistance','FVG','Order Block'];const data=rows.map(x=>[x.symbol,x.price,x.structure,x.bos,x.choch,x.sweep,x.support,x.resistance,x.fvg?.type,x.ob?.type]);const blob=new Blob([h.concat(data).map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\n')],{type:'text/csv'});const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='cryptobot-structure-'+tf+'.csv';a.click();URL.revokeObjectURL(u);};
 return <section className="panel structure-panel">
 <div className="panel-title"><div><h3>Market Structure ও Liquidity</h3><p>BOS / CHoCH · Swing Pivot · Liquidity Sweep · FVG · Order Block</p></div><span className="tiny-live">PRICE ACTION</span></div>
 <div className="scanner-controls"><div className="scanner-control-group"><span>Timeframe</span><div className="scanner-chips">{['5m','15m','1h','4h','1d'].map(x=><button key={x} className={tf===x?'active':''} onClick={()=>setTf(x)}>{x}</button>)}</div></div><button className="primary-btn" disabled={busy} onClick={scan}><Play size={14}/>{busy?'Scan চলছে…':'Market Structure Scan করো'}</button>{rows.length>0&&<button className="secondary-btn" onClick={exportCsv}><Download size={14}/> CSV Export</button>}</div>
 {error&&<div className="backtest-error">{error}</div>}
 {busy&&<div className="scanner-progress"><span>প্রক্রিয়াকরণ হয়েছে {rows.length} / {WATCH.length}</span><div><i style={{width:rows.length/WATCH.length*100+'%'}}/></div></div>}
 {rows.length>0&&<><div className="scanner-summary"><span>{rows.filter(x=>!x.error).length} assets · Binance {market} · {tf}</span><span>শুধু সম্পূর্ণ হওয়া Candle</span></div><div className="backtest-table-wrap"><table className="backtest-table structure-table"><thead><tr><th>Asset</th><th>Structure</th><th>BOS</th><th>CHoCH</th><th>Liquidity Sweep</th><th>Price</th></tr></thead><tbody>{rows.map(x=><tr key={x.symbol} onClick={()=>!x.error&&setSelected(x.symbol)} className={selected===x.symbol?'structure-selected':''}><td><b>{x.ticker}</b></td>{x.error?<td colSpan="5" className="negative">{x.error}</td>:<><td>{structureLabel(x.structure)}</td><td>{structureLabel(x.bos)}</td><td>{structureLabel(x.choch)}</td><td>{structureLabel(x.sweep)}</td><td>{money(x.price)}</td></>}</tr>)}</tbody></table></div></>}
 {active&&!active.error&&<div className="structure-detail"><div className="structure-detail-head"><div><b>{active.name} / USDT</b><small>{active.ticker} · {tf} · {active.candles} টি সম্পূর্ণ Candle</small></div><b>{money(active.price)}</b></div><div className="structure-levels"><div><span>নিকটতম Support</span><b>{money(active.support)}</b></div><div><span>নিকটতম Resistance</span><b>{money(active.resistance)}</b></div><div><span>সর্বশেষ FVG</span><b>{structureLabel(active.fvg?.type)||'পাওয়া যায়নি'}</b><small>{active.fvg?money(active.fvg.low)+' – '+money(active.fvg.high):'সাম্প্রতিক Gap নেই'}</small></div><div><span>Order Block নির্ণয়ের পদ্ধতি</span><b>{structureLabel(active.ob?.type)||'সাম্প্রতিক BOS নেই'}</b><small>{active.ob?money(active.ob.low)+' – '+money(active.ob.high):'উপযুক্ত Candle পাওয়া যায়নি'}</small></div></div></div>}
 <div className="regime-guide"><b>Scan যেভাবে কাজ করে</b><span><strong>BOS:</strong> সম্পূর্ণ হওয়া Candle নিশ্চিত Swing Pivot-এর বাইরে Close হলে সেটি শনাক্ত হয়।</span><span><strong>CHoCH:</strong> সাম্প্রতিক Pivot Trend-এর বিপরীতে Break; এটি Trend পরিবর্তনের নিশ্চিত প্রমাণ নয়।</span><span><strong>Liquidity Sweep:</strong> Candle-এর Wick আগের Swing অতিক্রম করে আবার ভেতরে Close হলে সেটি শনাক্ত হয়।</span><span><strong>FVG:</strong> তিনটি Candle-এর মধ্যে তৈরি Gap। Order Block হলো Break-এর আগে বিপরীত দিকের শেষ Candle-কে সরল নিয়মে চিহ্নিত করা।</span><span>প্রতিটি Swing Pivot নিশ্চিত করতে ডান পাশে আরও তিনটি সম্পূর্ণ Candle প্রয়োজন।</span></div>
 <p className="backtest-assumption">এটি নিয়মভিত্তিক আনুমানিক বিশ্লেষণ; প্রকৃত Order Flow বা অপেক্ষমাণ Order-এর ডেটা নয়। Liquidation Cluster বা প্রাতিষ্ঠানিক Position পড়া হয় না। Support/Resistance দ্রুত ভেঙে যেতে পারে; কোনো Trade খোলা হয় না।</p>
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
    <div className="panel-title"><div><h3>Live Derivatives ও Order Flow</h3><p>{symbol.replace('USDT','')}/USDT · Binance Futures Public API</p></div><span className={'tiny-live '+(status==='LIVE'?'':'data-status-warn')}>{status}</span></div>
    <div className="public-data-grid">
      <div className="public-data-card"><span>Order Book-এর Bid Value</span><b className="positive">{data.bids!==null?String.fromCharCode(36)+money(data.bids):'—'}</b><small>শীর্ষ ২০টি Bid Level</small></div>
      <div className="public-data-card"><span>Order Book-এর Ask Value</span><b className="negative">{data.asks!==null?String.fromCharCode(36)+money(data.asks):'—'}</b><small>শীর্ষ ২০টি Ask Level</small></div>
      <div className="public-data-card"><span>সামগ্রিক Long / Short অনুপাত</span><b>{ratioText(data.globalRatio)}</b><small>Account · ৫ মিনিট</small></div>
      <div className="public-data-card"><span>শীর্ষ Trader-এর Position অনুপাত</span><b>{ratioText(data.topRatio)}</b><small>Position · ৫ মিনিট</small></div>
      <div className="public-data-card"><span>Taker Buy / Sell অনুপাত</span><b>{ratioText(data.takerRatio)}</b><small>১-এর বেশি = Taker Buy Volume বেশি</small></div>
      <div className="public-data-card"><span>Open Interest-এর পরিবর্তন</span><b className={data.oiChange===null?'':data.oiChange>=0?'positive':'negative'}>{data.oiChange===null?'—':(data.oiChange>=0?'+':'')+data.oiChange.toFixed(3)+'%'}</b><small>সর্বশেষ ৫ মিনিট বনাম আগের ৫ মিনিট</small></div>
    </div>
    <div className="depth-balance"><div><span>Order Book Depth-এর ভারসাম্য</span><b>{depthTotal?bidPct.toFixed(1)+'% bids / '+(100-bidPct).toFixed(1)+'% asks':'Depth ডেটার অপেক্ষায়'}</b></div><div className="depth-track"><i style={{width:bidPct+'%'}}/></div></div>
    {error&&<p className="public-data-error">{error}</p>}
    <div className="liquidation-head"><div><b>সাম্প্রতিক Liquidation Feed</b><small>নির্বাচিত Symbol-এর Binance Force-Order Stream · শুধু Live Event</small></div><span>{liquidations.length}টি Event</span></div>
    {liquidations.length===0?<div className="liquidation-empty">Liquidation Event-এর অপেক্ষায়। এখানে কোনো Event না দেখালেই পুরো Market-এ Liquidation হয়নি—এমন নয়।</div>:<div className="liquidation-list">{liquidations.map(x=><div className="liquidation-row" key={x.id}><b className={x.side.startsWith('LONG')?'negative':'positive'}>{liquidationLabel(x.side)}</b><span>{x.qty.toLocaleString('en-US',{maximumFractionDigits:4})} {symbol.replace('USDT','')}</span><span>{String.fromCharCode(36)}{x.price.toLocaleString('en-US',{maximumFractionDigits:5})}</span><small>{x.time.toLocaleTimeString()}</small></div>)}</div>}
    <p className="public-data-foot">সর্বশেষ হালনাগাদ: {data.updated?data.updated.toLocaleTimeString():'Waiting…'} · Public API দেরি করতে পারে, Rate Limit-এ পড়তে পারে অথবা সাময়িক বন্ধ থাকতে পারে। Order Book শুধু শীর্ষ ২০টি Level-এর Snapshot, পুরো Market-এর Liquidity নয়। Liquidation Feed-ও পুরো Market-এর সম্পূর্ণ ইতিহাস দেখায় না।</p>
  </section>;
}




function evaluateTimeframe(candles,timeframe) {
  const rows=candles.filter(k=>Number(k[6])<Date.now()&&Number(k[6])>Number(k[0])).map(k=>({time:+k[0],closeTime:+k[6],open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5],takerBuy:+(k[9]||0)}));
  if(rows.length<60)throw new Error('কমপক্ষে ৬০টি সম্পূর্ণ Candle প্রয়োজন');
  const closes=rows.map(x=>x.close),ema=period=>{const alpha=2/(period+1);let value=closes.slice(0,period).reduce((a,b)=>a+b,0)/period;for(let i=period;i<closes.length;i++)value=closes[i]*alpha+value*(1-alpha);return value;};
  const indicators=calculateWilderIndicators(rows,14),last=rows.at(-1),previous=rows.at(-2),flow=calculateCandleFlow(rows,20),e20=ema(20),e50=ema(50);
  const trend=last.close>e20&&e20>e50?'BULLISH':last.close<e20&&e20<e50?'BEARISH':'MIXED';
  const pivots=findConfirmedSwingPivots(rows,3),{structure,bos,choch,sweep}=evaluateStructureEvent(rows,pivots),frameMs=TIMEFRAME_INTERVAL_MS[timeframe];
  const recent=rows.slice(-6),candleGaps=recent.slice(1).filter((x,i)=>x.time-recent[i].time!==frameMs).length;
  return {trend,rsi:indicators.rsi,volumeRatio:flow.volumeRatio,close:last.close,ema20:e20,ema50:e50,momentum:(last.close-previous.close)/previous.close*100,candles:rows.length,adx:indicators.adx,atrPct:indicators.atr/last.close*100,atr:indicators.atr,candleTime:last.time,closeTime:last.closeTime,candleGaps,structure,bos,choch,sweep,takerRatio:flow.takerRatio,flowValid:flow.valid};
}

function MultiTimeframeSignal({symbol,market,onSignal,timeframeMode='AUTO',onTimeframeModeChange=()=>{},onTimeframeChange=()=>{}}) {
  const [snapshot,setSnapshot]=useState(null),[result,setResult]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [tracked,setTracked]=useState(()=>{try{return JSON.parse(localStorage.getItem('cryptobot.liveSignalLog')||'[]');}catch{return [];}});
  useEffect(()=>{onSignal?.(result);},[result,onSignal]);
  useEffect(()=>{
    let live=true,busy=false;
    const run=async()=>{
      if(busy)return;busy=true;setLoading(true);setError('');
      try{
        const base=market==='Futures'?'https://fapi.binance.com':'https://api.binance.com',path=market==='Futures'?'/fapi/v1/klines':'/api/v3/klines',frames=['1w','1d','4h','1h','15m','5m'];
        const fetched=await Promise.all(frames.map(async tf=>{try{const raw=await fetchJsonWithRetry(base+path+'?symbol='+symbol+'&interval='+tf+'&limit=120');if(!Array.isArray(raw))throw new Error('Invalid candle payload');return {tf,value:evaluateTimeframe(raw,tf)};}catch(e){return {tf,error:e.message||'Data unavailable'};}}));
        if(!live)return;
        const data=Object.fromEntries(fetched.filter(x=>x.value).map(x=>[x.tf,x.value])),frameErrors=Object.fromEntries(fetched.filter(x=>x.error).map(x=>[x.tf,x.error]));
        const requestedAt=Date.now();let depth=null;
        try{const book=await fetchJsonWithRetry(base+(market==='Futures'?'/fapi/v1/depth':'/api/v3/depth')+'?symbol='+symbol+'&limit=20',{attempts:2,timeoutMs:7000});depth=calculateOrderBookDepth(book,{requestedAt,receivedAt:Date.now(),maxRequestMs:8000});}catch{}
        const {bidValue=null,askValue=null,depthRatio=null}=depth?.ok?depth:{};
        let externalTakerRatio=null;
        if(market==='Futures'){try{const r=await fetch('https://fapi.binance.com/futures/data/takerlongshortRatio?symbol='+symbol+'&period=5m&limit=1',{cache:'no-store'});if(r.ok){const v=(await r.json())?.[0];if(v&&Date.now()-Number(v.timestamp)<=600000)externalTakerRatio=Number(v.buySellRatio);}}catch{}}
        if(!live)return;
        const now=Date.now(),evaluations=Object.fromEntries(Object.entries(TIMEFRAME_PROFILES).map(([tf,profile])=>{
          const required=Object.values(profile),stale=required.filter(frame=>{const x=data[frame],ms=TIMEFRAME_INTERVAL_MS[frame];return !x||!Number.isFinite(x.closeTime)||now-x.closeTime>ms+120000||x.candleGaps>0;});
          const roleData=buildTimeframeRoleData(data,tf);
          if(!roleData||stale.length)return [tf,{timeframe:tf,decision:'NO TRADE',score:0,status:'BLOCKED',reasons:['প্রয়োজনীয় '+stale.map(x=>x.toUpperCase()).join(', ')+' ডেটা অনুপস্থিত, পুরোনো অথবা Candle gap আছে।'],gates:{data:false}}];
          const entryFrame=data[profile.entry],frameLabels={contextSlow:profile.contextSlow,contextFast:profile.contextFast,setup:profile.setup,entry:profile.entry};
          const evaluated=evaluateMtfDecision({data:roleData,flow:{takerRatio:entryFrame.takerRatio,depthRatio},flowMode:'live',entry:entryFrame.close,market,frameLabels});
          return [tf,{...evaluated,timeframe:tf,entryFrame,status:'READY'}];
        }));
        setSnapshot({symbol,market,data,evaluations,flow:{bidValue,askValue,depthRatio,takerRatio:data['5m']?.takerRatio??null,externalTakerRatio,depthRequestMs:depth?.requestDurationMs??null,depthAvailable:Boolean(depth?.ok)},updated:new Date(),status:Object.values(evaluations).some(x=>x.status==='READY')?'READY':'BLOCKED'});
      }catch(e){if(live){setError('বিশ্লেষণ সম্পন্ন হয়নি: '+(e.message||'Binance ডেটা পাওয়া যায়নি।'));setSnapshot({symbol,market,data:{},evaluations:{},flow:null,updated:new Date(),status:'BLOCKED'});}}
      finally{busy=false;if(live)setLoading(false);}
    };
    setSnapshot(null);setResult(null);run();const timer=window.setInterval(run,60000);return()=>{live=false;clearInterval(timer);};
  },[symbol,market]);

  useEffect(()=>{
    if(!snapshot||snapshot.symbol!==symbol||snapshot.market!==market)return;
    const picked=selectBestTimeframeSignal(snapshot.evaluations,timeframeMode),tf=picked.selectedTimeframe,candidate=tf?snapshot.evaluations[tf]:null,best=picked.bestCandidate?snapshot.evaluations[picked.bestCandidate]:null;
    const next={...snapshot,...picked,selectedTimeframe:tf,decision:picked.decision||'NO TRADE',score:picked.score??best?.score??0,riskPlan:candidate?.riskPlan??null,gates:candidate?.gates??null,reasons:picked.reasons?.length?picked.reasons:(candidate?.reasons||best?.reasons||['NO TRADE']),status:snapshot.status,selectionStatus:picked.selectionStatus,flow:{...snapshot.flow,takerRatio:candidate?.entryFrame?.takerRatio??null}};
    setResult(next);
    if(next.status==='READY'&&(next.decision==='LONG'||next.decision==='SHORT')&&candidate?.entryFrame){
      const entryFrame=candidate.entryFrame,id=symbol+'_'+market+'_'+tf+'_'+entryFrame.candleTime;
      setTracked(prev=>{let list=prev.filter(x=>x.status==='PENDING'||Date.now()-x.createdAt<30*86400000);if(entryFrame.candleTime&&!list.some(x=>x.id===id)){const entry=applyAdverseSlippage(entryFrame.close,next.decision,'Entry',0.0002),atr=entryFrame.atr;list.unshift({id,symbol,market,timeframe:tf,side:next.decision,entry,referenceEntry:entryFrame.close,entryType:'COMPLETED_'+tf.toUpperCase()+'_CLOSE',feeRate:0.0005,slippageRate:0.0002,stop:next.decision==='LONG'?entry-atr*1.5:entry+atr*1.5,target:next.decision==='LONG'?entry+atr*3:entry-atr*3,atr,candleTime:entryFrame.candleTime,createdAt:Date.now(),score:next.score,status:'PENDING',bars:0});}list=list.slice(0,200);try{localStorage.setItem('cryptobot.liveSignalLog',JSON.stringify(list));}catch{}return list;});
    }
  },[snapshot,timeframeMode,symbol,market]);

  useEffect(()=>{
    let live=true;const pending=tracked.filter(x=>x.status==='PENDING'&&x.symbol===symbol&&x.market===market);if(!pending.length)return;
    const groups=new Map();pending.forEach(x=>{const tf=x.timeframe||'5m';if(!groups.has(tf))groups.set(tf,[]);groups.get(tf).push(x);});
    (async()=>{try{
      const entries=await Promise.all([...groups].map(async([tf,signals])=>{const ms=TIMEFRAME_INTERVAL_MS[tf]||300000,base=market==='Futures'?'https://fapi.binance.com':'https://api.binance.com',path=market==='Futures'?'/fapi/v1/klines':'/api/v3/klines',start=Math.min(...signals.map(x=>x.candleTime))+ms,raw=await fetchJsonWithRetry(base+path+'?symbol='+symbol+'&interval='+tf+'&startTime='+start+'&limit=1000',{attempts:2,timeoutMs:10000});return [tf,Array.isArray(raw)?raw.filter(k=>Number(k[6])<Date.now()).sort((a,b)=>Number(a[0])-Number(b[0])):[]];}));
      if(!live)return;const series=new Map(entries);
      setTracked(prev=>{let changed=false;const next=prev.map(sig=>{
        if(sig.status!=='PENDING'||sig.symbol!==symbol||sig.market!==market)return sig;
        const tf=sig.timeframe||'5m',ms=TIMEFRAME_INTERVAL_MS[tf]||300000,candles=series.get(tf)||[];let bars=sig.bars,exit=null,reason=null,review=false,expected=sig.candleTime+ms;
        for(const k of candles){const t=Number(k[0]);if(t<expected)continue;if(t!==expected){review=true;break;}bars++;const hi=Number(k[2]),lo=Number(k[3]),close=Number(k[4]),stop=sig.side==='LONG'?lo<=sig.stop:hi>=sig.stop,target=sig.side==='LONG'?hi>=sig.target:lo<=sig.target;if(stop){exit=sig.stop;reason='স্টপ লস';break;}if(target){exit=sig.target;reason='টেক প্রফিট';break;}if(bars>=12){exit=close;reason='12-CANDLE TIME Exit';break;}expected+=ms;}
        if(review){changed=true;return {...sig,bars,status:'REVIEW',reason:'DATA GAP — outcome not scored',reviewedAt:Date.now()};}
        if(!exit){if(bars!==sig.bars){changed=true;return {...sig,bars};}return sig;}
        const fill=applyAdverseSlippage(exit,sig.side,'EXIT',Number(sig.slippageRate??0.0002)),account=calculateTradePnl({side:sig.side,entry:sig.entry,exit:fill,quantity:1,feeRate:Number(sig.feeRate??0.0005)});
        if(!account.ok){changed=true;return {...sig,bars,status:'REVIEW',reason:'INVALID TRADE ACCOUNTING — outcome not scored',reviewedAt:Date.now()};}
        changed=true;return {...sig,bars,exit:fill,rawExit:exit,reason,grossPct:account.grossPnl/sig.entry*100,netPct:account.netPnl/sig.entry*100,entryFeePct:account.entryFee/sig.entry*100,exitFeePct:account.exitFee/sig.entry*100,status:'CLOSED',closedAt:Date.now()};
      });if(changed){try{localStorage.setItem('cryptobot.liveSignalLog',JSON.stringify(next));}catch{}return next;}return prev;});
    }catch{}})();return()=>{live=false;};
  },[symbol,market,tracked.filter(x=>x.status==='PENDING'&&x.symbol===symbol&&x.market===market).map(x=>x.id+':'+x.bars).join('|')]);

  const closedTracked=tracked.filter(x=>x.status==='CLOSED'),trackedWins=closedTracked.filter(x=>x.netPct>0).length,trackedNet=closedTracked.reduce((s,x)=>s+x.netPct,0),ratio=n=>n==null||!Number.isFinite(n)?'—':n.toFixed(2)+'x';
  const rows=result?.data?['1w','1d','4h','1h','15m','5m'].filter(tf=>result.data[tf]).map(tf=>[tf,result.data[tf]]):[];
  return <section className="panel mtf-panel">
    <div className="panel-title"><div><h3>উন্নত Multi-Timeframe Signal Engine</h3><p>Higher timeframe context → setup → entry · Auto Best অথবা Manual timeframe · প্রতি ৬০ সেকেন্ডে হালনাগাদ</p></div><span className={'tiny-live '+(result?.status==='READY'?'':'data-status-warn')}>{loading?'SCANNING':result?.selectionStatus==='CONFLICT'?'CONFLICT':result?.status||'WAITING'}</span></div>
    <div className="mtf-timeframe-controls"><span>Signal Timeframe</span><div className="scanner-chips"><button className={timeframeMode==='AUTO'?'active':''} onClick={()=>onTimeframeModeChange('AUTO')}>AUTO BEST</button>{Object.keys(TIMEFRAME_PROFILES).map(tf=><button key={tf} className={timeframeMode===tf?'active':''} onClick={()=>{onTimeframeModeChange(tf);onTimeframeChange(tf);}}>{tf.toUpperCase()}</button>)}</div><small>{timeframeMode==='AUTO'?'সব Candidate যাচাই করে যোগ্য Signal-এর মধ্যে সেরা Timeframe নির্বাচন করা হয়।':'Manual mode: নির্বাচিত Timeframe-এর Signal যাচাই করা হচ্ছে।'}</small></div>
    <div className="mtf-candidate-grid">{Object.keys(TIMEFRAME_PROFILES).map(tf=>{const candidate=result?.evaluations?.[tf],side=candidate?.decision||'NO TRADE';return <div key={tf} className={'mtf-candidate '+(result?.selectedTimeframe===tf?'selected':'')}><div><b>{tf.toUpperCase()}</b><span className={'scanner-bias '+(side==='LONG'?'long':side==='SHORT'?'short':'wait')}>{side}</span></div><strong>{candidate?.score??0}/100</strong><small>{candidate?.status==='READY'?'Context '+TIMEFRAME_PROFILES[tf].contextSlow.toUpperCase()+' / '+TIMEFRAME_PROFILES[tf].contextFast.toUpperCase():'ডেটা প্রস্তুত নয়'}</small></div>;})}</div>
    <div className="mtf-decision"><div><span>Engine-এর সিদ্ধান্ত</span><b className={result?.decision==='LONG'?'positive':result?.decision==='SHORT'?'negative':''}>{result?.decision||'NO TRADE'}</b></div><div><span>সম্মিলিত শর্তের Score</span><b>{result?.score??0}/100</b></div><div><span>নির্বাচিত Timeframe</span><b>{result?.selectedTimeframe?.toUpperCase()||'—'}</b></div></div>
    <div className="mtf-table-wrap"><table className="mtf-table"><thead><tr><th>Timeframe</th><th>Trend</th><th>ADX</th><th>Structure</th><th>BOS</th><th>CHoCH</th><th>Sweep</th><th>RSI</th><th>Volume / গড়</th></tr></thead><tbody>{rows.map(([tf,x])=><tr key={tf} className={tf===result?.selectedTimeframe?'selected-timeframe':''}><td>{tf.toUpperCase()}</td><td className={x.trend==='BULLISH'?'positive':x.trend==='BEARISH'?'negative':''}>{trendLabel(x.trend)}</td><td>{fmt(x.adx,1)}</td><td>{structureLabel(x.structure)}</td><td>{structureLabel(x.bos==='NONE'?'—':x.bos)}</td><td>{structureLabel(x.choch==='NONE'?'—':x.choch)}</td><td>{structureLabel(x.sweep==='NONE'?'—':x.sweep)}</td><td>{fmt(x.rsi,1)}</td><td>{fmt(x.volumeRatio,2)}x</td></tr>)}</tbody></table></div>
    {result?.flow&&<div className="public-data-grid mtf-flow-grid"><div className="public-data-card"><span>Taker Buy / Sell</span><b>{ratio(result.flow.takerRatio)}</b><small>সম্পূর্ণ {(result?.selectedTimeframe||'5m').toUpperCase()} Candle · Taker Buy Base Volume</small></div><div className="public-data-card"><span>শীর্ষ ২০টি Depth-এর Bid / Ask</span><b>{ratio(result.flow.depthRatio)}</b><small>শীর্ষ ২০টি Level-এর Snapshot · {result.flow.depthRequestMs}ms request · সম্পূর্ণ Order Flow নয়</small></div><div className="public-data-card"><span>ADX-এর অবস্থা</span><b>{result.selectedTimeframe&&result.data?.[TIMEFRAME_PROFILES[result.selectedTimeframe].contextSlow]?.adx>=15&&result.data?.[TIMEFRAME_PROFILES[result.selectedTimeframe].contextFast]?.adx>=15?'Trend-এর জন্য গ্রহণযোগ্য':'দুর্বল / মিশ্র'}</b><small>ADX Trend-এর শক্তি মাপে, দিক নয়</small></div></div>}
    {error&&<p className="public-data-error">{error}</p>}
    <div className="public-data-grid mtf-flow-grid"><div className="public-data-card"><span>সংরক্ষিত Live Signal</span><b>{tracked.length}</b><small>এই Browser-এ সংরক্ষিত</small></div><div className="public-data-card"><span>বন্ধ Signal-এর জয়ের হার</span><b>{closedTracked.length?fmt(trackedWins/closedTracked.length*100,1)+'%':'—'}</b><small>{closedTracked.length}টি নিষ্পত্তি হয়েছে · {tracked.filter(x=>x.status==='REVIEW').length}টি পুনরায় যাচাই প্রয়োজন</small></div><div className="public-data-card"><span>সংরক্ষিত Signal-এর নিট Return</span><b className={trackedNet>=0?'positive':'negative'}>{closedTracked.length?(trackedNet>=0?'+':'')+fmt(trackedNet,2)+'%':'—'}</b><small>সমান ওজনের Price Return-এর আনুমানিক হিসাব</small></div></div>
    {tracked.length>0&&<div className="mtf-reasons">{tracked.slice(0,8).map(x=><span key={x.id}>{x.symbol} {x.side} · {(x.timeframe||'5m').toUpperCase()} · {x.status==='PENDING'?'অপেক্ষমাণ '+x.bars+'/12':x.status==='REVIEW'?x.reason:x.reason+' · '+(x.netPct>=0?'+':'')+fmt(x.netPct,2)+'%'}</span>)}</div>}
    <h4 className="section-subtitle">সিগন্যালের কারণ ও NO TRADE-এর ব্যাখ্যা</h4><div className="mtf-reasons">{(result?.reasons||['সম্পূর্ণ ক্যান্ডেল ও order-book ডেটার জন্য অপেক্ষা করা হচ্ছে।']).map((x,i)=><span key={i}>{x}</span>)}</div>
    <p className="public-data-foot">শুধু গবেষণার জন্য তৈরি নিয়মভিত্তিক ব্যবস্থা। Entry নির্বাচিত Timeframe-এর সম্পূর্ণ Candle-এর Close Price ও আনুমানিক Slippage-ভিত্তিক; পরের Candle-এ ওই দামে Trade হবে, এমন নিশ্চয়তা নেই। Entry Timeframe-এর ATR-এর ১.৫ গুণ Stop, ৩ গুণ Target অথবা ১২টি সম্পূর্ণ Candle ব্যবহার করা হয়; একই Candle-এ Stop ও Target লাগলে Stop আগে ধরা হয়। Candle gap থাকলে Signal REVIEW হয় এবং Win Rate থেকে বাদ যায়। এটি পর্যবেক্ষণভিত্তিক হিসাব; Broker-এর প্রকৃত Fill বা স্বাধীনভাবে যাচাই করা Win Rate নয়। কোনো বাস্তব Order পাঠানো হয় না।</p>
  </section>;
}

function App() {
  const [symbol,setSymbol] = useState('BTCUSDT');
  const [interval,setTimeframe] = useState('15m');
  const [signalTimeframeMode,setSignalTimeframeMode] = useState('AUTO');
  const [market,setMarket] = useState('Futures');
  const [theme,setTheme] = useState('dark');
  const [language,setLanguage] = useState(()=>{try{return localStorage.getItem('cryptobot.language')==='en'?'en':'bn';}catch{return 'bn';}});
  const [prices,setPrices] = useState({});
  const [candles,setCandles] = useState([]);
  const [chartResetKey,setChartResetKey] = useState(0);
  const [loading,setLoading] = useState(true);
  const [updated,setUpdated] = useState(null);
  const [query,setQuery] = useState('');
  const [tab,setTab] = useState('Overview');
  const [mobileNav,setMobileNav] = useState(false);
  const [watchOnly,setWatchOnly] = useState(false);
  const [demoBalances,setDemoBalances] = useState(()=>{try{const saved=JSON.parse(localStorage.getItem('cryptobot.demoBalances')||'null');if(saved&&Number.isFinite(saved.Spot)&&Number.isFinite(saved.Futures))return saved;const legacy=Number(localStorage.getItem('cryptobot.demoBalance'))||10000;return {Spot:10000,Futures:legacy};}catch{return {Spot:10000,Futures:10000};}});
  const demoBalance=demoBalances[market]||10000;
  const [paperTrades,setPaperTrades] = useState(()=>{try{return JSON.parse(localStorage.getItem('cryptobot.paperTrades')||'[]');}catch{return [];}});
  const [paperMarginInput,setPaperMarginInput]=useState('100');
  const [paperLeverageInput,setPaperLeverageInput]=useState('3');
  const [paperPrices,setPaperPrices]=useState({});
  const closingIds=useRef(new Set());
  const [notice,setNotice] = useState('');
  const [mtfSignal,setMtfSignal] = useState(null);
  const translationRecords=useRef(new WeakMap());

  useEffect(()=>{
    try{localStorage.setItem('cryptobot.language',language);}catch{}
    const root=document.querySelector('.app');
    if(!root)return;
    // Keep original Bengali text across language changes. Recreating this map
    // on every toggle made the already-translated English text become the source.
    const records=translationRecords.current;
    const renderText=node=>{
      const current=node.nodeValue;
      let record=records.get(node);
      if(!record){record={source:current,rendered:null};records.set(node,record);}
      else if(current!==record.rendered&&current!==record.source){record.source=current;}
      const next=language==='en'?translateText(record.source):record.source;
      if(current!==next){record.rendered=next;node.nodeValue=next;}else record.rendered=current;
    };
    const renderElement=el=>{
      for(const attr of ['placeholder','title','aria-label']){
        if(!el.hasAttribute?.(attr))continue;
        const current=el.getAttribute(attr),key=el.tagName+':'+attr;
        let attrs=records.get(el);if(!attrs){attrs={};records.set(el,attrs);}
        let rec=attrs[key];if(!rec){rec={source:current,rendered:null};attrs[key]=rec;}else if(current!==rec.rendered&&current!==rec.source){rec.source=current;}
        const next=language==='en'?translateText(rec.source):rec.source;
        if(current!==next){el.setAttribute(attr,next);rec.rendered=next;}else rec.rendered=current;
      }
    };
    const scan=node=>{
      if(node.nodeType===Node.TEXT_NODE){renderText(node);return;}
      if(node.nodeType!==Node.ELEMENT_NODE&&node!==root)return;
      if(node.nodeType===Node.ELEMENT_NODE)renderElement(node);
      node.childNodes?.forEach(scan);
    };
    scan(root);
    const observer=new MutationObserver(recordsList=>{
      for(const mutation of recordsList){
        if(mutation.type==='characterData')renderText(mutation.target);
        else if(mutation.type==='attributes')renderElement(mutation.target);
        else mutation.addedNodes.forEach(scan);
      }
    });
    observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['placeholder','title','aria-label']});
    return()=>observer.disconnect();
  },[language]);
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
    let live=true,ws=null,reconnect=null,fallback=null,snapshotTimer=null,watchdog=null,lastMessageAt=0,snapshotInFlight=false,delay=1000;
    const endpoint=market==='Futures'?'https://fapi.binance.com/fapi/v1/ticker/24hr':'https://api.binance.com/api/v3/ticker/24hr';
    const spotSymbols=encodeURIComponent(JSON.stringify(WATCH.map(w=>w[0])));
    const snapshot=async()=>{if(snapshotInFlight)return;snapshotInFlight=true;try{const rows=market==='Spot'
      ? await fetchJsonWithRetry(endpoint+'?symbols='+spotSymbols,{attempts:2,timeoutMs:10000})
      : await Promise.all(WATCH.map(w=>fetchJsonWithRetry(endpoint+'?symbol='+w[0],{attempts:2,timeoutMs:10000})));
      if(!Array.isArray(rows))throw new Error('Invalid ticker snapshot');if(!live)return;setPrices(prev=>{const next={...prev};rows.forEach(x=>{if(WATCH.some(w=>w[0]===x.symbol)){const meta=prev[x.symbol]||{};const wsFresh=meta.wsAt&&Date.now()-meta.wsAt<=15000;next[x.symbol]={...x,lastPrice:wsFresh?(prev[x.symbol]?.lastPrice||x.lastPrice):x.lastPrice};}});return next;});setUpdated(new Date());setFeedMeta(prev=>{const next={...prev};rows.forEach(x=>{if(WATCH.some(w=>w[0]===x.symbol)){const old=prev[x.symbol]||{},restPrice=Number(x.lastPrice),wsPrice=Number(prev[x.symbol]?.wsPrice||0),divergence=wsPrice>0&&restPrice>0?Math.abs(wsPrice-restPrice)/restPrice*100:null;next[x.symbol]={...old,priceAt:old.wsAt&&Date.now()-old.wsAt<=15000?old.wsAt:Date.now(),priceSource:old.wsAt&&Date.now()-old.wsAt<=15000?'WEBSOCKET':'REST',restAt:Date.now(),restPrice,divergencePct:divergence};}});return next;});}catch{if(live)setNotice('Live feed reconnecting; using the latest available market snapshot.');}finally{snapshotInFlight=false;}};
    const startFallback=()=>{if(fallback===null){setFeedStatus('REST FALLBACK');snapshot();fallback=window.setInterval(snapshot,5000);}};
    const connect=()=>{if(!live)return;setFeedStatus('CONNECTING');const host=market==='Futures'?'wss://fstream.binance.com/stream?streams=':'wss://stream.binance.com:9443/stream?streams=';
      const streams=WATCH.map(w=>w[0].toLowerCase()+'@trade').join('/');
      const url=host+streams;try{ws=new WebSocket(url);}catch{startFallback();return;}
      ws.onopen=()=>{delay=1000;lastMessageAt=Date.now();if(fallback!==null){clearInterval(fallback);fallback=null;}setFeedStatus('LIVE');};
      ws.onmessage=e=>{try{lastMessageAt=Date.now();const x=JSON.parse(e.data).data;if(!x?.s||!x?.p)return;setPrices(prev=>({...prev,[x.s]:{...(prev[x.s]||{}),symbol:x.s,lastPrice:x.p}}));setFeedMeta(prev=>{const old=prev[x.s]||{},restPrice=Number(old.restPrice||0),wsPrice=Number(x.p);return {...prev,[x.s]:{...old,priceAt:Date.now(),wsAt:Date.now(),wsExchangeAt:Number(x.T||x.E||0),priceSource:'WEBSOCKET',wsPrice,divergencePct:restPrice>0?Math.abs(wsPrice-restPrice)/restPrice*100:null}};});setUpdated(new Date());setFeedStatus('LIVE');}catch{}};
      ws.onerror=()=>{try{ws.close();}catch{}};
      ws.onclose=()=>{if(!live)return;setFeedStatus('RECONNECTING');startFallback();reconnect=window.setTimeout(connect,delay);delay=Math.min(delay*2,15000);};
    };
    snapshot();snapshotTimer=window.setInterval(snapshot,30000);connect();watchdog=window.setInterval(()=>{if(live&&ws?.readyState===WebSocket.OPEN&&lastMessageAt&&Date.now()-lastMessageAt>45000){setFeedStatus('RECONNECTING');startFallback();try{ws.close();}catch{}}},10000);return()=>{live=false;if(reconnect)clearTimeout(reconnect);if(fallback!==null)clearInterval(fallback);if(snapshotTimer!==null)clearInterval(snapshotTimer);if(watchdog!==null)clearInterval(watchdog);try{ws?.close();}catch{}};
  },[market]);
  // Load fresh history whenever the selected chart market changes.
  useEffect(()=>{
    let live=true,ws=null,retryTimer=null,fallbackTimer=null,watchdog=null,lastMessageAt=0,delay=1000;
    setCandles([]);setLoading(true);
    const history=async()=>{try{const rows=await fetchJsonWithRetry(candleUrl,{attempts:2,timeoutMs:10000});if(!Array.isArray(rows))throw new Error('Invalid Binance candle response');if(live){const normalized=rows.map(k=>({time:Math.floor(Number(k[0])/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],closeTime:Number(k[6]),isClosed:Number(k[6])<Date.now()})).filter(c=>Number.isFinite(c.time)&&[c.open,c.high,c.low,c.close].every(v=>Number.isFinite(v)&&v>0));setCandles(normalized.slice(-160));setFeedMeta(prev=>({...prev,[symbol]:{...(prev[symbol]||{}),candleAt:Date.now(),candleSource:'REST'}}));setLoading(false);}}catch(e){if(live){setLoading(false);setNotice('চার্টের ক্যান্ডেল ডেটা লোড হয়নি: '+(e.message||'Binance সংযোগ সমস্যা')+'। আবার চেষ্টা করা হচ্ছে।');}}};
    const connect=()=>{if(!live)return;const host=market==='Futures'?'wss://fstream.binance.com/ws/':'wss://stream.binance.com:9443/ws/';try{ws=new WebSocket(host+symbol.toLowerCase()+'@kline_'+interval);}catch{fallback();return;}
      ws.onopen=()=>{delay=1000;lastMessageAt=Date.now();if(fallbackTimer){clearInterval(fallbackTimer);fallbackTimer=null;}};
      ws.onmessage=e=>{try{lastMessageAt=Date.now();const k=JSON.parse(e.data).k;if(!k||!live)return;const c={time:Math.floor(k.t/1000),open:+k.o,high:+k.h,low:+k.l,close:+k.c,closeTime:Number(k.T),isClosed:Boolean(k.x),exchangeAt:Number(k.T)};setFeedMeta(prev=>({...prev,[symbol]:{...(prev[symbol]||{}),candleAt:Date.now(),candleSource:'WEBSOCKET',candleExchangeAt:Number(k.T)}}));setCandles(prev=>{const map=new Map(prev.map(x=>[x.time,x]));map.set(c.time,c);return [...map.values()].sort((x,y)=>x.time-y.time).slice(-160);});}catch{}};
      ws.onerror=()=>{try{ws.close();}catch{}};
      ws.onclose=()=>{if(!live)return;fallback();retryTimer=window.setTimeout(connect,delay);delay=Math.min(delay*2,15000);};
    };
    const fallback=()=>{if(fallbackTimer===null)fallbackTimer=window.setInterval(history,10000);};
    history();connect();watchdog=window.setInterval(()=>{if(live&&ws?.readyState===WebSocket.OPEN&&lastMessageAt&&Date.now()-lastMessageAt>45000){fallback();try{ws.close();}catch{}}},10000);return()=>{live=false;if(retryTimer)clearTimeout(retryTimer);if(fallbackTimer)clearInterval(fallbackTimer);if(watchdog)clearInterval(watchdog);try{ws?.close();}catch{}};
  },[candleUrl,market,symbol,interval,chartResetKey]);

  // Keep the in-progress chart candle aligned to each live trade.
  // It remains unclosed and is excluded from all closed-candle signal calculations.
  useEffect(()=>{
    let live=true,ws=null,retry=null,delay=1000;
    const intervalMs={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000}[interval];
    const connect=()=>{
      if(!live)return;
      const host=market==='Futures'?'wss://fstream.binance.com/ws/':'wss://stream.binance.com:9443/ws/';
      try{ws=new WebSocket(host+symbol.toLowerCase()+'@trade');}catch{retry=window.setTimeout(connect,delay);delay=Math.min(delay*2,15000);return;}
      ws.onopen=()=>{delay=1000;};
      ws.onmessage=e=>{
        try{
          const trade=JSON.parse(e.data),price=Number(trade.p),eventTime=Number(trade.T||trade.E);
          if(!live||!Number.isFinite(price)||price<=0||!Number.isFinite(eventTime))return;
          const bucketMs=Math.floor(eventTime/intervalMs)*intervalMs,bucket=Math.floor(bucketMs/1000);
          setCandles(prev=>{
            if(!prev.length)return prev;
            const last=prev[prev.length-1];
            if(bucket<last.time)return prev;
            if(bucket===last.time){
              const next={...last,high:Math.max(last.high,price),low:Math.min(last.low,price),close:price,isClosed:false,exchangeAt:eventTime};
              return [...prev.slice(0,-1),next];
            }
            const next={time:bucket,open:price,high:price,low:price,close:price,closeTime:bucketMs+intervalMs-1,isClosed:false,exchangeAt:eventTime};
            return [...prev,next].slice(-160);
          });
        }catch{}
      };
      ws.onerror=()=>{try{ws.close();}catch{}};
      ws.onclose=()=>{if(!live)return;retry=window.setTimeout(connect,delay);delay=Math.min(delay*2,15000);};
    };
    connect();
    return()=>{live=false;if(retry)clearTimeout(retry);try{ws?.close();}catch{}};
  },[market,symbol,interval]);

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
  const latestClosedCandleAt=validClosed.at(-1)?.closeTime;
  const closedCandleAge=Number.isFinite(latestClosedCandleAt)?feedClock-latestClosedCandleAt:Infinity;
  const expectedCandleMs={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000}[interval];
  const candleGaps=validClosed.slice(1).filter((c,i)=>c.time-validClosed[i].time!==expectedCandleMs/1000).length;
  const restReferenceAge=activeFeed.restAt?feedClock-activeFeed.restAt:Infinity;
  const restReferenceFresh=Boolean(restReferenceAge<=60000&&Number(activeFeed.restPrice)>0);
  const websocketPriceFresh=Boolean(activeFeed.wsAt&&feedClock-activeFeed.wsAt<=15000);
  // Compare only near-simultaneous REST/stream observations; a 30s-old REST snapshot
  // naturally differs from a live trade price during volatile moves.
  const reconciliationOk=websocketPriceFresh
    ? (!restReferenceFresh||restReferenceAge>10000||!Number.isFinite(activeFeed.divergencePct)||activeFeed.divergencePct<=0.75)
    : restReferenceFresh;
  const signalHealth = { priceFresh:priceAge<=30000, candleFresh:candleAge<=30000&&closedCandleAge<=expectedCandleMs+30000, hasTicker:Number.isFinite(Number(prices[symbol]?.lastPrice))&&Number(prices[symbol]?.lastPrice)>0, hasClosedCandles:validClosed.length>=50, reconciliationOk, candleGaps };
  const integrityIssues = [
    ...(!signalHealth.hasTicker ? ['লাইভ Price Feed পাওয়া যায়নি।'] : []),
    ...(!signalHealth.priceFresh ? ['লাইভ Price Feed ৩০ সেকেন্ডের বেশি পুরোনো।'] : []),
    ...(!signalHealth.hasClosedCandles ? ['কমপক্ষে ৫০টি সম্পূর্ণ Candle পাওয়া যায়নি।'] : []),
    ...(!signalHealth.candleFresh ? ['Candle Feed পুরোনো অথবা সর্বশেষ সম্পূর্ণ Candle দেরিতে এসেছে।'] : []),
    ...(!signalHealth.reconciliationOk ? ['REST ও WebSocket Price-এর পার্থক্য গ্রহণযোগ্য সীমার বাইরে।'] : []),
    ...(signalHealth.candleGaps>0 ? [signalHealth.candleGaps+'টি Candle interval অনুপস্থিত।'] : []),
  ];
  const analysis = useMemo(()=>{
     const matches=mtfSignal?.symbol===symbol&&mtfSignal?.market===market;
     const signalAge=mtfSignal?.updated instanceof Date?feedClock-mtfSignal.updated.getTime():Infinity;
     const selectedTf=mtfSignal?.selectedTimeframe||(signalTimeframeMode!=='AUTO'?signalTimeframeMode:'5m');
     const entryFrame=mtfSignal?.data?.[selectedTf],blockers=[];
     if(!matches)blockers.push('বর্তমান কয়েন/মার্কেটের MTF বিশ্লেষণ এখনো পাওয়া যায়নি');
     else if(mtfSignal.status!=='READY')blockers.push('MTF Signal Engine-এর ডেটা যাচাই সম্পূর্ণ হয়নি');
     if(!Number.isFinite(signalAge)||signalAge>90000)blockers.push('MTF সিগন্যাল ৯০ সেকেন্ডের বেশি পুরোনো');
     if(!signalHealth.hasTicker||!signalHealth.priceFresh)blockers.push('লাইভ ট্রেডিং প্রাইস অনুপস্থিত বা ৩০ সেকেন্ডের বেশি পুরোনো');
     if(!signalHealth.reconciliationOk)blockers.push('লাইভ REST ও WebSocket প্রাইস যাচাই মেলেনি');
     if(!entryFrame||!Number.isFinite(entryFrame.atr)||entryFrame.atr<=0)blockers.push(selectedTf.toUpperCase()+' ATR পাওয়া যায়নি');
     if(blockers.length)return {bias:'WAIT',score:0,atr:null,stop:null,target:null,positionSize:0,riskUsd:demoBalance*0.01,ready:false,timeframe:selectedTf,reason:'NO TRADE — '+blockers.join('। ')+'.'};
     const bias=mtfSignal.decision==='LONG'||mtfSignal.decision==='SHORT'?mtfSignal.decision:'WAIT';
     if(bias==='WAIT')return {bias,score:mtfSignal.score??0,atr:entryFrame.atr,stop:null,target:null,positionSize:0,riskUsd:0,ready:true,timeframe:selectedTf,reason:(mtfSignal.reasons||['NO TRADE']).join(' ')};
     const riskPlan=validateSignalRiskPlan({side:bias,entry:price,atr:entryFrame.atr,market,accountBalance:demoBalance});
     if(!riskPlan.ok)return {bias:'WAIT',score:0,atr:entryFrame.atr,stop:null,target:null,positionSize:0,riskUsd:0,ready:false,timeframe:selectedTf,reason:'NO TRADE — Risk যাচাইয়ের শর্ত: '+riskPlan.reason+'.'};
     return {bias,score:mtfSignal.score??0,atr:entryFrame.atr,stop:riskPlan.stop,target:riskPlan.target,positionSize:riskPlan.quantity,riskUsd:riskPlan.riskUsd,netRR:riskPlan.netRR,ready:true,timeframe:selectedTf,reason:(mtfSignal.reasons||['MTF analysis completed.']).join(' ')};
  },[mtfSignal,symbol,market,feedClock,price,demoBalance,signalTimeframeMode,signalHealth.hasTicker,signalHealth.priceFresh,signalHealth.reconciliationOk]);
  useEffect(()=>{if(signalTimeframeMode==='AUTO'&&mtfSignal?.selectedTimeframe&&mtfSignal.symbol===symbol&&mtfSignal.market===market)setTimeframe(current=>current===mtfSignal.selectedTimeframe?current:mtfSignal.selectedTimeframe);},[signalTimeframeMode,mtfSignal?.selectedTimeframe,mtfSignal?.updated,mtfSignal?.symbol,mtfSignal?.market,symbol,market]);
  const suggestedLeverage=market==='Futures'&&analysis.ready&&analysis.bias!=='WAIT'?suggestConservativeLeverage({entry:price,atr:analysis.atr}):null;
  const resetDemoFunds=()=>{if(paperTrades.some(t=>t.status==='OPEN'&&t.market===market)){showNotice('Close all open '+market+' paper trades before resetting this account balance.');return;}if(window.confirm('Reset '+market+' demo balance to 10,000 USDT? Closed trade history will be kept.')){updateMarketBalance(market,10000);showNotice(market+' demo balance reset to 10,000 USDT. Trade history was preserved.');}};
  const navItems=[['Overview',Activity],['Market Scanner',Compass],['Spot Analysis',CandlestickChart],['Futures Analysis',Layers3],['Paper Trading',Wallet],['Trade Journal',BookOpen],['Backtesting',BarChart3],['Strategy Lab',SlidersHorizontal],['Multi-Asset Scanner',Globe2],['Market Regime',Activity],['Market Structure',Layers3],['News & Events',Newspaper]];
  const showNotice = msg => {setNotice(msg);setTimeout(()=>setNotice(''),4200);};
  const updateMarketBalance=(marketKey,updater)=>setDemoBalances(prev=>({...prev,[marketKey]:Math.max(0,typeof updater==='function'?updater(prev[marketKey]||10000):updater)}));
  useEffect(()=>{try{localStorage.setItem('cryptobot.demoBalances',JSON.stringify(demoBalances));localStorage.setItem('cryptobot.paperTrades',JSON.stringify(paperTrades));}catch{showNotice('Browser storage unavailable; paper trade history may not persist.');}},[demoBalances,paperTrades]);
  useEffect(()=>{
    let live=true;
    const refresh=async()=>{
      const open=paperTrades.filter(t=>t.status==='OPEN');
      const unique=[...new Map(open.map(t=>[t.market+':'+t.symbol,{market:t.market,symbol:t.symbol}])).values()];
      await Promise.all(unique.map(async item=>{
        try{
          const base=item.market==='Futures'?'https://fapi.binance.com/fapi/v1/ticker/price':'https://api.binance.com/api/v3/ticker/price';
          const response=await fetch(base+'?symbol='+item.symbol,{cache:'no-store'});
          if(!response.ok)throw new Error('price unavailable');
          const data=await response.json(),lastPrice=Number(data.price);
          if(live&&Number.isFinite(lastPrice)&&lastPrice>0)setPaperPrices(prev=>({...prev,[item.market+':'+item.symbol]:{lastPrice,updatedAt:Date.now()}}));
        }catch{}
      }));
    };
    refresh();const timer=window.setInterval(refresh,4000);
    return()=>{live=false;clearInterval(timer);};
  },[paperTrades.filter(t=>t.status==='OPEN').map(t=>t.market+':'+t.symbol).sort().join('|')]);
  const closeTrade=(id,exitPrice,reason='ম্যানুয়ালি বন্ধ')=>{
    const t=paperTrades.find(x=>x.id===id);if(!t||t.status!=='OPEN')return;
    const feeRate=Number(t.feeRate??0.0005),slippageRate=Number(t.slippageRate??0.0002),filledExit=applyAdverseSlippage(exitPrice,t.side,'EXIT',slippageRate),accounting=calculateTradePnl({side:t.side,entry:t.entry,exit:filledExit,quantity:t.quantity,feeRate,entryFee:Number(t.entryFee||0)});if(!accounting.ok)return;
    updateMarketBalance(t.market,b=>b+(t.margin||t.entry*t.quantity/(t.leverage||1))+accounting.grossPnl-accounting.exitFee);
    setPaperTrades(rows=>rows.map(x=>x.id===id?{...x,status:'CLOSED',exit:filledExit,rawExit:exitPrice,pnl:accounting.netPnl,grossPnl:accounting.grossPnl,entryFee:accounting.entryFee,exitFee:accounting.exitFee,closedAt:Date.now(),exitReason:reason}:x));
    closingIds.current.delete(id);
  };
  const addPaperTrade=()=>{
    if(!analysis.ready||analysis.bias==='WAIT'||!analysis.atr){showNotice('Paper trade blocked: the current MTF signal or live price is not valid. Wait for a fresh, fully checked LONG/SHORT setup.');return;}
    if(!price){showNotice('Market price is not available yet.');return;}
    if(analysis.bias==='WAIT'||!analysis.atr){showNotice('No trade opened: setup is WAIT or ATR data is unavailable.');return;}
    if(market==='Spot'&&analysis.bias==='SHORT'){showNotice('Spot mode cannot open short positions. Switch to Futures or wait for a LONG setup.');return;}
    const side=analysis.bias,leverage=market==='Futures'?Math.max(1,Math.min(10,Math.floor(Number(paperLeverageInput)||1))):1,requestedMargin=Math.max(0,Number(paperMarginInput)),feeRate=0.0005,slippageRate=0.0002,entry=applyAdverseSlippage(price,side,'Entry',slippageRate);
    if(!Number.isFinite(requestedMargin)||requestedMargin<=0){showNotice('Enter a valid paper margin amount.');return;}
    if(requestedMargin>demoBalance){showNotice('Requested margin is higher than the available '+market+' demo balance.');return;}
    const stop=side==='LONG'?entry-analysis.atr*1.5:entry+analysis.atr*1.5;
    const target=side==='LONG'?entry+analysis.atr*3:entry-analysis.atr*3;
    const paperRiskPlan=validateSignalRiskPlan({side,entry,atr:analysis.atr,market,accountBalance:demoBalance,feeRate,slippageRate});if(!paperRiskPlan.ok){showNotice('Paper trade blocked by cost-aware risk sizing: '+paperRiskPlan.reason);return;}
    const riskQuantity=Math.min(analysis.positionSize||paperRiskPlan.quantity,paperRiskPlan.quantity);
    const quantity=calculatePaperQuantity({entry,margin:requestedMargin,leverage,feeRate,riskQuantity,availableBalance:demoBalance});
    if(!Number.isFinite(quantity)||quantity<=0){showNotice('Insufficient demo balance for this position.');return;}
    const margin=entry*quantity/leverage,entryFee=entry*quantity*feeRate;
    if(margin+entryFee>demoBalance){showNotice('Insufficient demo balance.');return;}
    const trade={id:Date.now()+'_'+market+'_'+symbol,symbol,side,market,entry,referenceEntry:price,quantity,stop,target,leverage,margin,requestedMargin,entryFee,status:'OPEN',time:new Date().toLocaleString(),openedAt:Date.now(),feeRate,slippageRate};
    setPaperTrades(rows=>[trade,...rows]);updateMarketBalance(market,b=>b-margin-entryFee);
    showNotice('Paper '+side+' opened on '+market+' with '+leverage+'x leverage. Position size remains capped by the risk plan.');
  };
  useEffect(()=>{
    paperTrades.filter(t=>t.status==='OPEN').forEach(t=>{
      const live=Number(paperPrices[t.market+':'+t.symbol]?.lastPrice||((t.market===market)?prices[t.symbol]?.lastPrice:0)||0);if(!live||closingIds.current.has(t.id))return;
      const stopHit=t.side==='LONG'?live<=t.stop:live>=t.stop,targetHit=t.side==='LONG'?live>=t.target:live<=t.target;
      if(stopHit||targetHit){closingIds.current.add(t.id);closeTrade(t.id,stopHit?live:t.target,stopHit?'STOP LOSS':'TAKE PROFIT');}
    });
  },[prices,paperPrices,paperTrades,market]);

  const unrealizedPnl=paperTrades.filter(t=>t.status==='OPEN'&&t.market===market).reduce((sum,t)=>{const live=Number(paperPrices[t.market+':'+t.symbol]?.lastPrice||((t.market===market)?prices[t.symbol]?.lastPrice:0)||t.entry),exitFill=applyAdverseSlippage(live,t.side,'EXIT',Number(t.slippageRate??0.0002)),accounting=calculateTradePnl({side:t.side,entry:t.entry,exit:exitFill,quantity:t.quantity,feeRate:Number(t.feeRate??0.0005),entryFee:Number(t.entryFee||0)});return sum+(accounting.ok?accounting.netPnl:0);},0);
  return <div className={`app ${theme}`} data-language={language}>
    <aside className={`sidebar ${mobileNav?'open':''}`}>
      <div className="brand"><div className="brand-mark"><Activity size={19}/></div><div><b>Crypto<span>Bot</span></b><small>TRADING TERMINAL</small></div><button className="icon-btn mobile-close" onClick={()=>setMobileNav(false)}><X size={17}/></button></div>
      <div className="workspace"><div className="workspace-icon"><Command size={16}/></div><div><b>Market Desk</b><small>Personal workspace</small></div><ChevronDown size={14}/></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav>{navItems.map(([name,Icon])=><button key={name} className={`nav-item ${tab===name?'selected':''}`} onClick={()=>{setTab(name);setMobileNav(false);}}><Icon size={17}/><span>{name}</span>{name==='Paper Trading'&&<i>{paperTrades.filter(t=>t.status==='OPEN').length}</i>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="status-line"><span className="pulse"/> PUBLIC DATA FEED</div><div className="sidebar-note"><ShieldCheck size={15}/><span>No exchange keys connected<br/>Manual execution only</span></div><div className="profile"><div className="avatar">M</div><div><b>Mishad</b><small>Free workspace</small></div><Settings2 size={16}/></div></div>
    </aside>
    {mobileNav&&<div className="scrim" onClick={()=>setMobileNav(false)}/>}
    <main className="main">
      <header className="topbar"><div className="top-left"><button className="icon-btn mobile-menu" onClick={()=>setMobileNav(true)}><Menu size={19}/></button><span className="crumb">Workspace</span><span className="slash">/</span><b>{tab}</b></div><div className="top-actions"><div className="feed"><span className={`pulse ${feedStatus==='LIVE'?'':'feed-warn'}`}/> <span>{feedStatus}</span></div><button className="icon-btn" onClick={()=>setTheme(t=>t==='dark'?'light':'dark')} title="Toggle theme">{theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}</button><button className="secondary-btn language-toggle" onClick={()=>setLanguage(l=>l==='bn'?'en':'bn')} title="Switch interface language">{language==='bn'?'EN':'বাংলা'}</button><button className="icon-btn" onClick={()=>showNotice('Notifications are not configured yet.')}><Bell size={17}/></button><div className="top-avatar">M</div></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow">WEDNESDAY, NOVEMBER 11, 2026 <span>·</span> MARKET OVERVIEW</div><h1>{tab==='Overview'?'Market overview':tab}</h1><p>Read the market. Respect the risk. Trade with a plan.</p></div><div className="heading-actions"><button className="secondary-btn" onClick={()=>{setLoading(true);fetch(candleUrl).then(r=>r.json()).then(rows=>setCandles(rows.filter(k=>Number(k[6])>Number(k[0])).map(k=>({time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],closeTime:Number(k[6]),isClosed:Number(k[6])<Date.now()})))).finally(()=>setLoading(false));}}><RefreshCw size={15}/> Refresh</button><button className="primary-btn" onClick={()=>setTab('Paper Trading')}><Plus size={16}/> New paper trade</button></div></div>
        {notice&&<div className="notice"><CircleHelp size={15}/>{notice}<button onClick={()=>setNotice('')}><X size={14}/></button></div>}
        <section className="data-integrity-panel">
          <div className="integrity-heading"><div><b>DATA INTEGRITY</b><small>Signal gate · active market / timeframe</small></div><span className={signalHealth.priceFresh&&signalHealth.candleFresh&&signalHealth.hasTicker&&signalHealth.hasClosedCandles&&signalHealth.reconciliationOk&&signalHealth.candleGaps===0?"integrity-ok":"integrity-warn"}>{signalHealth.priceFresh&&signalHealth.candleFresh&&signalHealth.hasTicker&&signalHealth.hasClosedCandles&&signalHealth.reconciliationOk&&signalHealth.candleGaps===0?"DATA VALID":"SIGNAL BLOCKED"}</span></div>
          <div className="integrity-grid">
            <div><span>PRICE FEED</span><b>{signalHealth.hasTicker?(signalHealth.priceFresh?"FRESH":"STALE"):"MISSING"}</b><small>{activeFeed.priceSource||"No source"} · {Number.isFinite(priceAge)?Math.max(0,Math.round(priceAge/1000))+"s ago":"—"}</small></div>
            <div><span>CANDLE FEED</span><b>{signalHealth.hasClosedCandles?(signalHealth.candleFresh?"FRESH":"STALE"):"INSUFFICIENT"}</b><small>{activeFeed.candleSource||"No source"} · {Number.isFinite(candleAge)?Math.max(0,Math.round(candleAge/1000))+"s ago":"—"}</small></div>
            <div><span>REST / STREAM DELTA</span><b>{signalHealth.reconciliationOk? "MATCHED":"CHECK"}</b><small>{Number.isFinite(activeFeed.divergencePct)?fmt(activeFeed.divergencePct,4)+"% difference":"Awaiting REST reference"} · max 0.50%</small></div>
            <div><span>CANDLE SEQUENCE</span><b>{signalHealth.candleGaps===0?"CONTIGUOUS":"GAP DETECTED"}</b><small>{signalHealth.candleGaps} missing interval(s)</small></div>
            <div><span>COMPLETED CANDLES</span><b>{candles.filter(c=>c.isClosed).length}</b><small>Open candle excluded from signal</small></div>
            <div><span>DECISION</span><b>{analysis.bias==="WAIT"?"NO TRADE":analysis.bias}</b><small>30s freshness limit</small></div>
          </div><p>{integrityIssues.length ? 'Signal Block হওয়ার কারণ: '+integrityIssues.join(' ') : 'সব Data Integrity Check পাস করেছে।'} Age is measured from browser receipt time; this check cannot guarantee zero exchange/network latency.</p>
        </section>
        <MultiTimeframeSignal key={symbol+'_'+market} symbol={symbol} market={market} onSignal={setMtfSignal} timeframeMode={signalTimeframeMode} onTimeframeModeChange={setSignalTimeframeMode} onTimeframeChange={setTimeframe}/>
        <section className="market-strip">
          <div className="market-stat"><span>BTC / USDT</span><b>{prices.BTCUSDT?'$'+fmt(prices.BTCUSDT.lastPrice):'Loading…'}</b><em className={Number(prices.BTCUSDT?.priceChangePercent)>=0?'positive':'negative'}>{prices.BTCUSDT?fmt(prices.BTCUSDT.priceChangePercent)+'%':'—'}</em></div>
          <div className="market-stat"><span>ETH / USDT</span><b>{prices.ETHUSDT?'$'+fmt(prices.ETHUSDT.lastPrice):'Loading…'}</b><em className={Number(prices.ETHUSDT?.priceChangePercent)>=0?'positive':'negative'}>{prices.ETHUSDT?fmt(prices.ETHUSDT.priceChangePercent)+'%':'—'}</em></div>
          <div className="market-stat"><span>BNB / USDT</span><b>{prices.BNBUSDT?'$'+fmt(prices.BNBUSDT.lastPrice):'Loading…'}</b><em className={Number(prices.BNBUSDT?.priceChangePercent)>=0?'positive':'negative'}>{prices.BNBUSDT?fmt(prices.BNBUSDT.priceChangePercent)+'%':'—'}</em></div>
          <div className="market-stat"><span>SOL / USDT</span><b>{prices.SOLUSDT?'$'+fmt(prices.SOLUSDT.lastPrice):'Loading…'}</b><em className={Number(prices.SOLUSDT?.priceChangePercent)>=0?'positive':'negative'}>{prices.SOLUSDT?fmt(prices.SOLUSDT.priceChangePercent)+'%':'—'}</em></div>
          <div className="market-stat market-update"><span>DATA UPDATED</span><b>{updated?updated.toLocaleTimeString():'Connecting…'}</b><small><span className={`pulse ${feedStatus==='LIVE'?'':'feed-warn'}`}/> Binance {feedStatus==='LIVE'?'WebSocket':'REST fallback'}</small></div>
        </section>
        <div className="section-row"><div><h2>Market workspace</h2><p>Live {market.toLowerCase()} prices and multi-timeframe chart analysis</p></div><div className="market-actions"><button className="sui-focus-btn" onClick={()=>setSymbol('SUIUSDT')}>SUI / USDT <span>FOCUS</span></button><div className="market-toggle"><button className={market==='Spot'?'active':''} onClick={()=>setMarket('Spot')}>Spot</button><button className={market==='Futures'?'active':''} onClick={()=>setMarket('Futures')}>Futures</button></div></div></div>
        <section className="workspace-grid">
          <div className="panel chart-panel">
            <div className="panel-head"><div className="asset-title"><div className="coin-icon">{active[2].slice(0,1)}</div><div><b>{active[1]} <span>{active[2]}/USDT</span></b><small>Binance · {market} market</small></div><ChevronDown size={14}/></div><div className="chart-tools">{intervals.map(i=><button key={i} className={interval===i?'chosen':''} onClick={()=>setTimeframe(i)}>{i}</button>)}<button className="tool-icon" onClick={()=>showNotice('চার্টে EMA 20 ও EMA 50 চালু আছে; দুটিই চলমান ক্যান্ডেলের সঙ্গে WebSocket আপডেটে পুনর্গণনা হয়।')}><SlidersHorizontal size={15}/></button></div></div>
            <div className="price-line"><div><strong>{price?'$'+fmt(price,price<1?5:2):'—'}</strong><span className={change>=0?'positive':'negative'}>{price?(change>=0?'+':'')+fmt(change)+'%':'Waiting for feed'} <small>24h</small></span></div><div className="range"><span>24H HIGH</span><b>{ticker?'$'+fmt(ticker.highPrice):'—'}</b><span>24H LOW</span><b>{ticker?'$'+fmt(ticker.lowPrice):'—'}</b></div></div>
            <ChartPanel symbol={symbol} interval={interval} candles={candles} loading={loading} market={market} resetKey={chartResetKey} onReset={()=>setChartResetKey(v=>v+1)}/>
            <div className="chart-foot"><span><span className="legend-dot"/> Candlesticks</span><span>Timeframe: {interval}</span><span>Source: Binance public API</span></div>
          </div>
          <div className="right-stack">
            <div className="panel signal-panel"><div className="panel-title"><div><h3>সেটআপ মূল্যায়ন</h3><p>সম্পূর্ণ Candle-ভিত্তিক নিয়ম · ডেটা যাচাই সাপেক্ষে</p></div><span className="tiny-live">{analysis.bias==="WAIT"?"BLOCKED":"CHECKED"}</span></div><div className={`signal-badge ${analysis.bias.toLowerCase()}`}>{analysis.bias==='LONG'?<TrendingUp size={19}/>:analysis.bias==='SHORT'?<TrendingDown size={19}/>:<Crosshair size={19}/>}<b>{analysis.bias}</b></div><div className="score-row"><span>দিকনির্দেশক Score</span><b>{analysis.score}/100</b></div><div className="score-track"><i style={{width:analysis.score+'%'}}/></div><p className="analysis-reason">{analysis.reason}</p>{market==='Futures'&&analysis.bias!=='WAIT'&&suggestedLeverage&&<div className="suggested-leverage"><span>ঝুঁকি অনুযায়ী Leverage প্রস্তাব</span><b>{suggestedLeverage}x</b><small>সতর্ক Volatility হিসাব · Paper Trading-এর Leverage নিজে বেছে নাও</small></div>}<div className="signal-warning"><ShieldCheck size={15}/><span>Signal Engine এখনো প্রাথমিক পর্যায়ে। Backtest-এ প্রমাণিত বাড়তি সুবিধা বা যাচাই করা Win Rate দাবি করা হচ্ছে না।</span></div><button className="outline-btn full" onClick={()=>setTab('Futures Analysis')}>বিশ্লেষণের বিস্তারিত দেখো <ArrowUpRight size={15}/></button></div>
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
              <div><h3>Futures Risk Plan</h3><p>{active[2]}/USDT · {analysis.timeframe||interval} signal timeframe · ATR-based levels</p></div>
              <ShieldCheck size={18}/>
            </div>
            <div className="risk-grid">
              <div><span>SETUP</span><b className={analysis.bias==='LONG'?'positive':analysis.bias==='SHORT'?'negative':''}>{analysis.bias}</b></div>
              <div><span>Entry REFERENCE</span><b>{price ? '$'+fmt(price,price<1?5:4) : '—'}</b></div>
              <div><span>STOP LOSS</span><b>{analysis.stop ? '$'+fmt(analysis.stop,price<1?5:4) : '—'}</b></div>
              <div><span>TAKE PROFIT (2R)</span><b>{analysis.target ? '$'+fmt(analysis.target,price<1?5:4) : '—'}</b></div>
              <div><span>Risk Budget (১%)</span><b>$ {fmt(analysis.riskUsd)}</b></div>
              <div><span>আনুমানিক Position Size</span><b>{analysis.positionSize ? fmt(analysis.positionSize,3)+' '+active[2] : '—'}</b></div><div><span>প্রস্তাবিত Leverage</span><b>{suggestedLeverage? suggestedLeverage+'x':'—'}</b></div>
              <div><span>OPEN INTEREST</span><b>{futuresMetrics.openInterest ? compact(+futuresMetrics.openInterest) : '—'}</b></div>
              <div><span>FUNDING RATE</span><b>{futuresMetrics.fundingRate!==null ? fmt(+futuresMetrics.fundingRate*100,4)+'%' : '—'}</b></div>
            </div>
            <p className="risk-note">Risk হিসাবের জন্য ১০,০০০ USDT-এর Demo Account এবং ১% Risk Budget ধরা হয়েছে। Stop ও Target Volatility-ভিত্তিক আনুমানিক Price—নিশ্চিত Execution Price নয়। Funding ও Open Interest তথ্য হিসেবে দেখানো হয়; Manual Trade-এর আগে Liquidity ও Slippage যাচাই করো।</p>
            <div className="signal-warning"><ShieldCheck size={15}/><span>এটি যাচাইকৃত Strategy নয় এবং জয়ের কোনো সম্ভাবনা দাবি করা হচ্ছে না। Setup-এ WAIT দেখালে জোর করে Trade নিও না।</span></div>
          </section>
        )}
        <section className="lower-grid">
          <div className="panel watch-panel"><div className="panel-title"><div><h3>Watchlist</h3><p>নির্বাচিত Liquid Market</p></div><button className="icon-btn" onClick={()=>setWatchOnly(!watchOnly)}><Filter size={16}/></button></div><div className="watch-search"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search assets…"/></div><div className="watch-table"><div className="watch-header"><span>ASSET</span><span>LAST PRICE</span><span>24H CHANGE</span></div>{filtered.map(c=>{const p=prices[c[0]];const up=Number(p?.priceChangePercent)>=0;return <button className={`watch-row ${symbol===c[0]?'active':''}`} key={c[0]} onClick={()=>setSymbol(c[0])}><span className="watch-asset"><i>{c[2][0]}</i><b>{c[2]} <small>{c[1]}</small></b></span><b>{p?'$'+fmt(p.lastPrice,p.lastPrice<1?5:2):'—'}</b><em className={up?'positive':'negative'}>{p?(up?'+':'')+fmt(p.priceChangePercent)+'%':'—'}</em></button>})}</div><div className="table-foot">Live WebSocket stream · REST fallback · {filtered.length} assets shown</div></div>
          <div className="panel paper-panel"><div className="panel-title"><div><h3>Paper account</h3><p>Simulated balance · No real funds</p></div><Wallet size={17}/></div><div className="balance-label">AVAILABLE BALANCE</div><div className="balance-value">${fmt(demoBalance)}</div><div className="balance-change"><span className="positive">Virtual USDT · {market}</span><span>Starting balance: $10,000</span></div><button className="secondary-btn full reset-funds-btn" onClick={resetDemoFunds}>Reset {market} demo funds</button><div className="paper-stats"><div><span>OPEN {market.toUpperCase()} Trade সংখ্যা</span><b>{paperTrades.filter(t=>t.status==='OPEN'&&t.market===market).length}</b></div><div><span>EST. NET UNREALIZED P&L</span><b className={unrealizedPnl>=0?'positive':'negative'}>{unrealizedPnl>=0?'+':''}${fmt(unrealizedPnl)}</b></div></div><button className="primary-btn full" onClick={()=>setTab('Paper Trading')}>Open paper trading <ArrowUpRight size={15}/></button><p className="disclaimer">Paper trading is a simulation. Stop exits use the latest observed trade price to avoid optimistic fills after price gaps; target exits are capped at the target. Monitoring depends on this page receiving Binance updates. If the page or connection is offline, the exact intraperiod path can be missed. Futures funding and liquidation are not simulated.</p></div>
        </section>
        {(tab==='Paper Trading'||tab==='Trade Journal')&&(
          <section className="panel journal-panel">
            <div className="panel-title">
              <div><h3>Paper trade journal</h3><p>Auto SL/TP while page is open · এই Browser-এ সংরক্ষিত</p></div>
              <div className="paper-open-controls">
                <label>Margin / Fund (USDT)<input type="number" min="1" step="1" value={paperMarginInput} onChange={e=>setPaperMarginInput(e.target.value)}/></label>
                <label>Leverage{market==='Spot'?<input value="1x · Spot" disabled/>:<select value={paperLeverageInput} onChange={e=>setPaperLeverageInput(e.target.value)}>{[1,2,3,4,5,6,7,8,9,10].map(x=><option key={x} value={x}>{x}x</option>)}</select>}</label>
                <button className="primary-btn" onClick={addPaperTrade}><Plus size={15}/> Open {analysis.bias==='WAIT'?'trade':' '+analysis.bias}</button>
              </div>
            </div>
            {paperTrades.length===0?<div className="empty-state">No paper trades yet. A trade can only be opened when the setup assessment is LONG or SHORT.</div>:(
              <div className="trade-list">
                {paperTrades.map(t=>(
                  <div className="trade-row" key={t.id}>
                    <b>{t.symbol.replace('USDT','')}/USDT <small>{t.side}</small></b>
                    <span>Entry: ${fmt(t.entry)}</span>
                    <span>{t.status==='OPEN'?('Live: $'+fmt(paperPrices[t.market+':'+t.symbol]?.lastPrice||((t.market===market)?prices[t.symbol]?.lastPrice:0)||t.entry)):('Exit: $'+fmt(t.exit))}</span>
                    <span>SL: ${fmt(t.stop)} · TP: ${fmt(t.target)} · {t.market} · {t.leverage}x</span>
                    {t.status==='OPEN'
                      ? <button className="secondary-btn" disabled={!Number(paperPrices[t.market+':'+t.symbol]?.lastPrice||((t.market===market)?prices[t.symbol]?.lastPrice:0))} onClick={()=>closeTrade(t.id,Number(paperPrices[t.market+':'+t.symbol]?.lastPrice||((t.market===market)?prices[t.symbol]?.lastPrice:0)),'MANUAL')}>Close at market</button>
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