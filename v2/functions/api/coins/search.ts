type Coin = { id:string; name:string; symbol:string; image:string; current_price:number|null; market_cap:number|null; market_cap_rank:number|null; total_volume:number|null; price_change_percentage_24h:number|null };
const headers = { accept:"application/json" };
async function cachedJson(url:string, ttl=45){
  const key=new Request(url,{method:"GET"});
  const cache=caches.default;
  const hit=await cache.match(key);
  if(hit)return hit.json();
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(9000)});
  if(!response.ok)throw new Error("CoinGecko returned HTTP "+response.status);
  const body=await response.text();
  const out=new Response(body,{headers:{"content-type":"application/json; charset=utf-8","cache-control":"public, max-age="+ttl}});
  await cache.put(key,out);
  return JSON.parse(body);
}
export const onRequestGet=async({request}:{request:Request})=>{
  const url=new URL(request.url),q=(url.searchParams.get("q")||"").trim().slice(0,80);
  try{
    const key=(globalThis as any).COINGECKO_API_KEY as string|undefined;
    const base="https://api.coingecko.com/api/v3";
    let data:any;
    if(q){
      const endpoint=new URL(base+"/search");endpoint.searchParams.set("query",q);
      data=await cachedJson(endpoint.toString(),60);
      const coins=(data.coins||[]).slice(0,25).map((c:any)=>({id:c.id,name:c.name,symbol:String(c.symbol||"").toUpperCase(),image:c.thumb||c.large||"",market_cap_rank:c.market_cap_rank??null,current_price:null,market_cap:null,total_volume:null,price_change_percentage_24h:null}));
      return Response.json({data:coins,source:"CoinGecko Search",receivedAt:new Date().toISOString()},{headers:{"cache-control":"public, max-age=30, s-maxage=60"}});
    }
    const endpoint=new URL(base+"/coins/markets");
    endpoint.searchParams.set("vs_currency","usd");endpoint.searchParams.set("order","market_cap_desc");endpoint.searchParams.set("per_page","100");endpoint.searchParams.set("page","1");endpoint.searchParams.set("sparkline","false");endpoint.searchParams.set("price_change_percentage","24h");
    const payload=await cachedJson(endpoint.toString(),60);
    const coins=(payload||[]).map((c:any)=>({id:c.id,name:c.name,symbol:String(c.symbol||"").toUpperCase(),image:c.image||"",market_cap_rank:c.market_cap_rank??null,current_price:c.current_price??null,market_cap:c.market_cap??null,total_volume:c.total_volume??null,price_change_percentage_24h:c.price_change_percentage_24h??null}));
    return Response.json({data:coins,source:"CoinGecko Markets",receivedAt:new Date().toISOString()},{headers:{"cache-control":"public, max-age=30, s-maxage=60"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Coin market data unavailable",data:[],source:"CoinGecko",receivedAt:new Date().toISOString()},{status:502,headers:{"cache-control":"no-store"}});
  }
};
