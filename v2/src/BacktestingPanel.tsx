import { useState } from "react";
import { Activity, AlertTriangle, BarChart3, RefreshCw, ShieldCheck } from "lucide-react";
import { getConsensusKlines, type Kline } from "./lib/market";
import { calculateIndicators, calculateMarketStructure, getEmaTrend } from "./lib/indicators";
import { evaluateAdvancedSignal } from "./core/advancedSignalEngine";
import { runHistoricalBacktest } from "./core/backtestEngine";

type MarketMode = "Spot" | "Futures";
type Frame = { close:number; trend:"BULLISH"|"BEARISH"|"MIXED"; rsi:number; adx:number; volumeRatio:number; atr:number; structure:string; takerRatio:number };
const FRAMES = ["1d","4h","1h","15m","5m"] as const;
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
  const [market,setMarket]=useState<MarketMode>("Spot");
  const [balance,setBalance]=useState("1000");
  const [leverage,setLeverage]=useState(3);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [result,setResult]=useState<any>(null);
  const [info,setInfo]=useState("");
  async function run(){
    setBusy(true);setError("");setResult(null);setInfo("");
    try{
      const responses=await Promise.all(FRAMES.map(tf=>getConsensusKlines(symbol,tf,300,market)));
      const closedHistories=responses.map(r=>r.data.filter(k=>+k[6]<=Date.now()));
      const bad=responses.findIndex((r,i)=>closedHistories[i].length<60||r.maxSpreadPct>0.5);
      if(bad>=0)throw new Error(FRAMES[bad].toUpperCase()+" timeframe-এ পর্যাপ্ত বা নির্ভরযোগ্য multi-exchange candle নেই।");
      const histories=Object.fromEntries(FRAMES.map((tf,i)=>[tf,closedHistories[i]])) as Record<string,Kline[]>;
      const base=histories["5m"];
      const rows=base.map(k=>({time:+k[0],closeTime:+k[6],open:+k[1],high:+k[2],low:+k[3],close:+k[4]}));
      const initialBalance=Number(balance);
      if(!Number.isFinite(initialBalance)||initialBalance<=0)throw new Error("শুরুর balance সঠিকভাবে দাও।");
      const simulation=runHistoricalBacktest({
        candles:rows,market,initialBalance,warmup:60,maxHoldingBars:288,
        feeRate:0.0005,slippageRate:0.0002,
        evaluate:(visible,index)=>{
          const decisionTime=visible.at(-1)!.closeTime!;
          const data:Record<string,Frame>={};
          for(const tf of FRAMES){
            const closed=(histories[tf] as Kline[]).filter(k=>+k[6]<=decisionTime).slice(-240);
            const frame=frameFrom(closed);
            if(!frame)return null;
            data[tf]=frame;
          }
          return evaluateAdvancedSignal({data,market,entry:data["5m"].close,accountBalance:initialBalance,leverage:market==="Spot"?1:leverage,flow:{takerRatio:data["5m"].takerRatio}});
        }
      });
      if(!simulation.ok)throw new Error(simulation.reason);
      setResult(simulation);
      setInfo("৫ মিনিটের candle-এ পরীক্ষা · "+base.length+" candle · "+responses.map((r,i)=>FRAMES[i].toUpperCase()+": "+r.exchanges+" exchanges").join(" · "));
    }catch(e){setError(e instanceof Error?e.message:"Backtest চালানো যায়নি।");}
    finally{setBusy(false);}
  }
  const m=result?.metrics;
  return <div className="user-page">
    <section className="panel">
      <div className="market-toolbar"><div><div className="eyebrow">HISTORICAL SIMULATION · MULTI-TIMEFRAME</div><h2>Signal Engine Backtest</h2><p>বর্তমান Advanced Signal Engine-এর নিয়ম দিয়ে অতীতের closed candle পরীক্ষা করা হবে।</p></div><button className="outline-btn" onClick={()=>void run()} disabled={busy}><RefreshCw size={14} style={{marginRight:6}}/>{busy?"Running…":"Run backtest"}</button></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:10,marginTop:16}}>
        <label className="admin-field"><span>Symbol</span><input value={symbol} readOnly/></label>
        <label className="admin-field"><span>Market mode</span><select value={market} onChange={e=>setMarket(e.target.value as MarketMode)}><option>Spot</option><option>Futures</option></select></label>
        {market==="Futures"&&<label className="admin-field"><span>Leverage</span><select value={leverage} onChange={e=>setLeverage(Number(e.target.value))}>{[1,2,3,5,10,20].map(x=><option key={x} value={x}>{x}x</option>)}</select></label>}
        <label className="admin-field"><span>Starting balance (USDT)</span><input type="number" min="1" value={balance} onChange={e=>setBalance(e.target.value)}/></label>
      </div>
      <div className="chart-meta"><span>TIMEFRAME <b>5M execution</b></span><span>ANALYSIS <b>1D · 4H · 1H · 15M · 5M</b></span><span>FEES <b>0.05% each side</b></span><span>SLIPPAGE <b>0.02% each side</b></span><span>MAX HOLD <b>24 hours</b></span></div>
      {error&&<div className="auth-message error"><AlertTriangle size={14}/> {error}</div>}
      {info&&<p style={{marginTop:12}}>{info}</p>}
    </section>
    {m&&<>
      <div className="stats-grid" style={{gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))"}}>
        {metric("TOTAL TRADES",String(m.tradeCount),m.wins+" wins · "+m.losses+" losses")}
        {metric("WIN RATE",m.winRatePct.toFixed(1)+"%",m.tradeCount+" closed trades")}
        {metric("NET PNL",(m.netPnl>=0?"+":"")+fmt(m.netPnl)+" USDT",m.returnPct.toFixed(2)+"% return")}
        {metric("PROFIT FACTOR",m.profitFactor===null?"∞":m.profitFactor.toFixed(2))}
        {metric("EXPECTANCY",(m.expectancy>=0?"+":"")+fmt(m.expectancy)+" USDT / trade")}
        {metric("MAX DRAWDOWN",m.maxDrawdownPct.toFixed(2)+"%")}
        {metric("AVERAGE R",m.averageR.toFixed(2)+"R")}
        {metric("FEES PAID",fmt(m.feesPaid)+" USDT")}
      </div>
      <section className="panel">
        <div className="panel-head"><h2>Trade history</h2><p>Historical fills · Conservative stop-first candle resolution</p></div>
        {!result.trades.length?<div className="empty-state"><BarChart3 size={22}/><b>কোনো valid signal পাওয়া যায়নি</b><span>এটি নিজেই একটি ফলাফল—এই sample-এ সব gate একসঙ্গে পূরণ হয়নি।</span></div>:
        <><div className="table-head" style={{display:"grid",gridTemplateColumns:"1.2fr .6fr 1fr 1fr 1fr 1fr",gap:8}}><span>ENTRY TIME</span><span>SIDE</span><span>ENTRY</span><span>EXIT</span><span>NET PNL</span><span>EXIT REASON</span></div>
        {result.trades.slice().reverse().map((t:any,i:number)=><div className="paper-history-row" key={t.entryTime+"-"+i} style={{display:"grid",gridTemplateColumns:"1.2fr .6fr 1fr 1fr 1fr 1fr",gap:8,fontSize:10}}><span>{new Date(t.entryTime).toLocaleString()}</span><b>{t.side}</b><span>{fmt(t.entry)}</span><span>{fmt(t.exit)}</span><b style={{color:t.netPnl>=0?"#55d5a6":"#f17d89"}}>{t.netPnl>=0?"+":""}{fmt(t.netPnl)}</b><span>{t.exitReason}</span></div>)}</>}
      </section>
    </>}
    <div className="paper-disclaimer"><ShieldCheck size={15}/> Simulation only. Historical results do not predict future returns. No real orders are placed.</div>
  </div>;
}
