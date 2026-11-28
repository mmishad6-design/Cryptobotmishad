const SYMBOL=/^[A-Z0-9]{2,20}USDT$/;
const INTERVALS=new Set(["1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w"]);
type Candle={time:number;open:number;high:number;low:number;close:number;volume:number;takerRatio:number|null;sourceCount:number;spreadPct:number};
async function getJson(url:string){
 const key=new Request(url,{method:"GET"}),cache=caches.default,cached=await cache.match(key);
 if(cached)return cached.json();
 const response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(9000)});
 if(!response.ok)throw new Error("Binance market data HTTP "+response.status);
 const body=await response.text();
 await cache.put(key,new Response(body,{headers:{"content-type":"application/json","cache-control":"public, max-age=3"}}));
 return JSON.parse(body);
}
export const onRequestGet=async({request}:{request:Request})=>{
 const u=new URL(request.url),symbol=(u.searchParams.get("symbol")||"BTCUSDT").toUpperCase(),interval=u.searchParams.get("interval")||"1h",market=u.searchParams.get("market")==="Futures"?"Futures":"Spot",limit=Number(u.searchParams.get("limit")||240),endRaw=u.searchParams.get("endTime"),endTime=endRaw===null?undefined:Number(endRaw);
 if(endTime!==undefined&&(!Number.isFinite(endTime)||endTime<=0))return Response.json({error:"Invalid endTime."},{status:400});
 if(!SYMBOL.test(symbol)||!INTERVALS.has(interval)||!Number.isInteger(limit)||limit<60||limit>1000)return Response.json({error:"Invalid symbol, interval or limit."},{status:400});
 try{
  const base=market==="Futures"?"https://fapi.binance.com/fapi/v1/klines":"https://api.binance.com/api/v3/klines";
  const p=new URLSearchParams({symbol,interval,limit:String(limit)});if(endTime!==undefined)p.set("endTime",String(endTime));
  const raw=await getJson(base+"?"+p) as any[];
  if(!Array.isArray(raw)||raw.length<60)throw new Error("Binance-এ পর্যাপ্ত candle data পাওয়া যায়নি।");
  const data:Candle[]=raw.map(x=>{
   const volume=Number(x[5]),buy=Number(x[9]),sell=Math.max(0,volume-buy);
   return {time:Number(x[0]),open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),volume,takerRatio:sell>0?buy/sell:null,sourceCount:1,spreadPct:0};
  }).filter(c=>Number.isFinite(c.time)&&c.close>0);
  return Response.json({data,source:market==="Futures"?"Binance USDⓈ-M Futures":"Binance Spot",exchanges:["Binance"],market,consensus:false,receivedAt:new Date().toISOString()},{headers:{"cache-control":"public, max-age=2, s-maxage=3"}});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Binance candle feed unavailable."},{status:502,headers:{"cache-control":"no-store"}});}
};