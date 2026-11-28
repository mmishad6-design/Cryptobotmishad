type AssetRow={id:string;name:string;symbol:string;pair:string;image:string;current_price:number|null;market_cap:number|null;market_cap_rank:number|null;total_volume:number|null;price_change_percentage_24h:number|null};
export const onRequestGet=async({request}:{request:Request})=>{
 const u=new URL(request.url),q=(u.searchParams.get("q")||"").trim().toUpperCase().slice(0,30);
 try{
  const [infoResponse,tickerResponse]=await Promise.all([
   fetch("https://api.binance.com/api/v3/exchangeInfo",{headers:{accept:"application/json"},cf:{cacheTtl:300,cacheEverything:true}} as RequestInit),
   fetch("https://api.binance.com/api/v3/ticker/24hr",{headers:{accept:"application/json"},cf:{cacheTtl:15,cacheEverything:true}} as RequestInit)
  ]);
  if(!infoResponse.ok)throw new Error("Binance exchange list HTTP "+infoResponse.status);
  if(!tickerResponse.ok)throw new Error("Binance market ticker HTTP "+tickerResponse.status);
  const [info,tickers]=await Promise.all([infoResponse.json(),tickerResponse.json()]) as [any,any[]];
  const bySymbol=new Map((tickers||[]).map(row=>[row.symbol,row]));
  const assets:AssetRow[]=(info.symbols||[]).filter((s:any)=>s.status==="TRADING"&&s.quoteAsset==="USDT"&&s.isSpotTradingAllowed!==false&&bySymbol.has(s.symbol)).map((s:any)=>{
   const t=bySymbol.get(s.symbol);
   return {id:s.symbol,name:s.baseAsset,symbol:s.baseAsset,pair:s.symbol,image:"",current_price:Number(t.lastPrice),market_cap:null,market_cap_rank:null,total_volume:Number(t.quoteVolume),price_change_percentage_24h:Number(t.priceChangePercent)};
  }).filter((x:AssetRow)=>Number.isFinite(x.current_price)&&Number.isFinite(x.total_volume));
  const filtered=q?assets.filter(x=>x.symbol.includes(q)||x.pair.includes(q)):assets;
  filtered.sort((a,b)=>(b.total_volume||0)-(a.total_volume||0));
  return Response.json({data:filtered.slice(0,100),source:"Binance Spot USDT Markets",receivedAt:new Date().toISOString()},{headers:{"cache-control":"public, max-age=10, s-maxage=15"}});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Binance coin list unavailable.",data:[],source:"Binance",receivedAt:new Date().toISOString()},{status:502,headers:{"cache-control":"no-store"}});}
};