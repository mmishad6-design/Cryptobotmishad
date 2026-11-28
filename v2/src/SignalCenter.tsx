import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { getConsensusKlines, type Kline } from "./lib/market";
import { calculateIndicators, calculateMarketStructure, getEmaTrend } from "./lib/indicators";
import { evaluateAdvancedSignal } from "./core/advancedSignalEngine";

type MarketMode = "Spot" | "Futures";
type Frame = { close:number; trend:"BULLISH"|"BEARISH"|"MIXED"; rsi:number; adx:number; volumeRatio:number; atr:number; structure:string; takerRatio:number|null };
type Evaluation = { decision:string; score:number; reasons:string[]; riskPlan:any; gates:Record<string,boolean>; diagnostics:Record<string,any> };
const FRAMES = ["1d","4h","1h","15m","5m"] as const;
const money = (n:number) => n.toLocaleString("en-US",{maximumFractionDigits:6});
function adxValue(rows:Kline[], period=14):number {
  if(rows.length < period*2+1) return 0;
  const tr:number[]=[], plus:number[]=[], minus:number[]=[];
  for(let i=1;i<rows.length;i++){
    const h=Number(rows[i][2]),l=Number(rows[i][3]),pc=Number(rows[i-1][4]);
    const ph=Number(rows[i-1][2]),pl=Number(rows[i-1][3]);
    tr.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));
    const up=h-ph, down=pl-l;
    plus.push(up>down&&up>0?up:0); minus.push(down>up&&down>0?down:0);
  }
  const smooth=(values:number[])=>{let v=values.slice(0,period).reduce((a,b)=>a+b,0);const out=[v];for(let i=period;i<values.length;i++){v=v-v/period+values[i];out.push(v);}return out;};
  const t=smooth(tr),p=smooth(plus),m=smooth(minus),dx:number[]=[];
  for(let i=0;i<t.length;i++){const pdi=t[i]?100*p[i]/t[i]:0,mdi=t[i]?100*m[i]/t[i]:0;dx.push(pdi+mdi?100*Math.abs(pdi-mdi)/(pdi+mdi):0);}
  if(dx.length<period)return 0;
  let value=dx.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for(let i=period;i<dx.length;i++)value=(value*(period-1)+dx[i])/period;
  return value;
}
function frameFrom(rows:Kline[]):Frame|null {
  if(rows.length<60)return null;
  const ind=calculateIndicators(rows), structure=calculateMarketStructure(rows);
  const close=Number(rows.at(-1)![4]), volume=rows.map(r=>Number(r[5]));
  const recent=volume.slice(-5).reduce((a,b)=>a+b,0)/5;
  const baseline=volume.slice(-25,-5).reduce((a,b)=>a+b,0)/20;
  const flowSamples=rows.slice(-20).map(r=>Number(r[9])).filter(v=>Number.isFinite(v)&&v>0);
  const takerRatio=flowSamples.length?flowSamples.reduce((a,b)=>a+b,0)/flowSamples.length:null;
  const rawTrend=getEmaTrend(rows);
  const trend:Frame["trend"]=rawTrend==="Bullish"?"BULLISH":rawTrend==="Bearish"?"BEARISH":"MIXED";
  if(ind.rsi14===null||ind.atr14===null||!close||!Number.isFinite(close))return null;
  return {close,trend,rsi:ind.rsi14,adx:adxValue(rows),volumeRatio:baseline>0?recent/baseline:0,atr:ind.atr14,structure:structure.event,takerRatio};
}
export default function SignalCenter({symbol, livePrice, depthRatio}:{symbol:string;livePrice:number;depthRatio:number|null}){
  const [market,setMarket]=useState<MarketMode>("Spot");
  const [leverage,setLeverage]=useState(3);
  const [balance,setBalance]=useState("1000");
  const [evaluation,setEvaluation]=useState<Evaluation|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [updatedAt,setUpdatedAt]=useState("");
  const [frameStatus,setFrameStatus]=useState<Record<string,string>>({});
  const [exchangeSources,setExchangeSources]=useState<string[]>([]);
  const [takerFlowAvailable,setTakerFlowAvailable]=useState(false);
  async function run(){
    setLoading(true);setError("");setEvaluation(null);
    try{
      const results=await Promise.all(FRAMES.map(async interval=>{
        const response=await getConsensusKlines(symbol,interval,240,market);
        
        const frame=frameFrom(response.data);
        return [interval,frame,response.sources] as const;
      }));
      const data=Object.fromEntries(results.filter(([,frame])=>Boolean(frame)).map(([tf,frame])=>[tf,frame])) as Record<typeof FRAMES[number],Frame>;
      setFrameStatus(Object.fromEntries(results.map(([tf,frame])=>[tf,frame?"READY":"INSUFFICIENT DATA"])));
      setExchangeSources([...new Set(results.flatMap(([,frame,sources])=>frame?sources:[]))]);
      setTakerFlowAvailable(Boolean(data["5m"]&&data["5m"].takerRatio!==null&&Number.isFinite(data["5m"].takerRatio)));
      const analysisEntry=data["5m"]?.close ?? (livePrice>0?livePrice:undefined);
      const usableDepthRatio=market==="Spot"?(depthRatio??undefined):undefined;
      const result=evaluateAdvancedSignal({data,market,entry:analysisEntry,accountBalance:Number(balance)>0?Number(balance):null,leverage:market==="Spot"?1:leverage,flow:{depthRatio:usableDepthRatio}});
      if(results.some(([,frame])=>!frame)) throw new Error("এক বা একাধিক timeframe-এ পর্যাপ্ত Binance candle data পাওয়া যায়নি।");
      setEvaluation(result as Evaluation);setUpdatedAt(new Date().toISOString());
    }catch(e){setError(e instanceof Error?e.message:"Market data load failed.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{
    const timer=window.setTimeout(()=>{void run();},350);
    return ()=>window.clearTimeout(timer);
  },[symbol,market,leverage,balance]);
  const plan=evaluation?.riskPlan;
  const gates=useMemo(()=>["trend","setup","timing","structure","volume","flow","risk"].map(key=>({key,ok:Boolean(evaluation?.gates?.[key])})),[evaluation]);
  return <div style={{display:"grid",gap:14}}>
    <section className="panel" style={{padding:16}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",alignItems:"center"}}>
        <div><div className="eyebrow">BINANCE · PUBLIC MARKET DATA</div><h2 style={{margin:"5px 0"}}>Advanced Signal Engine</h2><p style={{margin:0,color:"var(--muted)",fontSize:12}}>Pair: {symbol} · Binance {market} · Manual execution</p></div>
        <button className="outline-btn" onClick={()=>void run()} disabled={loading}><RefreshCw size={14} style={{marginRight:6}}/>{loading?"Analyzing…":"Refresh analysis"}</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:9,marginTop:16}}>
        <label className="admin-field"><span>Market mode</span><select value={market} onChange={e=>setMarket(e.target.value as MarketMode)}><option>Spot</option><option>Futures</option></select></label>
        {market==="Futures"&&<label className="admin-field"><span>Leverage</span><select value={leverage} onChange={e=>setLeverage(Number(e.target.value))}>{[1,2,3,5,10,20].map(v=><option key={v} value={v}>{v}x</option>)}</select></label>}
        <label className="admin-field"><span>Account balance (USDT)</span><input type="number" min="0" value={balance} onChange={e=>setBalance(e.target.value)}/></label>
        <div className="admin-field"><span>Live price</span><b style={{padding:"10px 0",display:"block"}}>{livePrice>0?money(livePrice):"Unavailable"}</b></div>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
        {FRAMES.map(tf=><span key={tf} style={{padding:"6px 9px",borderRadius:6,background:"var(--surface-2)",fontSize:10,border:"1px solid var(--border-soft)"}}>{tf.toUpperCase()} · {frameStatus[tf]??"WAITING"}</span>)}
      </div>
      {error&&<div className="auth-message error" style={{marginTop:12}}>{error}</div>}
    </section>
    <section className="panel" style={{padding:16}}>
      {!evaluation?<div className="empty-state"><Activity size={22}/><b>{loading?"Analyzing five timeframes…":"Waiting for analysis"}</b><span>Binance-এর live candle data দিয়ে পাঁচটি timeframe বিশ্লেষণ করা হবে।</span></div>:<>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
          <div><div className="eyebrow">CURRENT DECISION · {market.toUpperCase()}</div><h2 style={{fontSize:25,margin:"6px 0",color:evaluation.decision==="NO TRADE"?"var(--text-2)":evaluation.decision==="LONG"?"#42d2a3":"#f07883"}}>{market==="Spot"&&evaluation.decision==="LONG"?"BUY":evaluation.decision==="SHORT"?"SHORT":evaluation.decision}</h2><small style={{color:"var(--muted)"}}>Score {evaluation.score}/100 · Minimum 80 · {updatedAt?new Date(updatedAt).toLocaleTimeString():""}</small></div>
          <div style={{fontSize:32,fontWeight:750,fontVariantNumeric:"tabular-nums"}}>{evaluation.score}<small style={{fontSize:12,color:"var(--muted)"}}>/100</small></div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:8,marginTop:14}}>
          {gates.map(g=><div key={g.key} style={{padding:9,borderRadius:7,background:"var(--surface-2)",border:"1px solid var(--border-soft)",fontSize:10}}><span style={{color:"var(--muted)"}}>{g.key.toUpperCase()}</span><b style={{display:"block",marginTop:4,color:g.ok?"#42d2a3":"#f07883"}}>{g.ok?"PASS":"FAIL"}</b></div>)}
        </div>
        {plan?.ok&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:9,marginTop:14}}>
          {[["ENTRY",plan.entry],["STOP LOSS",plan.stop],["TAKE PROFIT",plan.target],["NET R:R",plan.netRR.toFixed(2)+"R"],["QUANTITY",plan.quantity>0?money(plan.quantity):"Set balance"],["RISK",plan.riskUsd>0?money(plan.riskUsd)+" USDT":"Not sized"]].map(([label,value])=><div key={String(label)} style={{padding:11,borderRadius:8,background:"var(--surface-2)",border:"1px solid var(--border-soft)"}}><small style={{color:"var(--muted)"}}>{label}</small><b style={{display:"block",marginTop:5}}>{value}</b></div>)}
        </div>}
        <div style={{marginTop:14}}><b style={{fontSize:12}}>বাংলায় বিশ্লেষণ ও rejection reasons</b>{evaluation.reasons.map((reason,i)=><p key={i} style={{fontSize:12,lineHeight:1.6,margin:"8px 0",color:reason.startsWith("NO TRADE")?"var(--text-2)":"var(--text)"}}>{reason}</p>)}</div>
        <div style={{marginTop:12,padding:10,borderRadius:7,background:"var(--surface-2)",fontSize:11,color:"var(--muted)"}}><ShieldCheck size={14} style={{verticalAlign:"middle",marginRight:6}}/>No order is placed. This is an analysis candidate for manual review, not financial advice.</div>
      </>}
    </section>
  </div>;
}
