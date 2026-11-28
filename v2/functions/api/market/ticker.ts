const ALLOWED=/^[A-Z0-9]{2,20}USDT$/;
export const onRequestGet=async({request}:{request:Request})=>{
 const u=new URL(request.url),requested=(u.searchParams.get("symbols")||"BTCUSDT,ETHUSDT,SUIUSDT,SOLUSDT").split(",").map(s=>s.trim().toUpperCase());
 if(!requested.length||requested.length>20||requested.some(s=>!ALLOWED.test(s)))return Response.json({error:"Invalid symbols. Use up to 20 USDT pairs."},{status:400});
 try{
  const symbols=[...new Set(requested)],endpoint="https://api.binance.com/api/v3/ticker/24hr?symbols="+encodeURIComponent(JSON.stringify(symbols));
  const response=await fetch(endpoint,{headers:{accept:"application/json"},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error("Binance ticker feed HTTP "+response.status);
  const rows=await response.json() as Array<Record<string,string>>;
  const data=rows.map(row=>({symbol:row.symbol,lastPrice:row.lastPrice,priceChangePercent:row.priceChangePercent,quoteVolume:row.quoteVolume,highPrice:row.highPrice,lowPrice:row.lowPrice}));
  if(data.length!==symbols.length)throw new Error("এক বা একাধিক Binance USDT pair পাওয়া যায়নি।");
  return Response.json({data,source:"Binance Spot REST",receivedAt:new Date().toISOString()},{headers:{"cache-control":"public, max-age=2, s-maxage=3"}});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Binance ticker feed unavailable."},{status:502,headers:{"cache-control":"no-store"}});}
};