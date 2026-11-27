import { useState } from "react";
import { Activity, AlertTriangle, BarChart3, RefreshCw, ShieldCheck } from "lucide-react";
import { getConsensusHistory, type Kline } from "./lib/market";
import { calculateIndicators, calculateMarketStructure, getEmaTrend } from "./lib/indicators";
import { evaluateAdvancedSignal } from "./core/advancedSignalEngine";
import { runHistoricalBacktest } from "./core/backtestEngine";
// @ts-ignore — this JavaScript utility is covered by runtime tests.
import { createSequentialOosFolds, aggregateWalkForwardResults } from "./core/walkForward.js";

type MarketMode = "Spot" | "Futures";
type Frame = { close:number; trend:"BULLISH"|"BEARISH"|"MIXED"; rsi:number; adx:number; volumeRatio:number; atr:number; structure:string; takerRatio:number };
const FRAMES = ["1d","4h","1h","15m","5m"] as const;
const HISTORY_DAYS:Record<(typeof FRAMES)[number],number>={"1d":180,"4h":60,"1h":30,"15m":14,"5m":14};
const fmt=(n:number)=>n.toLocaleString("en-US",{maximumFractionDigits:4});
function adxValue(rows:Kline[],period=14):number {
  if(rows.length<period*2+1)return 0;
  const tr:number[]=[],plus:number[]=[],minus:number[]=[];
  for(let i=1;i<rows.length;i++){
    const h=+rows[i][2],l=+rows[i][3],pc=+rows[i-1][4],ph=+rows[i-1][2],pl=+rows[i-1][3];
    tr.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));
    const up=h-ph,down=pl-l;plus.push(up>down&&up>0?up:0);minus.push(down>up&&down>0?down:0);
  }
  const smooth=(v:number[])=>{let x=v.slice(0,period).reduce((a,b)=>a+b,0);const out=[x];for(let i=period;i<v.length;i++){x=x-x/period+v[i];out.push(x);}return out;};
  const t=smooth(tr),p=smooth(plus),m=smooth(minus),dx:number[]=[];
  for(let i=0;i<t.length;i++){const a=t[i]?100*p[i]/t[i]:0,b=t[i]?100*m[i]/t[i]:0;dx.push(a+b?100*Math.abs(a-b)/(a+b):0);}
  if(dx.length<period)return 0;
  let v=dx.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for(let i=period;i<dx.length;i++)v=(v*(period-1)+dx[i])/period;
  return v;
}
function frameFrom(rows:Kline[]):Frame|null {
  if(rows.length<60)return null;
  const ind=calculateIndicators(rows),structure=calculateMarketStructure(rows);
  const close=+rows.at(-1)![4],vol=rows.map(r=>+r[5]);
  const recent=vol.slice(-5).reduce((a,b)=>a+b,0)/5,base=vol.slice(-25,-5).reduce((a,b)=>a+b,0)/20;
  const flow=rows.slice(-20).map(r=>+r[9]).filter(v=>Number.isFinite(v)&&v>0);
  const raw=getEmaTrend(rows),trend:Frame["trend"]=raw==="Bullish"?"BULLISH":raw==="Bearish"?"BEARISH":"MIXED";
  if(ind.rsi14===null||ind.atr14===null||!Number.isFinite(close)||close<=0)return null;
  return {close,trend,rsi:ind.rsi14,adx:adxValue(rows),volumeRatio:base>0?recent/base:0,atr:ind.atr14,structure:structure.event,takerRatio:flow.length?flow.reduce((a,b)=>a+b,0)/flow.length:0};
}
function metric(label:string,value:string,sub?:string){return <div className="stat-card" style={{minHeight:92}}><div className="stat-top">{label}</div><div className="stat-value" style={{fontSize:21}}>{value}</div>{sub&&<div className="stat-foot">{sub}</div>}</div>;}
export default function BacktestingPanel({symbol}:{symbol:string}){
  const [balance,setBalance]=useState("1000");
  const [leverage,setLeverage]=useState(3);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [records,setRecords]=useState<any[]>([]);
  const [info,setInfo]=useState("");
  async function run(){
    setBusy(true);setError("");setRecords([]);setInfo("");
    try{
      const symbols=[...new Set([symbol.toUpperCase(),"SUIUSDT"])];
      const markets:MarketMode[]=["Spot","Futures"];
      const initialBalance=Number(balance);
      if(!Number.isFinite(initialBalance)||initialBalance<=0)throw new Error("শুরুর balance সঠিকভাবে দাও।");
      const output:any[]=[];
      for(const pair of symbols){
        for(const market of markets){
          const responses=await Promise.all(FRAMES.map(tf=>getConsensusHistory(pair,tf,HISTORY_DAYS[tf],market)));
          const histories=Object.fromEntries(FRAMES.map((tf,i)=>[tf,responses[i].data.filter(k=>+k[6]<=Date.now())])) as Record<string,Kline[]>;
          const bad=FRAMES.findIndex(tf=>histories[tf].length<60||responses[FRAMES.indexOf(tf)].maxSpreadPct>0.5);
          if(bad>=0)throw new Error(pair+" "+market+" · "+FRAMES[bad].toUpperCase()+" timeframe-এ পর্যাপ্ত বা নির্ভরযোগ্য multi-exchange candle নেই।");
          const base=histories["5m"];
          const rows=base.map(k=>({time:+k[0],closeTime:+k[6],open:+k[1],high:+k[2],low:+k[3],close:+k[4]}));
          const folds=createSequentialOosFolds(rows,Math.floor(rows.length*0.6),3,60);
          if(folds.length!==3)throw new Error(pair+" "+market+"-এর জন্য পর্যাপ্ত Out-of-Sample history নেই।");
          const foldCaches=folds.map(()=>new Map<number,any>());
          const scenarios=[
            {label:"Base costs",feeRate:0.0005,slippageRate:0.0002},
            {label:"Elevated costs",feeRate:0.00075,slippageRate:0.0005},
            {label:"Severe costs",feeRate:0.001,slippageRate:0.001}
          ];
          const scenarioResults=scenarios.map(cost=>{
            const foldRuns=folds.map((fold,foldIndex)=>{
              const cache=foldCaches[foldIndex];
              const simulation=runHistoricalBacktest({
                candles:fold.data,market,initialBalance,warmup:fold.warmupCount,maxHoldingBars:288,
                feeRate:cost.feeRate,slippageRate:cost.slippageRate,
                evaluate:(visible,index)=>{
                  if(cache.has(index))return cache.get(index);
                  const decisionTime=visible.at(-1)!.closeTime!,data:Record<string,Frame>={};
                  for(const tf of FRAMES){
                    const frame=frameFrom(histories[tf].filter(k=>+k[6]<=decisionTime).slice(-240));
                    if(!frame){cache.set(index,null);return null;}
                    data[tf]=frame;
                  }
                  const signal=evaluateAdvancedSignal({data,market,entry:data["5m"].close,accountBalance:initialBalance,leverage:market==="Spot"?1:leverage,flow:{takerRatio:data["5m"].takerRatio}});
                  cache.set(index,signal);
                  return signal;
                }
              });
              if(!simulation.ok)throw new Error(pair+" "+market+" Fold "+fold.index+": "+simulation.reason);
              return simulation;
            });
            return {label:cost.label,metrics:aggregateWalkForwardResults(foldRuns,initialBalance),trades:foldRuns.flatMap(x=>x.trades),folds:foldRuns.map(x=>x.metrics)};
          });
          const regimes=classifyMarketRegimes(rows.map(r=>({time:r.time,close:r.close})),48,0.004);
          const regimeReport=summarizeRegimePerformance(scenarioResults[0].trades,regimes);
          output.push({symbol:pair,market,scenarios:scenarioResults,regimes:regimeReport,candleCount:base.length,spread:Math.max(...responses.map(r=>r.maxSpreadPct))});
        }
      }
      setRecords(output);
      setInfo("প্রতিটি pair ও market-এর শেষের ৪০% history তিনটি unseen fold-এ পরীক্ষা হয়েছে। Base / Elevated / Severe cost-এ একই signal sequence ব্যবহার করা হয়েছে; regime label প্রতিটি signal close-এর আগের candle data থেকে নির্ধারিত।");
    }catch(e){setError(e instanceof Error?e.message:"Robustness test চালানো যায়নি।");}
    finally{setBusy(false);}
  }
  return <div className="user-page">
    <section className="panel">
      <div className="market-toolbar"><div><div className="eyebrow">OUT-OF-SAMPLE · STRATEGY ROBUSTNESS</div><h2>Strategy Robustness Testing</h2><p>নির্বাচিত pair + SUI/USDT · Spot + Futures · তিন স্তরের fee/slippage stress · market-regime breakdown।</p></div><button className="outline-btn" onClick={()=>void run()} disabled={busy}><RefreshCw size={14} style={{marginRight:6}}/>{busy?"Testing…":"Run robustness test"}</button></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginTop:16}}>
        <label className="admin-field"><span>Selected pair</span><input value={symbol} readOnly/></label>
        <label className="admin-field"><span>Additional pair</span><input value="SUIUSDT" readOnly/></label>
        <label className="admin-field"><span>Markets</span><input value="Spot + Futures" readOnly/></label>
        <label className="admin-field"><span>Futures leverage</span><select value={leverage} onChange={e=>setLeverage(Number(e.target.value))}>{[1,2,3,5,10,20].map(x=><option key={x} value={x}>{x}x</option>)}</select></label>
        <label className="admin-field"><span>Starting balance (USDT)</span><input type="number" min="1" value={balance} onChange={e=>setBalance(e.target.value)}/></label>
      </div>
      <div className="chart-meta"><span>EXECUTION <b>5M</b></span><span>ANALYSIS <b>1D · 4H · 1H · 15M · 5M</b></span><span>BASE COST <b>0.05% fee + 0.02% slippage / side</b></span><span>SEVERE COST <b>0.10% + 0.10% / side</b></span></div>
      {error&&<div className="auth-message error"><AlertTriangle size={14}/> {error}</div>}
      {info&&<p style={{marginTop:12}}>{info}</p>}
    </section>
    {records.map(record=><section className="panel" key={record.symbol+"-"+record.market}>
      <div className="panel-head"><h2>{record.symbol} · {record.market}</h2><p>{record.candleCount.toLocaleString()} closed 5M candles · max cross-exchange spread {record.spread.toFixed(3)}%</p></div>
      <div className="stats-grid" style={{gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))"}}>
        {record.scenarios.map((s:any)=><div className="stat-card" key={s.label}>
          <div className="stat-top">{s.label.toUpperCase()}</div>
          <div className="stat-value" style={{fontSize:19,color:s.metrics.netPnl>=0?"#55d5a6":"#f17d89"}}>{s.metrics.netPnl>=0?"+":""}{fmt(s.metrics.netPnl)} USDT</div>
          <div className="stat-foot">{s.metrics.tradeCount} trades · {s.metrics.winRatePct.toFixed(1)}% win · PF {s.metrics.profitFactor===null?"∞":s.metrics.profitFactor.toFixed(2)}</div>
          <div className="stat-foot">Worst fold DD {s.metrics.maxDrawdownPct.toFixed(2)}% · Expectancy {fmt(s.metrics.expectancy)}</div>
        </div>)}
      </div>
      <div className="panel-head" style={{marginTop:18}}><h3>Market regime · Base cost</h3><p>Signal close-এর সময়কার trailing 48-candle trend/volatility</p></div>
      {!record.regimes.length?<div className="empty-state">এই pair/market-এ কোনো completed trade পাওয়া যায়নি।</div>:
      <div style={{overflowX:"auto"}}><div className="table-head" style={{gridTemplateColumns:"1.2fr .7fr .7fr .8fr .8fr .8fr",minWidth:580}}><span>REGIME</span><span>TRADES</span><span>WIN RATE</span><span>NET PNL</span><span>EXPECTANCY</span><span>PROFIT FACTOR</span></div>
      {record.regimes.map((r:any)=><div className="candle-row" key={r.regime} style={{gridTemplateColumns:"1.2fr .7fr .7fr .8fr .8fr .8fr",minWidth:580}}><b>{r.regime.replace("_"," · ")}</b><span>{r.tradeCount}</span><span>{r.winRatePct.toFixed(1)}%</span><span>{fmt(r.netPnl)}</span><span>{fmt(r.expectancy)}</span><span>{r.profitFactor===null?"∞":r.profitFactor.toFixed(2)}</span></div>)}</div>}
    </section>)}
    <div className="paper-disclaimer"><ShieldCheck size={15}/> Simulation only. Each fold starts from the same paper balance; combined fold PnL is a sum, not a compounded portfolio return. Historical results do not predict future returns. No real orders are placed.</div>
  </div>;
}
