import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, Bell, BookOpen, CandlestickChart, ChevronDown, CircleHelp, Clock3, Command, Compass, Crosshair, Eye, Filter, Globe2, Layers3, Menu, Moon, Newspaper, PanelLeftClose, Plus, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Sun, Target, TrendingDown, TrendingUp, Wallet, X } from 'lucide-react';

const WATCH = [
  ['BTCUSDT','Bitcoin','BTC'],['ETHUSDT','Ethereum','ETH'],['BNBUSDT','BNB','BNB'],['SOLUSDT','Solana','SOL'],
  ['XRPUSDT','XRP','XRP'],['DOGEUSDT','Dogecoin','DOGE'],['ADAUSDT','Cardano','ADA'],['AVAXUSDT','Avalanche','AVAX'],
  ['LINKUSDT','Chainlink','LINK'],['SUIUSDT','Sui','SUI'],['TONUSDT','Toncoin','TON'],['TRXUSDT','TRON','TRX']
];
const fmt = (n, digits=2) => Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}) : '—';
const compact = n => n >= 1e9 ? (n/1e9).toFixed(2)+'B' : n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e3 ? (n/1e3).toFixed(2)+'K' : fmt(n);
const intervals = ['1m','5m','15m','1h','4h','1d'];

function ChartPanel({symbol, interval, candles, loading}) {
  const host = useRef(null);
  const chartRef = useRef(null);
  useEffect(() => {
    if (!host.current) return;
    const chart = createChart(host.current, {
      autoSize: true, layout: { background: { type: 'solid', color: '#101720' }, textColor: '#8190a3', fontFamily: 'Inter, ui-sans-serif, system-ui', fontSize: 11 },
      grid: { vertLines: { color: '#1b2632' }, horzLines: { color: '#1b2632' } },
      rightPriceScale: { borderColor: '#263341' }, timeScale: { borderColor: '#263341', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 }, handleScroll: true, handleScale: true
    });
    const series = chart.addSeries(CandlestickSeries, { upColor:'#19b88a', downColor:'#ef6472', borderUpColor:'#19b88a', borderDownColor:'#ef6472', wickUpColor:'#19b88a', wickDownColor:'#ef6472' });
    chartRef.current = {chart,series};
    const resize = new ResizeObserver(entries => { if(entries[0]) chart.applyOptions({width:entries[0].contentRect.width}); });
    resize.observe(host.current);
    return () => { resize.disconnect(); chart.remove(); chartRef.current = null; };
  }, []);
  useEffect(() => {
    if (!chartRef.current || !candles?.length) return;
    chartRef.current.series.setData(candles);
    chartRef.current.chart.timeScale().fitContent();
  }, [candles]);
  return <div className="chart-wrap"><div className="chart-label">{loading ? 'Updating market data…' : 'Binance Spot · Public market data'} <span>•</span> {symbol.replace('USDT','')}/USDT</div><div className="chart-canvas" ref={host}/>{!candles?.length && <div className="chart-empty">Waiting for candle data</div>}</div>;
}

function App() {
  const [symbol,setSymbol] = useState('BTCUSDT');
  const [interval,setInterval] = useState('15m');
  const [market,setMarket] = useState('Futures');
  const [theme,setTheme] = useState('dark');
  const [prices,setPrices] = useState({});
  const [candles,setCandles] = useState([]);
  const [loading,setLoading] = useState(true);
  const [updated,setUpdated] = useState(null);
  const [query,setQuery] = useState('');
  const [tab,setTab] = useState('Overview');
  const [mobileNav,setMobileNav] = useState(false);
  const [watchOnly,setWatchOnly] = useState(false);
  const [demoBalance,setDemoBalance] = useState(10000);
  const [paperTrades,setPaperTrades] = useState([]);
  const [notice,setNotice] = useState('');

  const active = WATCH.find(c=>c[0]===symbol) || WATCH[0];
  const ticker = prices[symbol];
  const price = Number(ticker?.lastPrice || 0);
  const change = Number(ticker?.priceChangePercent || 0);
  const filtered = WATCH.filter(c => (c[0]+c[1]+c[2]).toLowerCase().includes(query.toLowerCase()));
  const candleUrl = useMemo(()=>`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=160`,[symbol,interval]);

  useEffect(()=>{
    let live=true;
    const load=async()=>{
      try {
        const r=await fetch('https://api.binance.com/api/v3/ticker/24hr');
        if(!r.ok) throw new Error('Market endpoint unavailable');
        const data=await r.json();
        if(live){const next={}; data.forEach(x=>{if(WATCH.some(w=>w[0]===x.symbol)) next[x.symbol]=x;});setPrices(next);setUpdated(new Date());}
      } catch { if(live) setNotice('Market feed temporarily unavailable. Retrying automatically.'); }
    };
    load(); const id=setInterval(load,15000);
    return ()=>{live=false;clearInterval(id);};
  },[]);
  useEffect(()=>{
    let live=true; setLoading(true);
    fetch(candleUrl).then(r=>{if(!r.ok)throw new Error('Candle request failed');return r.json();})
      .then(rows=>{if(live){setCandles(rows.map(k=>({time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4]})));setLoading(false);}})
      .catch(()=>{if(live){setCandles([]);setLoading(false);setNotice('Could not load candles from Binance. Check your connection or try again.');}});
    return ()=>{live=false;};
  },[candleUrl]);

  const analysis = useMemo(()=>{
    if(candles.length<30) return {bias:'WAIT',score:0,reason:'Waiting for enough candle history to evaluate market structure.'};
    const closes=candles.map(c=>c.close);
    const avg=n=>closes.slice(-n).reduce((a,b)=>a+b,0)/n;
    const e20=avg(20), e50=avg(50), last=closes.at(-1), prev=closes.at(-2);
    const momentum=(last-prev)/prev*100;
    let score=50;
    if(last>e20) score+=12; else score-=12;
    if(e20>e50) score+=15; else score-=15;
    if(momentum>0.08) score+=8; else if(momentum<-.08) score-=8;
    const bias=score>=65?'LONG':score<=35?'SHORT':'WAIT';
    return {bias,score:Math.max(0,Math.min(100,score)),e20,e50,momentum,reason:`Price is ${last>e20?'above':'below'} the 20-period average and the short-term trend is ${e20>e50?'positive':'negative'} versus the 50-period average.`};
  },[candles]);
  const navItems=[['Overview',Activity],['Market Scanner',Compass],['Spot Analysis',CandlestickChart],['Futures Analysis',Layers3],['Paper Trading',Wallet],['Trade Journal',BookOpen],['News & Events',Newspaper]];
  const showNotice = msg => {setNotice(msg);setTimeout(()=>setNotice(''),4200);};
  const addPaperTrade=()=>{
    if(!price){showNotice('Market price is not available yet.');return;}
    if(analysis.bias==='WAIT'){showNotice('No paper trade opened: current setup is WAIT.');return;}
    const side=analysis.bias;
    const trade={id:Date.now(),symbol,side,entry:price,quantity:0.01,status:'OPEN',time:new Date().toLocaleString()};
    setPaperTrades(t=>[trade,...t]);setDemoBalance(b=>b- price*0.01);
    showNotice(`Paper ${side} opened for ${active[2]} (0.01 units).`);
  };
  const closeTrade=id=>{
    const t=paperTrades.find(x=>x.id===id); if(!t)return;
    const pnl=(price-t.entry)*t.quantity*(t.side==='LONG'?1:-1);
    setDemoBalance(b=>b+t.entry*t.quantity+pnl);
    setPaperTrades(a=>a.map(x=>x.id===id?{...x,status:'CLOSED',exit:price,pnl}:x));
  };

  return <div className={`app ${theme}`}>
    <aside className={`sidebar ${mobileNav?'open':''}`}>
      <div className="brand"><div className="brand-mark"><Activity size={19}/></div><div><b>Crypto<span>Bot</span></b><small>TRADING TERMINAL</small></div><button className="icon-btn mobile-close" onClick={()=>setMobileNav(false)}><X size={17}/></button></div>
      <div className="workspace"><div className="workspace-icon"><Command size={16}/></div><div><b>Market Desk</b><small>Personal workspace</small></div><ChevronDown size={14}/></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav>{navItems.map(([name,Icon])=><button key={name} className={`nav-item ${tab===name?'selected':''}`} onClick={()=>{setTab(name);setMobileNav(false);}}><Icon size={17}/><span>{name}</span>{name==='Paper Trading'&&<i>{paperTrades.filter(t=>t.status==='OPEN').length}</i>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="status-line"><span className="pulse"/> PUBLIC DATA FEED</div><div className="sidebar-note"><ShieldCheck size={15}/><span>No exchange keys connected<br/>Manual execution only</span></div><div className="profile"><div className="avatar">M</div><div><b>Mishad</b><small>Free workspace</small></div><Settings2 size={16}/></div></div>
    </aside>
    {mobileNav&&<div className="scrim" onClick={()=>setMobileNav(false)}/>}
    <main className="main">
      <header className="topbar"><div className="top-left"><button className="icon-btn mobile-menu" onClick={()=>setMobileNav(true)}><Menu size={19}/></button><span className="crumb">Workspace</span><span className="slash">/</span><b>{tab}</b></div><div className="top-actions"><div className="feed"><span className="pulse"/> <span>LIVE MARKET</span></div><button className="icon-btn" onClick={()=>setTheme(t=>t==='dark'?'light':'dark')} title="Toggle theme">{theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}</button><button className="icon-btn" onClick={()=>showNotice('Notifications are not configured yet.')}><Bell size={17}/></button><div className="top-avatar">M</div></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow">WEDNESDAY, NOVEMBER 11, 2026 <span>·</span> MARKET OVERVIEW</div><h1>{tab==='Overview'?'Market overview':tab}</h1><p>Read the market. Respect the risk. Trade with a plan.</p></div><div className="heading-actions"><button className="secondary-btn" onClick={()=>{setLoading(true);fetch(candleUrl).then(r=>r.json()).then(rows=>setCandles(rows.map(k=>({time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4]})))).finally(()=>setLoading(false));}}><RefreshCw size={15}/> Refresh</button><button className="primary-btn" onClick={()=>setTab('Paper Trading')}><Plus size={16}/> New paper trade</button></div></div>
        {notice&&<div className="notice"><CircleHelp size={15}/>{notice}<button onClick={()=>setNotice('')}><X size={14}/></button></div>}
        <section className="market-strip">
          <div className="market-stat"><span>BTC / USDT</span><b>{prices.BTCUSDT?'$'+fmt(prices.BTCUSDT.lastPrice):'Loading…'}</b><em className={Number(prices.BTCUSDT?.priceChangePercent)>=0?'positive':'negative'}>{prices.BTCUSDT?fmt(prices.BTCUSDT.priceChangePercent)+'%':'—'}</em></div>
          <div className="market-stat"><span>ETH / USDT</span><b>{prices.ETHUSDT?'$'+fmt(prices.ETHUSDT.lastPrice):'Loading…'}</b><em className={Number(prices.ETHUSDT?.priceChangePercent)>=0?'positive':'negative'}>{prices.ETHUSDT?fmt(prices.ETHUSDT.priceChangePercent)+'%':'—'}</em></div>
          <div className="market-stat"><span>BNB / USDT</span><b>{prices.BNBUSDT?'$'+fmt(prices.BNBUSDT.lastPrice):'Loading…'}</b><em className={Number(prices.BNBUSDT?.priceChangePercent)>=0?'positive':'negative'}>{prices.BNBUSDT?fmt(prices.BNBUSDT.priceChangePercent)+'%':'—'}</em></div>
          <div className="market-stat"><span>SOL / USDT</span><b>{prices.SOLUSDT?'$'+fmt(prices.SOLUSDT.lastPrice):'Loading…'}</b><em className={Number(prices.SOLUSDT?.priceChangePercent)>=0?'positive':'negative'}>{prices.SOLUSDT?fmt(prices.SOLUSDT.priceChangePercent)+'%':'—'}</em></div>
          <div className="market-stat market-update"><span>DATA UPDATED</span><b>{updated?updated.toLocaleTimeString():'Connecting…'}</b><small><span className="pulse"/> Binance public API</small></div>
        </section>
        <div className="section-row"><div><h2>Market workspace</h2><p>Live prices and multi-timeframe chart analysis</p></div><div className="market-toggle"><button className={market==='Spot'?'active':''} onClick={()=>setMarket('Spot')}>Spot</button><button className={market==='Futures'?'active':''} onClick={()=>setMarket('Futures')}>Futures</button></div></div>
        <section className="workspace-grid">
          <div className="panel chart-panel">
            <div className="panel-head"><div className="asset-title"><div className="coin-icon">{active[2].slice(0,1)}</div><div><b>{active[1]} <span>{active[2]}/USDT</span></b><small>Binance · {market} market</small></div><ChevronDown size={14}/></div><div className="chart-tools">{intervals.map(i=><button key={i} className={interval===i?'chosen':''} onClick={()=>setInterval(i)}>{i}</button>)}<button className="tool-icon" onClick={()=>showNotice('Chart indicators are coming in the next build.')}><SlidersHorizontal size={15}/></button></div></div>
            <div className="price-line"><div><strong>{price?'$'+fmt(price,price<1?5:2):'—'}</strong><span className={change>=0?'positive':'negative'}>{price?(change>=0?'+':'')+fmt(change)+'%':'Waiting for feed'} <small>24h</small></span></div><div className="range"><span>24H HIGH</span><b>{ticker?'$'+fmt(ticker.highPrice):'—'}</b><span>24H LOW</span><b>{ticker?'$'+fmt(ticker.lowPrice):'—'}</b></div></div>
            <ChartPanel symbol={symbol} interval={interval} candles={candles} loading={loading}/>
            <div className="chart-foot"><span><span className="legend-dot"/> Candlesticks</span><span>Timeframe: {interval}</span><span>Source: Binance public API</span></div>
          </div>
          <div className="right-stack">
            <div className="panel signal-panel"><div className="panel-title"><div><h3>Setup assessment</h3><p>Rule-based snapshot · Not a prediction</p></div><span className="tiny-live">LIVE</span></div><div className={`signal-badge ${analysis.bias.toLowerCase()}`}>{analysis.bias==='LONG'?<TrendingUp size={19}/>:analysis.bias==='SHORT'?<TrendingDown size={19}/>:<Crosshair size={19}/>}<b>{analysis.bias}</b></div><div className="score-row"><span>Directional score</span><b>{analysis.score}/100</b></div><div className="score-track"><i style={{width:analysis.score+'%'}}/></div><p className="analysis-reason">{analysis.reason}</p><div className="signal-warning"><ShieldCheck size={15}/><span>Signal engine is preliminary. No backtested edge or verified win rate is claimed.</span></div><button className="outline-btn full" onClick={()=>setTab('Futures Analysis')}>View analysis details <ArrowUpRight size={15}/></button></div>
            <div className="panel metrics-panel"><div className="panel-title"><div><h3>Market metrics</h3><p>{active[2]} · 24 hour</p></div><BarChart3 size={17}/></div><div className="metric-row"><span>24h Volume (USDT)</span><b>{ticker?compact(+ticker.quoteVolume):'—'}</b></div><div className="metric-row"><span>24h High</span><b className="positive">{ticker?'$'+fmt(ticker.highPrice):'—'}</b></div><div className="metric-row"><span>24h Low</span><b className="negative">{ticker?'$'+fmt(ticker.lowPrice):'—'}</b></div><div className="metric-row"><span>24h Trades</span><b>{ticker?compact(+ticker.count):'—'}</b></div><div className="metric-row"><span>Market source</span><b className="source-label">Binance</b></div></div>
          </div>
        </section>
        <section className="lower-grid">
          <div className="panel watch-panel"><div className="panel-title"><div><h3>Watchlist</h3><p>Selected liquid markets</p></div><button className="icon-btn" onClick={()=>setWatchOnly(!watchOnly)}><Filter size={16}/></button></div><div className="watch-search"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search assets…"/></div><div className="watch-table"><div className="watch-header"><span>ASSET</span><span>LAST PRICE</span><span>24H CHANGE</span></div>{filtered.map(c=>{const p=prices[c[0]];const up=Number(p?.priceChangePercent)>=0;return <button className={`watch-row ${symbol===c[0]?'active':''}`} key={c[0]} onClick={()=>setSymbol(c[0])}><span className="watch-asset"><i>{c[2][0]}</i><b>{c[2]} <small>{c[1]}</small></b></span><b>{p?'$'+fmt(p.lastPrice,p.lastPrice<1?5:2):'—'}</b><em className={up?'positive':'negative'}>{p?(up?'+':'')+fmt(p.priceChangePercent)+'%':'—'}</em></button>})}</div><div className="table-foot">Prices update every 15 seconds · {filtered.length} assets shown</div></div>
          <div className="panel paper-panel"><div className="panel-title"><div><h3>Paper account</h3><p>Simulated balance · No real funds</p></div><Wallet size={17}/></div><div className="balance-label">AVAILABLE BALANCE</div><div className="balance-value">${fmt(demoBalance)}</div><div className="balance-change"><span className="positive">Virtual USD</span><span>Starting balance: $10,000</span></div><div className="paper-stats"><div><span>OPEN TRADES</span><b>{paperTrades.filter(t=>t.status==='OPEN').length}</b></div><div><span>TOTAL TRADES</span><b>{paperTrades.length}</b></div></div><button className="primary-btn full" onClick={()=>setTab('Paper Trading')}>Open paper trading <ArrowUpRight size={15}/></button><p className="disclaimer">Paper trading is a simulation and does not represent real execution or guaranteed results.</p></div>
        </section>
        {tab==='Paper Trading'&&<section className="panel journal-panel"><div className="panel-title"><div><h3>Paper trade journal</h3><p>Practice entries and review outcomes</p></div><button className="primary-btn" onClick={addPaperTrade}><Plus size={15}/> Open {analysis.bias==='WAIT'?'trade':' '+analysis.bias}</button></div>{paperTrades.length===0?<div className="empty-state">No paper trades yet. A trade can only be opened when the setup assessment is LONG or SHORT.</div>:<div className="trade-list">{paperTrades.map(t=><div className="trade-row" key={t.id}><b>{t.symbol.replace('USDT','')}/USDT <small>{t.side}</small></b><span>Entry: ${fmt(t.entry)}</span><span>{t.status==='OPEN'?'Open':`Exit: $${fmt(t.exit)}`}</span>{t.status==='OPEN'?<button className="secondary-btn" onClick={()=>closeTrade(t.id)}>Close at market</button>:<b className={t.pnl>=0?'positive':'negative'}>{t.pnl>=0?'+':''}${fmt(t.pnl)}</b>}</div>)}</div>}</section>}
        <footer><span>CryptoBot <b>·</b> Designed by Mishad</span><span><ShieldCheck size={13}/> Analysis only · Manual execution · Not financial advice</span></footer>
      </div>
    </main>
  </div>;
}
export default App;