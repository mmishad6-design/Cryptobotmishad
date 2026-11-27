const SYMBOL=/^[A-Z0-9]{2,20}USDT$/;
const INTERVALS=new Set(["1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w"]);
const BYBIT:Record<string,string>={"1m":"1","3m":"3","5m":"5","15m":"15","30m":"30","1h":"60","2h":"120","4h":"240","6h":"360","8h":"480","12h":"720","1d":"D","3d":"D","1w":"W"};
type Candle={time:number;open:number;high:number;low:number;close:number;volume:number;source:string};
async function json(url:string){const r=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error("HTTP "+r.status);return r.json();}
async function binance(symbol:string,interval:string,limit:number,market:string):Promise<Candle[]>{
 const base=market==="Futures"?"https://fapi.binance.com/fapi/v1/klines":"https://api.binance.com/api/v3/klines";
 const p=new URLSearchParams({symbol,interval,limit:String(limit)});const a=await json(base+"?"+p) as any[];
 return a.map(x=>({time:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],source:"Binance"}));
}
async function bybit(symbol:string,interval:string,limit:number,market:string):Promise<Candle[]>{
 const p=new URLSearchParams({category:market==="Futures"?"linear":"spot",symbol,interval:BYBIT[interval],limit:String(limit)});
 const a=await json("https://api.bybit.com/v5/market/kline?"+p) as any;
 if(a.retCode!==0||!a.result?.list)throw Error("Bybit unavailable");
 return a.result.list.map((x:string[])=>({time:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],source:"Bybit"})).reverse();
}
async function okx(symbol:string,interval:string,limit:number,market:string):Promise<Candle[]>{
 const bar:Record<string,string>={"1m":"1m","3m":"3m","5m":"5m","15m":"15m","30m":"30m","1h":"1H","2h":"2H","4h":"4H","6h":"6H","12h":"12H","1d":"1D","1w":"1W"};
 if(!bar[interval])throw Error("Interval unsupported");
 const inst=symbol.replace(/USDT$/,"-USDT")+(market==="Futures"?"-SWAP":"");
 const p=new URLSearchParams({instId:inst,bar:bar[interval],limit:String(Math.min(limit,300))});
 const a=await json("https://www.okx.com/api/v5/market/candles?"+p) as any;
 if(a.code!=="0"||!a.data?.length)throw Error("OKX unavailable");
 return a.data.map((x:string[])=>({time:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],source:"OKX"})).reverse();
}
export const onRequestGet=async({request}:{request:Request})=>{
 const u=new URL(request.url),symbol=(u.searchParams.get("symbol")||"BTCUSDT").toUpperCase(),interval=u.searchParams.get("interval")||"1h",market=u.searchParams.get("market")==="Futures"?"Futures":"Spot",limit=Number(u.searchParams.get("limit")||240);
 if(!SYMBOL.test(symbol)||!INTERVALS.has(interval)||!Number.isInteger(limit)||limit<60||limit>300)return Response.json({error:"Invalid symbol, interval or limit."},{status:400});
 const feeds=await Promise.allSettled(market==="Futures"?[binance(symbol,interval,limit,market),bybit(symbol,interval,limit,market)]:[binance(symbol,interval,limit,market),bybit(symbol,interval,limit,market),okx(symbol,interval,limit,market)]);
 const good=feeds.flatMap(x=>x.status==="fulfilled"?[x.value]:[]);
 if(good.length<2)return Response.json({error:"At least two independent exchange feeds are required.",available:good.length,exchanges:feeds.map((x,i)=>({name:(market==="Futures"?["Binance USDⓈ-M","Bybit Linear"]:["Binance Spot","Bybit Spot","OKX Spot"])[i],ok:x.status==="fulfilled"}))},{status:502});
 const maps=good.map(rows=>new Map(rows.map(c=>[c.time,c]))),common=[...maps[0].keys()].filter(t=>maps.every(m=>m.has(t))).sort((a,b)=>a-b).slice(-limit);
 const data=common.map(time=>{
  const cs=maps.map(m=>m.get(time)!);const median=(v:number[])=>v.sort((a,b)=>a-b)[Math.floor(v.length/2)];
  const open=median(cs.map(c=>c.open)),close=median(cs.map(c=>c.close));
  return {time,open,close,high:Math.max(...cs.map(c=>c.high)),low:Math.min(...cs.map(c=>c.low)),volume:cs.reduce((s,c)=>s+c.volume,0)/cs.length,sourceCount:cs.length,spreadPct:(Math.max(...cs.map(c=>c.close))-Math.min(...cs.map(c=>c.close)))/close*100};
 });
 return Response.json({data,source:good.map(x=>x[0]?.source),exchanges:good.map(x=>x[0]?.source),market,receivedAt:new Date().toISOString(),consensus:true},{headers:{"cache-control":"public, max-age=2, s-maxage=3"}});
};
