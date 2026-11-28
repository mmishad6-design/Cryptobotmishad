const SYMBOL=/^[A-Z0-9]{2,20}USDT$/;
const INTERVALS=new Set(["1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w","1M"]);
export const onRequestGet=async({request}:{request:Request})=>{
 const u=new URL(request.url),symbol=(u.searchParams.get("symbol")||"BTCUSDT").toUpperCase(),interval=u.searchParams.get("interval")||"1h",limit=Number(u.searchParams.get("limit")||500);
 if(!SYMBOL.test(symbol))return Response.json({error:"Invalid USDT symbol."},{status:400});
 if(!INTERVALS.has(interval))return Response.json({error:"Unsupported candle interval."},{status:400});
 if(!Number.isInteger(limit)||limit<1||limit>1000)return Response.json({error:"Limit must be between 1 and 1000."},{status:400});
 try{
  const p=new URLSearchParams({symbol,interval,limit:String(limit)});
  const response=await fetch("https://api.binance.com/api/v3/klines?"+p,{headers:{accept:"application/json"},signal:AbortSignal.timeout(9000)});
  if(!response.ok)throw new Error("Binance candle feed HTTP "+response.status);
  const data=await response.json();
  return Response.json({data,source:"Binance Spot REST",receivedAt:new Date().toISOString()},{headers:{"cache-control":"public, max-age=3, s-maxage=5"}});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Binance candle feed unavailable."},{status:502,headers:{"cache-control":"no-store"}});}
};