import { Activity, ArrowDownRight, ArrowUpRight, Bell, CandlestickChart, ChevronDown, CircleDot, Command, Crosshair, LayoutDashboard, ListFilter, Search, Settings2, ShieldCheck, SlidersHorizontal, Wallet } from "lucide-react";

const watchlist = [
  { symbol: "BTC", pair: "BTC / USDT", price: "—", change: "+2.41%", up: true },
  { symbol: "ETH", pair: "ETH / USDT", price: "—", change: "+1.18%", up: true },
  { symbol: "SUI", pair: "SUI / USDT", price: "—", change: "-0.62%", up: false },
  { symbol: "SOL", pair: "SOL / USDT", price: "—", change: "+3.06%", up: true },
];

const nav = [
  { label: "Overview", icon: LayoutDashboard, active: true },
  { label: "Market Analysis", icon: CandlestickChart },
  { label: "Signal Center", icon: Crosshair },
  { label: "Portfolio", icon: Wallet },
  { label: "Paper Trading", icon: Activity },
  { label: "Backtesting", icon: SlidersHorizontal },
];

function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">M</div><div><b>CRYPTO<span>BOT</span></b><small>MISHAD EDITION</small></div></div>
        <div className="workspace"><span className="live-dot" /> MARKET WORKSPACE <ChevronDown size={14}/></div>
        <div className="nav-label">WORKSPACE</div>
        <nav>{nav.map(({label, icon: Icon, active}) => <a className={active ? "nav-item active" : "nav-item"} href="#" key={label}><Icon size={17}/>{label}{active && <span className="nav-indicator"/>}</a>)}</nav>
        <div className="nav-label lower">PERSONAL</div>
        <a className="nav-item" href="#"><ListFilter size={17}/> Watchlist</a>
        <a className="nav-item" href="#"><Settings2 size={17}/> Settings</a>
        <div className="sidebar-bottom"><div className="security"><ShieldCheck size={16}/><span>Read-only market access<br/><small>No exchange keys stored</small></span></div><div className="edition">Designed by <b>Mishad</b></div></div>
      </aside>
      <main className="main">
        <header className="topbar"><div className="crumb">Workspace <span>/</span> Overview</div><div className="top-actions"><div className="market-status"><i/> PUBLIC MARKET DATA</div><button className="icon-btn" aria-label="Search"><Search size={18}/></button><button className="icon-btn" aria-label="Notifications"><Bell size={18}/></button><div className="avatar">M</div></div></header>
        <section className="content">
          <div className="page-heading"><div><div className="eyebrow">FRIDAY, NOVEMBER 27, 2026 <span>•</span> MARKET SESSION</div><h1>Market overview</h1><p>Your market intelligence, signals and risk in one place.</p></div><button className="outline-btn"><Command size={15}/> Command center <span>⌘ K</span></button></div>
          <div className="stats-grid">
            <article className="stat-card"><div className="stat-top">TOTAL MARKET CAP <span className="muted-pill">GLOBAL</span></div><div className="stat-value">—</div><div className="stat-foot">Awaiting live market feed</div></article>
            <article className="stat-card"><div className="stat-top">24H VOLUME <span className="muted-pill">SPOT</span></div><div className="stat-value">—</div><div className="stat-foot">Public exchange data</div></article>
            <article className="stat-card"><div className="stat-top">ACTIVE SETUPS <span className="muted-pill">ENGINE</span></div><div className="stat-value">0 <small>signals</small></div><div className="stat-foot">No setup evaluated yet</div></article>
            <article className="stat-card"><div className="stat-top">RISK STATUS <span className="status-safe">● SAFE</span></div><div className="stat-value">NO TRADE</div><div className="stat-foot">Waiting for validated conditions</div></article>
          </div>
          <div className="section-row"><div><h2>Market watch</h2><p>Live pairs selected for monitoring</p></div><button className="text-btn">View all markets <ArrowUpRight size={14}/></button></div>
          <div className="market-table"><div className="table-head"><span>ASSET</span><span>LAST PRICE</span><span>24H CHANGE</span><span>MARKET</span></div>{watchlist.map((coin) => <div className="coin-row" key={coin.symbol}><div className="coin-name"><div className="coin-icon">{coin.symbol.slice(0,1)}</div><div><b>{coin.symbol}</b><small>{coin.pair}</small></div></div><b className="price">{coin.price}</b><span className={coin.up ? "positive" : "negative"}>{coin.up ? <ArrowUpRight size={14}/> : <ArrowDownRight size={14}/>} {coin.change}</span><span className="market-open"><i/> Tracking</span></div>)}</div>
          <div className="bottom-grid"><section className="panel chart-panel"><div className="panel-head"><div><h2>Market structure</h2><p>BTC / USDT · Multi-timeframe analysis</p></div><button className="select-btn">BTC / USDT <ChevronDown size={14}/></button></div><div className="chart-placeholder"><div className="chart-grid"/><div className="chart-center"><CandlestickChart size={25}/><b>Chart engine ready</b><span>Live candles will appear when market data connects.</span></div></div></section><section className="panel signal-panel"><div className="panel-head"><div><h2>Signal intelligence</h2><p>Validated setups only</p></div><span className="signal-count">0 ACTIVE</span></div><div className="empty-state"><div className="empty-icon"><CircleDot size={22}/></div><b>No confirmed setup</b><span>The engine will show a signal only when all required conditions pass.</span><strong>NO TRADE</strong></div></section></div>
          <footer>CRYPTOBOT <span>·</span> MISHAD EDITION <span className="footer-right">MARKET DATA CONNECTION PENDING <i/></span></footer>
        </section>
      </main>
    </div>
  );
}
export default App;
