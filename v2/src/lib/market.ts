export type MarketTicker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
};

type ApiEnvelope<T> = {
  data: T;
  source: string;
  receivedAt: string;
};

const API_BASE = import.meta.env.VITE_MARKET_API_BASE ?? "";

async function request<T>(path: string): Promise<ApiEnvelope<T>> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? `Market API error (${response.status})`);
  }
  return response.json() as Promise<ApiEnvelope<T>>;
}

export function getMarketTickers(symbols = ["BTCUSDT", "ETHUSDT", "SUIUSDT", "SOLUSDT"]) {
  return request<MarketTicker[]>(`/api/market/ticker?symbols=${encodeURIComponent(symbols.join(","))}`);
}

export type Kline = [number, string, string, string, string, string, number, string, number, string, string, string];

export function normalizeKlines(candles: Kline[]): Kline[] {
  const byTime = new Map<number, Kline>();
  for (const candle of candles) {
    if (!Array.isArray(candle) || candle.length < 6) continue;
    const time = Number(candle[0]);
    const open = Number(candle[1]);
    const high = Number(candle[2]);
    const low = Number(candle[3]);
    const close = Number(candle[4]);
    const volume = Number(candle[5]);
    if (![time, open, high, low, close, volume].every(Number.isFinite)) continue;
    if (time <= 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) continue;
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) continue;
    byTime.set(time, candle);
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-500)
    .map(([, candle]) => candle);
}

export async function getMarketKlines(symbol = "BTCUSDT", interval = "1h", limit = 500) {
  const result = await request<Kline[]>(`/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`);
  return { ...result, data: normalizeKlines(result.data) };
}

function candleCloseTime(start:number,interval:string):number {
  if(interval==="1M"){const d=new Date(start);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)-1;}
  if(interval==="1w")return start+7*86_400_000-1;
  const duration=interval==="3d"?3*86_400_000:Number.parseInt(interval,10)*(interval.endsWith("m")?60_000:3_600_000);
  return Number.isFinite(duration)&&duration>0?start+duration-1:start;
}
type ConsensusCandle={time:number;open:number;high:number;low:number;close:number;volume:number;takerRatio:number|null;sourceCount:number;spreadPct:number};
export async function getConsensusKlines(symbol:string,interval:string,limit=240,market:"Spot"|"Futures"="Spot",endTime?:number){
  const cursor=endTime===undefined?"":`&endTime=${Math.floor(endTime)}`;
  const response=await request<ConsensusCandle[]>(
    `/api/market/consensus?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}&market=${market}${cursor}`
  );
  const data:Kline[]=response.data.map(c=>[
    c.time,String(c.open),String(c.high),String(c.low),String(c.close),String(c.volume),
    candleCloseTime(c.time,interval),"",0,String(c.takerRatio??""),"",""
  ]);
  return {...response,data:normalizeKlines(data),exchanges:response.data.length?Math.max(...response.data.map(c=>c.sourceCount)):0,maxSpreadPct:Math.max(0,...response.data.slice(-3).map(c=>c.spreadPct))};
}

/** Fetch a bounded, chronological history by paging backwards across two independent exchanges. */
export async function getConsensusHistory(symbol:string,interval:string,days:number,market:"Spot"|"Futures"="Spot"){
  const cutoff=Date.now()-days*86_400_000;
  let cursor=Date.now(),pages=0,maxSpreadPct=0,exchanges=0;
  const byTime=new Map<number,Kline>();
  while(cursor>cutoff&&pages<40){
    const page=await getConsensusKlines(symbol,interval,300,market,cursor);
    pages++;
    if(page.data.length===0)break;
    exchanges=Math.max(exchanges,page.exchanges);
    maxSpreadPct=Math.max(maxSpreadPct,page.maxSpreadPct);
    for(const candle of page.data)if(+candle[0]>=cutoff)byTime.set(+candle[0],candle);
    const earliest=Math.min(...page.data.map(c=>+c[0]));
    if(!Number.isFinite(earliest)||earliest>=cursor)break;
    cursor=earliest-1;
    if(earliest<=cutoff)break;
  }
  const data=[...byTime.values()].sort((a,b)=>+a[0]-+b[0]);
  return {data,exchanges,maxSpreadPct,pages,receivedAt:new Date().toISOString()};
}
