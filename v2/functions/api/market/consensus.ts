const SYMBOL=/^[A-Z0-9]{2,20}USDT$/;
const INTERVALS=new Set(["1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w"]);
const BYBIT:Record<string,string>={"1m":"1","3m":"3","5m":"5","15m":"15","30m":"30","1h":"60","2h":"120","4h":"240","6h":"360","8h":"480","12h":"720","1d":"D","3d":"D","1w":"W"};
type Candle={time:number;open:number;high:number;low:number;close:number;volume:number;source:string;takerRatio?:number};
async function json(url:string){
 const cacheKey=new Request(url,{method:"GET"});
 const cache=caches.default;
 const cached=await cache.match(cacheKey);
 const storedAt=cached?Number(cached.headers.get("x-feed-cached-at")||0):0;
 const ageMs=storedAt?Date.now()-storedAt:Infinity;
 if(cached&&ageMs<=5000)return cached.clone().json();
 try{
  const r=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(7000)});
  if(!r.ok){
   const body=(await r.text()).slice(0,240);
   let detail=body;
   try{const parsed=JSON.parse(body);detail=parsed.msg||parsed.message||parsed.retMsg||body;}catch{}
   throw Error("HTTP "+r.status+(detail?" — "+String(detail).slice(0,160):""));
  }
  const body=await r.text();
  const response=new Response(body,{headers:{"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=60","x-feed-cached-at":String(Date.now())}});
  await cache.put(cacheKey,response);
  return JSON.parse(body);
 }catch(error){
  if(cached&&ageMs<=30000)return cached.clone().json();
  throw error;
 }
}
function failureReason(reason:unknown){
 if(reason instanceof Error){
  if(reason.name==="TimeoutError"||reason.name==="AbortError")return "Request timeout (7s)";
  return reason.message.slice(0,200);
 }
 return String(reason).slice(0,200);
}
async function binance(symbol:string,interval:string,limit:number,market:string,endTime?:number):Promise<Candle[]>{
 const base=market==="Futures"?"https://fapi.binance.com/fapi/v1/klines":"https://api.binance.com/api/v3/klines";
 const p=new URLSearchParams({symbol,interval,limit:String(limit)});if(endTime!==undefined)p.set("endTime",String(endTime));const a=await json(base+"?"+p) as any[];
 return a.map(x=>({time:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],source:"Binance",takerRatio:+x[9]>0&&(+x[5]-+x[9])>0?+x[9]/(+x[5]-+x[9]):undefined}));
}
async function bybit(symbol:string,interval:string,limit:number,market:string,endTime?:number):Promise<Candle[]>{
 const p=new URLSearchParams({category:market==="Futures"?"linear":"spot",symbol,interval:BYBIT[interval],limit:String(limit)});if(endTime!==undefined)p.set("end",String(endTime));
 const a=await json("https://api.bybit.com/v5/market/kline?"+p) as any;
 if(a.retCode!==0||!a.result?.list)throw Error("Bybit unavailable");
 return a.result.list.map((x:string[])=>({time:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],source:"Bybit"})).reverse();
}
async function gateFutures(symbol:string,interval:string,limit:number,endTime?:number):Promise<Candle[]>{
 const bar:Record<string,string>={"1m":"1m","5m":"5m","15m":"15m","30m":"30m","1h":"1h","4h":"4h","8h":"8h","1d":"1d","1w":"7d"};
 if(!bar[interval])throw Error("Interval unsupported by Gate Futures: "+interval);
 const p=new URLSearchParams({contract:symbol.replace(/USDT$/,"_USDT"),interval:bar[interval],limit:String(Math.min(limit,2000))});
 if(endTime!==undefined)p.set("to",String(Math.floor(endTime/1000)));
 const a=await json("https://api.gateio.ws/api/v4/futures/usdt/candlesticks?"+p) as any[];
 if(!Array.isArray(a)||!a.length)throw Error("Gate Futures returned no candles");
 return a.map(x=>{const close=Number(x.c),quoteVolume=Number(x.sum);return {time:Number(x.t)*1000,open:Number(x.o),high:Number(x.h),low:Number(x.l),close,volume:Number.isFinite(quoteVolume)&&close>0?quoteVolume/close:0,source:"Gate"};}).filter(x=>Number.isFinite(x.time)&&x.close>0);
}
async function okx(symbol:string,interval:string,limit:number,market:string,endTime?:number):Promise<Candle[]>{
 const bar:Record<string,string>={"1m":"1m","3m":"3m","5m":"5m","15m":"15m","30m":"30m","1h":"1H","2h":"2H","4h":"4H","6h":"6H","12h":"12H","1d":"1D","1w":"1W"};
 if(!bar[interval])throw Error("Interval unsupported by OKX: "+interval);
 const inst=symbol.replace(/USDT$/,"-USDT")+(market==="Futures"?"-SWAP":"");
 const p=new URLSearchParams({instId:inst,bar:bar[interval],limit:String(Math.min(limit,300))});
 if(endTime!==undefined)p.set("after",String(endTime));
 const a=await json("https://www.okx.com/api/v5/market/candles?"+p) as any;
 if(a.code!=="0"||!a.data?.length)throw Error("OKX unavailable");
 return a.data.map((x:string[])=>({time:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[market==="Futures"?6:5],source:"OKX"})).reverse();
}
export const onRequestGet=async({request}:{request:Request})=>{
 const u=new URL(request.url),symbol=(u.searchParams.get("symbol")||"BTCUSDT").toUpperCase(),interval=u.searchParams.get("interval")||"1h",market=u.searchParams.get("market")==="Futures"?"Futures":"Spot",limit=Number(u.searchParams.get("limit")||240),endRaw=u.searchParams.get("endTime"),endTime=endRaw===null?undefined:Number(endRaw);
 if(endTime!==undefined&&(!Number.isFinite(endTime)||endTime<=0))return Response.json({error:"Invalid endTime."},{status:400});
 if(!SYMBOL.test(symbol)||!INTERVALS.has(interval)||!Number.isInteger(limit)||limit<60||limit>300)return Response.json({error:"Invalid symbol, interval or limit."},{status:400});
 // OKX derivative candle volume is returned in base-currency units (volCcy),
 // while its contract-count volume (vol) is not comparable with Bybit/Binance base volume.
 // Keep all three independent feeds eligible for both latest and paginated history.
 const feedNames=market==="Futures"?["Binance USDⓈ-M","Bybit Linear","OKX USDT Swap","Gate USDT Futures"]:["Binance Spot","Bybit Spot","OKX Spot"];
 const feedTasks=market==="Futures"?[
  binance(symbol,interval,limit,market,endTime),
  bybit(symbol,interval,limit,market,endTime),
  okx(symbol,interval,limit,market,endTime),
  gateFutures(symbol,interval,limit,endTime)
 ]:[
  binance(symbol,interval,limit,market,endTime),
  bybit(symbol,interval,limit,market,endTime),
  okx(symbol,interval,limit,market,endTime)
 ];
 const feeds=await Promise.allSettled(feedTasks);
 const good=feeds.flatMap(x=>x.status==="fulfilled"?[x.value]:[]);
 if(good.length<2)return Response.json({
  error:"At least two independent exchange feeds are required.",
  available:good.length,
  exchanges:feeds.map((x,i)=>({
   name:feedNames[i],
   ok:x.status==="fulfilled",
   ...(x.status==="rejected"?{reason:failureReason(x.reason)}:{})
  }))
 },{status:502});
 const maps=good.map(rows=>new Map(rows.map(c=>[c.time,c]))),common=[...maps[0].keys()].filter(t=>maps.every(m=>m.has(t))).sort((a,b)=>a-b).slice(-limit);
 const data=common.map(time=>{
  const cs=maps.map(m=>m.get(time)!);const median=(v:number[])=>v.sort((a,b)=>a-b)[Math.floor(v.length/2)];
  const open=median(cs.map(c=>c.open)),close=median(cs.map(c=>c.close));
  return {time,open,close,high:Math.max(...cs.map(c=>c.high)),low:Math.min(...cs.map(c=>c.low)),volume:cs.reduce((s,c)=>s+c.volume,0)/cs.length,takerRatio:cs.find(c=>c.takerRatio!==undefined)?.takerRatio??null,sourceCount:cs.length,spreadPct:(Math.max(...cs.map(c=>c.close))-Math.min(...cs.map(c=>c.close)))/close*100};
 });
 return Response.json({data,source:good.map(x=>x[0]?.source),exchanges:good.map(x=>x[0]?.source),market,receivedAt:new Date().toISOString(),consensus:true},{headers:{"cache-control":"public, max-age=2, s-maxage=3"}});
};
