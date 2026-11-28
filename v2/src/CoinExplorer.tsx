import { useEffect, useState } from "react";
import { Activity, ArrowUpRight, Search, TrendingDown, TrendingUp, RefreshCw } from "lucide-react";
type Coin={id:string;name:string;symbol:string;pair:string;image:string;current_price:number|null;market_cap:number|null;market_cap_rank:number|null;total_volume:number|null;price_change_percentage_24h:number|null};
type Props={onAnalyze:(pair:string)=>void};
const money=(value:number|null)=>value===null?"—":value>=1?value.toLocaleString("en-US",{maximumFractionDigits:4}):value.toLocaleString("en-US",{maximumFractionDigits:8});
export default function CoinExplorer({onAnalyze}:Props){
 const [coins,setCoins]=useState<Coin[]>([]),[query,setQuery]=useState(""),[loading,setLoading]=useState(true),[error,setError]=useState(""),[source,setSource]=useState("Binance Spot"),[updatedAt,setUpdatedAt]=useState("");
 async function load(q=""){
  setLoading(true);setError("");
  try{const response=await fetch("/api/coins/search"+(q?"?q="+encodeURIComponent(q):""),{headers:{accept:"application/json"},cache:"no-store"});const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Binance market list unavailable");setCoins(payload.data||[]);setSource(payload.source||"Binance Spot");setUpdatedAt(payload.receivedAt||"");}
  catch(e){setError(e instanceof Error?e.message:"Binance market data unavailable");}
  finally{setLoading(false);}
 }
 useEffect(()=>{void load("");},[]);
 useEffect(()=>{const timer=window.setTimeout(()=>{if(query.trim().length>=1)void load(query.trim());else if(!query.trim())void load("");},350);return()=>window.clearTimeout(timer);},[query]);
 const fmt=(v:number|null)=>v===null?"—":"$"+money(v);
 return <div style={{display:"grid",gap:14}}>
  <section className="panel" style={{padding:16}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
    <div><div className="eyebrow">BINANCE · LIVE SPOT MARKETS</div><h2 style={{margin:"5px 0"}}>Coin Explorer</h2><p style={{margin:0,color:"var(--muted)",fontSize:12}}>Binance-এ ট্রেড হওয়া USDT pair খুঁজে সরাসরি analysis করো।</p></div>
    <button className="outline-btn" onClick={()=>void load(query.trim())} disabled={loading}><RefreshCw size={14} style={{marginRight:6}}/>{loading?"Loading…":"Refresh"}</button>
   </div>
   <div style={{display:"flex",gap:8,marginTop:15}}><div style={{position:"relative",flex:1}}><Search size={16} style={{position:"absolute",left:12,top:13,color:"var(--muted)"}}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search coin or pair (SUI, PEPE, BTCUSDT)" style={{width:"100%",boxSizing:"border-box",padding:"11px 12px 11px 36px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)"}}/></div></div>
   <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap",marginTop:10,fontSize:10,color:"var(--muted)"}}><span>Source: {source}</span><span>{coins.length} pairs · {updatedAt?new Date(updatedAt).toLocaleTimeString():""}</span></div>
   {error&&<div className="auth-message error" style={{marginTop:12}}>{error}</div>}
  </section>
  <section className="panel" style={{padding:0,overflow:"hidden"}}>
   <div className="panel-head" style={{padding:"14px 16px"}}><div><h2>{query.trim()?"Search results":"Top 100 by 24h quote volume"}</h2><p>Binance Spot · USDT pairs</p></div><span className="signal-count">PUBLIC DATA</span></div>
   {loading?<div className="empty-state"><Activity size={20}/><b>Loading Binance markets…</b></div>:coins.length===0?<div className="empty-state"><b>No matching USDT pair found</b><span>Binance Spot-এ pairটি listed আছে কি না যাচাই করো।</span></div>:
    <div style={{overflowX:"auto"}}><div style={{minWidth:620}}>
     <div style={{display:"grid",gridTemplateColumns:"minmax(150px,2fr) 1fr 1fr 1fr 110px",gap:10,padding:"9px 16px",fontSize:9,color:"var(--muted)",letterSpacing:1,borderBottom:"1px solid var(--border-soft)"}}><span>ASSET / PAIR</span><span>PRICE</span><span>24H CHANGE</span><span>24H VOLUME</span><span>ANALYSIS</span></div>
     {coins.map(coin=>{const change=coin.price_change_percentage_24h;return <div key={coin.pair} style={{display:"grid",gridTemplateColumns:"minmax(150px,2fr) 1fr 1fr 1fr 110px",gap:10,alignItems:"center",padding:"11px 16px",borderBottom:"1px solid var(--border-soft)",fontSize:12}}>
      <div style={{display:"flex",alignItems:"center",gap:9,minWidth:0}}><div className="coin-icon">{coin.symbol.slice(0,1)}</div><div style={{minWidth:0}}><b>{coin.symbol}</b><small style={{display:"block",color:"var(--muted)"}}>{coin.pair}</small></div></div>
      <b>{fmt(coin.current_price)}</b>
      <span style={{color:change===null?"var(--muted)":change>=0?"#42d2a3":"#f07883",whiteSpace:"nowrap"}}>{change===null?"—":<>{change>=0?<TrendingUp size={12} style={{verticalAlign:"middle"}}/>:<TrendingDown size={12} style={{verticalAlign:"middle"}}/>} {change>=0?"+":""}{change.toFixed(2)}%</>}</span>
      <span>{coin.total_volume===null?"—":fmt(coin.total_volume)}</span>
      <button className="outline-btn" style={{fontSize:10,padding:"7px 8px"}} onClick={()=>onAnalyze(coin.pair)}>Analyze <ArrowUpRight size={12}/></button>
     </div>;})}
    </div></div>}
   <div style={{padding:"12px 16px",fontSize:10,color:"var(--muted)",lineHeight:1.6}}>শুধু Binance Spot-এ তালিকাভুক্ত USDT pair দেখানো হয়। Futures analysis-এর জন্য Signal Center থেকে Futures নির্বাচন করো। কোনো pair Binance-এ না থাকলে সেটির signal তৈরি করা হবে না।</div>
  </section>
 </div>;
}