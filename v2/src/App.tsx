import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, createChart, type UTCTimestamp } from "lightweight-charts";
import type { Session } from "@supabase/supabase-js";
import {
  Activity, ArrowDownRight, ArrowUpRight, Bell, CandlestickChart,
  ChevronDown, CircleDot, Command, Crosshair, LayoutDashboard,
  ListFilter, Search, Settings2, ShieldCheck, SlidersHorizontal,
  Wallet, LogOut, LockKeyhole, Mail, UserRound, LoaderCircle, Eye, EyeOff
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { getMarketTickers, getMarketKlines, type MarketTicker, type Kline } from "./lib/market";
import { connectTickerStream, connectKlineStream } from "./lib/market-ws";
import { calculateIndicators, calculateMarketStructure, getEmaTrend } from "./lib/indicators";

const CHART_INTERVALS = ["1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w","1M"] as const;

const CHART_INTERVAL_MS: Record<string, number> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
  "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
  "4h": 14_400_000, "6h": 21_600_000, "8h": 28_800_000,
  "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
  "1w": 604_800_000,
};

function getCandleBucketStart(now: number, interval: string) {
  if (interval === "1M") {
    const date = new Date(now);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }
  if (interval === "1w") {
    const date = new Date(now);
    const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return dayStart - ((date.getUTCDay() + 6) % 7) * 86_400_000;
  }
  const duration = CHART_INTERVAL_MS[interval] ?? 3_600_000;
  return Math.floor(now / duration) * duration;
}

const watchlist = [
  { symbol: "BTC", pair: "BTC / USDT", price: "—", change: "—", up: true },
  { symbol: "ETH", pair: "ETH / USDT", price: "—", change: "—", up: true },
  { symbol: "SUI", pair: "SUI / USDT", price: "—", change: "—", up: false },
  { symbol: "SOL", pair: "SOL / USDT", price: "—", change: "—", up: true },
];
const nav = [
  { label: "Overview", icon: LayoutDashboard, active: true },
  { label: "Market Analysis", icon: CandlestickChart },
  { label: "Signal Center", icon: Crosshair },
  { label: "Portfolio", icon: Wallet },
  { label: "Paper Trading", icon: Activity },
  { label: "Backtesting", icon: SlidersHorizontal },
];

function AuthScreen({ onContinueGuest }: { onContinueGuest: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "signup") {
        const { data, error: authError } = await supabase.auth.signUp({
          email, password, options: {
            data: { display_name: displayName.trim() },
          },
        });
        if (authError) throw authError;
        setMessage(data.session
          ? "Account created. Your workspace is ready."
          : "Account created. You can sign in once email confirmation is disabled in project settings.");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed. Please try again.");
    } finally { setBusy(false); }
  }

  async function resetPassword() {
    if (!supabase || !email) { setError("Enter your email address first."); return; }
    setBusy(true); setError(""); setMessage("");
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    setBusy(false);
    if (resetError) setError(resetError.message);
    else setMessage("Password reset instructions have been sent if this email is registered.");
  }

  return <div className="auth-shell">
    <div className="auth-card">
      <div className="brand auth-brand"><div className="brand-mark">M</div><div><b>CRYPTO<span>BOT</span></b><small>MISHAD EDITION</small></div></div>
      <div className="auth-kicker">PRIVATE MARKET WORKSPACE</div>
      <h1>{mode === "login" ? "Welcome back." : "Create your workspace."}</h1>
      <p className="auth-description">Sign in to access your watchlists, risk settings and paper-trading records.</p>
      <div className="auth-tabs">
        <button className={mode === "login" ? "selected" : ""} onClick={() => {setMode("login");setError("");setMessage("");}}>Sign in</button>
        <button className={mode === "signup" ? "selected" : ""} onClick={() => {setMode("signup");setError("");setMessage("");}}>Create account</button>
      </div>
      <form onSubmit={submit} className="auth-form">
        {mode === "signup" && <label><span><UserRound size={14}/> Display name</span><input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Your name" autoComplete="name" required /></label>}
        <label><span><Mail size={14}/> Email address</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required /></label>
        <label><span><LockKeyhole size={14}/> Password</span><div className="password-input-wrap"><input type={showPassword ? "text" : "password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required /><button type="button" className="password-toggle" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></label>
        {mode === "login" && <button type="button" className="forgot-btn" onClick={resetPassword}>Forgot password?</button>}
        {error && <div className="auth-message error">{error}</div>}
        {message && <div className="auth-message success">{message}</div>}
        <button className="auth-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin"/> : null}{mode === "login" ? "Sign in to CryptoBot" : "Create account"}</button>
      </form>
      <button type="button" className="guest-entry-btn" onClick={onContinueGuest}>Continue as guest <ArrowUpRight size={15}/></button>
      <div className="guest-entry-note">Explore public market tools without creating an account. Sign in later to access your personal workspace.</div>
      <div className="auth-security"><ShieldCheck size={16}/><span>Public market data only. No exchange API secrets or real-money execution.</span></div>
      <div className="auth-credit">DESIGNED BY MISHAD</div>
    </div>
  </div>;
}

function PasswordRecoveryScreen({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    setBusy(true); setError(""); setMessage("");
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) setError(updateError.message);
    else { setMessage("Password updated successfully."); window.setTimeout(onComplete, 700); }
  }

  return <div className="auth-shell"><div className="auth-card">
    <div className="brand auth-brand"><div className="brand-mark">M</div><div><b>CRYPTO<span>BOT</span></b><small>MISHAD EDITION</small></div></div>
    <div className="auth-kicker">ACCOUNT RECOVERY</div><h1>Set a new password.</h1>
    <p className="auth-description">Choose a new password for your CryptoBot Mishad account.</p>
    <form onSubmit={submit} className="auth-form">
      <label><span><LockKeyhole size={14}/> New password</span><div className="password-input-wrap"><input type={showPassword ? "text" : "password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters" minLength={8} autoComplete="new-password" required /><button type="button" className="password-toggle" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></label>
      <label><span><LockKeyhole size={14}/> Confirm password</span><div className="password-input-wrap"><input type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="Enter the new password again" minLength={8} autoComplete="new-password" required /><button type="button" className="password-toggle" onClick={()=>setShowConfirmPassword(v=>!v)} aria-label={showConfirmPassword ? "Hide password" : "Show password"} title={showConfirmPassword ? "Hide password" : "Show password"}>{showConfirmPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></label>
      {error && <div className="auth-message error">{error}</div>}
      {message && <div className="auth-message success">{message}</div>}
      <button className="auth-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin"/> : null}Update password</button>
    </form>
    <div className="auth-credit">DESIGNED BY MISHAD</div>
  </div></div>;
}


type PaperAccount = { id: string; initial_balance: number; current_balance: number; quote_asset: string };
type PaperPosition = { id: string; symbol: string; market_type: "spot"|"futures"; side: "long"|"short"; leverage: number; quantity: number; entry_price: number; stop_loss: number|null; take_profit: number|null; status: string; opened_at: string; fees: number };
type PaperTrade = { id: string; symbol: string; market_type: string; side: string; action: string; quantity: number; price: number; fee: number; realized_pnl: number|null; executed_at: string };

function PaperTradingPanel({ session, marketTickers }: { session: Session | null; marketTickers: Record<string, MarketTicker> }) {
  const [account, setAccount] = useState<PaperAccount|null>(null);
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [marketType, setMarketType] = useState<"spot"|"futures">("spot");
  const [side, setSide] = useState<"long"|"short">("long");
  const [leverage, setLeverage] = useState("1");
  const [quantity, setQuantity] = useState("0.001");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const livePrice = marketTickers[symbol] ? Number(marketTickers[symbol].lastPrice) : 0;
  const currentEntry = Number(entryPrice) > 0 ? Number(entryPrice) : livePrice;
  const qty = Number(quantity);
  const lev = marketType === "spot" ? 1 : Number(leverage);
  const estimatedNotional = qty * currentEntry;
  const estimatedMargin = marketType === "spot" ? estimatedNotional : estimatedNotional / lev;
  const openFee = estimatedNotional * 0.0004;

  async function loadData() {
    if (!supabase || !session) return;
    setLoading(true);
    const { data: accounts, error: accountError } = await supabase.from("paper_accounts").select("id,initial_balance,current_balance,quote_asset").eq("user_id",session.user.id).order("created_at",{ascending:true}).limit(1);
    if (accountError) { setError(accountError.message); setLoading(false); return; }
    let activeAccount = accounts?.[0] as PaperAccount|undefined;
    if (!activeAccount) {
      const { data: created, error: createError } = await supabase.from("paper_accounts").insert({user_id:session.user.id,name:"Demo Account",quote_asset:"USDT",initial_balance:1000,current_balance:1000}).select("id,initial_balance,current_balance,quote_asset").single();
      if (createError) { setError(createError.message); setLoading(false); return; }
      activeAccount = created as PaperAccount;
    }
    setAccount(activeAccount);
    const [positionResult, tradeResult] = await Promise.all([
      supabase.from("paper_positions").select("id,symbol,market_type,side,leverage,quantity,entry_price,stop_loss,take_profit,status,opened_at,fees").eq("account_id",activeAccount.id).order("opened_at",{ascending:false}),
      supabase.from("paper_trades").select("id,symbol,market_type,side,action,quantity,price,fee,realized_pnl,executed_at").eq("account_id",activeAccount.id).order("executed_at",{ascending:false}).limit(50),
    ]);
    if (positionResult.error) setError(positionResult.error.message);
    else setPositions((positionResult.data||[]) as PaperPosition[]);
    if (tradeResult.error) setError(tradeResult.error.message);
    else setTrades((tradeResult.data||[]) as PaperTrade[]);
    setLoading(false);
  }

  useEffect(() => { void loadData(); }, [session?.user.id]);

  async function openPosition(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !session) return;
    setBusy(true); setError(""); setMessage("");
    const price = currentEntry;
    if (!price || !Number.isFinite(price)) { setError("Live price unavailable. Enter a valid entry price."); setBusy(false); return; }
    const { error: rpcError } = await supabase.rpc("open_paper_position", {
      p_symbol:symbol,p_market_type:marketType,p_side:side,p_leverage:lev,p_quantity:qty,p_entry_price:price,
      p_stop_loss:stopLoss ? Number(stopLoss) : null,p_take_profit:takeProfit ? Number(takeProfit) : null,p_notes:notes || null,
    });
    setBusy(false);
    if (rpcError) setError(rpcError.message);
    else { setMessage("Paper position opened successfully."); setStopLoss("");setTakeProfit("");setNotes("");await loadData(); }
  }

  async function closePosition(position: PaperPosition) {
    if (!supabase) return;
    const price = marketTickers[position.symbol] ? Number(marketTickers[position.symbol].lastPrice) : 0;
    if (!price) { setError("Live price unavailable. Cannot close at a verified market price."); return; }
    if (!window.confirm(`Close ${position.symbol} at ${price.toLocaleString()} USDT?`)) return;
    setBusy(true);setError("");setMessage("");
    const { error: rpcError } = await supabase.rpc("close_paper_position",{p_position_id:position.id,p_exit_price:price});
    setBusy(false);
    if (rpcError) setError(rpcError.message);
    else { setMessage(`${position.symbol} position closed.`);await loadData(); }
  }

  async function resetAccount() {
    if (!supabase || !window.confirm("Reset demo account to its initial balance? This permanently clears all paper positions and trade history.")) return;
    setBusy(true);setError("");setMessage("");
    const { error: rpcError } = await supabase.rpc("reset_paper_account");
    setBusy(false);
    if (rpcError) setError(rpcError.message);
    else { setMessage("Demo account reset. Trade history and positions cleared.");await loadData(); }
  }

  const openPositions = positions.filter(p=>p.status==="open");
  const closedPositions = positions.filter(p=>p.status==="closed");
  const unrealized = openPositions.reduce((sum,p)=>{const px=marketTickers[p.symbol]?Number(marketTickers[p.symbol].lastPrice):Number(p.entry_price);return sum+(p.side==="long"?(px-Number(p.entry_price)):(Number(p.entry_price)-px))*Number(p.quantity);},0);
  const money = (value:number) => value.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  if (!session) return <section className="panel user-empty-panel"><div className="empty-state"><div className="empty-icon"><LockKeyhole size={22}/></div><b>Sign in to use Paper Trading</b><span>Guest users can explore public market data. Create an account to save demo positions and trade history privately.</span></div></section>;

  return <div className="paper-workspace">
    <div className="paper-summary-grid">
      <article className="stat-card"><div className="stat-top">AVAILABLE BALANCE <span className="muted-pill">DEMO</span></div><div className="stat-value">{loading?"—":money(Number(account?.current_balance||0))} <small>USDT</small></div><div className="stat-foot">Reserved margin is excluded</div></article>
      <article className="stat-card"><div className="stat-top">OPEN POSITIONS</div><div className="stat-value">{openPositions.length}</div><div className="stat-foot">Active virtual trades</div></article>
      <article className="stat-card"><div className="stat-top">UNREALIZED PNL</div><div className={unrealized>=0?"stat-value paper-profit":"stat-value paper-loss"}>{unrealized>=0?"+":""}{money(unrealized)} <small>USDT</small></div><div className="stat-foot">Estimated from latest public market prices</div></article>
      <article className="stat-card"><div className="stat-top">CLOSED POSITIONS</div><div className="stat-value">{closedPositions.length}</div><div className="stat-foot">Completed demo trades</div></article>
    </div>
    <div className="paper-layout">
      <section className="panel paper-order-panel">
        <div className="panel-head"><div><h2>New paper order</h2><p>Manual execution · Virtual funds only</p></div><span className="signal-count">0.04% FEE</span></div>
        <form className="paper-form" onSubmit={openPosition}>
          <label>Asset<select value={symbol} onChange={e=>{setSymbol(e.target.value);setEntryPrice("");}}>{["BTCUSDT","ETHUSDT","SUIUSDT","SOLUSDT"].map(s=><option key={s} value={s}>{s.replace("USDT"," / USDT")}</option>)}</select></label>
          <div className="paper-form-row"><label>Market<select value={marketType} onChange={e=>{const v=e.target.value as "spot"|"futures";setMarketType(v);if(v==="spot"){setSide("long");setLeverage("1");}}}><option value="spot">Spot</option><option value="futures">Futures</option></select></label><label>Direction<select value={side} onChange={e=>setSide(e.target.value as "long"|"short")}><option value="long">Long / Buy</option><option value="short" disabled={marketType==="spot"}>Short / Sell</option></select></label></div>
          {marketType==="futures" && <label>Leverage<select value={leverage} onChange={e=>setLeverage(e.target.value)}>{["1","2","3","5","10","20"].map(v=><option key={v} value={v}>{v}x</option>)}</select></label>}
          <label>Quantity<input type="number" min="0.00000001" step="any" value={quantity} onChange={e=>setQuantity(e.target.value)} required/></label>
          <label>Entry price (USDT)<input type="number" min="0.00000001" step="any" value={entryPrice} onChange={e=>setEntryPrice(e.target.value)} placeholder={livePrice?String(livePrice):"Waiting for live price"}/></label>
          <div className="paper-form-row"><label>Stop loss (optional)<input type="number" min="0" step="any" value={stopLoss} onChange={e=>setStopLoss(e.target.value)} placeholder="Price"/></label><label>Take profit (optional)<input type="number" min="0" step="any" value={takeProfit} onChange={e=>setTakeProfit(e.target.value)} placeholder="Price"/></label></div>
          <label>Notes (optional)<input value={notes} onChange={e=>setNotes(e.target.value)} maxLength={300} placeholder="Trade thesis or reason"/></label>
          <div className="paper-estimate"><div><span>Live price</span><b>{livePrice?money(livePrice):"—"}</b></div><div><span>Notional</span><b>{currentEntry?money(estimatedNotional):"—"} USDT</b></div><div><span>Required margin</span><b>{currentEntry?money(estimatedMargin+openFee):"—"} USDT</b></div></div>
          {error && <div className="auth-message error">{error}</div>}{message && <div className="auth-message success">{message}</div>}
          <button className="auth-submit paper-submit" disabled={busy||loading||!currentEntry||qty<=0||!Number.isFinite(qty)}>{busy?"Processing…":`Open ${side==="long"?"Long":"Short"} Position`}</button>
        </form>
        <button className="paper-reset-btn" onClick={resetAccount} disabled={busy||loading}>Reset demo balance & history</button>
      </section>
      <section className="panel paper-positions-panel">
        <div className="panel-head"><div><h2>Open positions</h2><p>Mark-to-market using public live prices</p></div><button className="text-btn" onClick={()=>void loadData()}>Refresh</button></div>
        {loading?<div className="paper-empty">Loading your demo account…</div>:openPositions.length===0?<div className="paper-empty">No open positions. Create your first paper order.</div>:<div className="paper-position-list">{openPositions.map(p=>{const px=marketTickers[p.symbol]?Number(marketTickers[p.symbol].lastPrice):Number(p.entry_price);const pnl=(p.side==="long"?(px-Number(p.entry_price)):(Number(p.entry_price)-px))*Number(p.quantity);return <article className="paper-position" key={p.id}><div className="paper-position-top"><div><b>{p.symbol}</b><small>{p.market_type.toUpperCase()} · {p.side.toUpperCase()} · {p.leverage}x</small></div><strong className={pnl>=0?"paper-profit":"paper-loss"}>{pnl>=0?"+":""}{money(pnl)} USDT</strong></div><div className="paper-position-stats"><span>Entry <b>{money(Number(p.entry_price))}</b></span><span>Mark <b>{money(px)}</b></span><span>Qty <b>{p.quantity}</b></span><span>SL <b>{p.stop_loss?money(Number(p.stop_loss)):"—"}</b></span><span>TP <b>{p.take_profit?money(Number(p.take_profit)):"—"}</b></span></div><button className="paper-close-btn" onClick={()=>void closePosition(p)} disabled={busy||!marketTickers[p.symbol]}>Close at market price</button></article>})}</div>}
      </section>
    </div>
    <section className="panel paper-history-panel"><div className="panel-head"><div><h2>Trade history</h2><p>Latest 50 paper executions</p></div></div>{trades.length===0?<div className="paper-empty">Your completed and open trade activity will appear here.</div>:<div className="paper-history-table"><div className="table-head"><span>TIME</span><span>PAIR / ACTION</span><span>QTY</span><span>PRICE</span><span>FEE</span><span>NET PNL</span></div>{trades.map(t=><div className="paper-history-row" key={t.id}><span>{new Date(t.executed_at).toLocaleString()}</span><span><b>{t.symbol}</b><small>{t.market_type.toUpperCase()} · {t.action.toUpperCase()} · {t.side.toUpperCase()}</small></span><span>{t.quantity}</span><span>{money(Number(t.price))}</span><span>{money(Number(t.fee))}</span><b className={Number(t.realized_pnl||0)>=0?"paper-profit":"paper-loss"}>{t.realized_pnl===null?"—":money(Number(t.realized_pnl))}</b></div>)}</div>}</section>
    <div className="paper-disclaimer"><ShieldCheck size={15}/> Paper trading only. Prices use public exchange market feeds; no real orders are sent to any exchange.</div>
  </div>;
}

function Dashboard({ session, onSignIn }: { session: Session | null; onSignIn: () => void }) {
  const [signingOut, setSigningOut] = useState(false);
  const [activePage, setActivePage] = useState("Overview");
  const [chartSymbol, setChartSymbol] = useState("BTCUSDT");
  const [chartInterval, setChartInterval] = useState("1h");
  const [enabledIndicators, setEnabledIndicators] = useState({ ema20: true, ema50: true, ema100: false, ema200: false, sma20: false, sma50: false, sma200: false, vwap: false, bollinger: false });
  const [mtfRows, setMtfRows] = useState<Record<string, { trend: "Bullish" | "Bearish" | "Neutral"; loading: boolean }>>({});
  const [orderBook, setOrderBook] = useState<{ bids: [string,string][]; asks: [string,string][]; updatedAt: string; error: string }>({ bids: [], asks: [], updatedAt: "", error: "" });
  const [candles, setCandles] = useState<Kline[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState("");
  const [chartUpdatedAt, setChartUpdatedAt] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [userRole, setUserRole] = useState<"admin" | "super_admin" | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [siteSettings, setSiteSettings] = useState({
    maintenance_mode: false,
    announcement_enabled: false,
    announcement: "",
    trading_enabled: false,
    min_signal_quality: 85,
  });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [databaseStatus, setDatabaseStatus] = useState<"checking" | "online" | "offline">("checking");
  const [workerStatus, setWorkerStatus] = useState<"checking" | "online" | "offline">("checking");
  const [marketTickers, setMarketTickers] = useState<Record<string, MarketTicker>>({});
  const [marketUpdatedAt, setMarketUpdatedAt] = useState("");
  const [marketError, setMarketError] = useState("");
  const [marketSource, setMarketSource] = useState("Connecting");
  const [marketWsStatus, setMarketWsStatus] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const [chartSource, setChartSource] = useState("Connecting");
  const [chartWsStatus, setChartWsStatus] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  useEffect(() => {
    let alive = true;
    let wsConnected = false;
    const refresh = async () => {
      if (wsConnected) return;
      try {
        const result = await getMarketTickers();
        if (!alive || wsConnected) return;
        setMarketTickers(Object.fromEntries(result.data.map((ticker) => [ticker.symbol, ticker])));
        setMarketUpdatedAt(result.receivedAt);
        setMarketSource(result.source);
        setMarketError("");
      } catch (error) {
        if (alive && !wsConnected) setMarketError(error instanceof Error ? error.message : "Market feed unavailable");
      }
    };
    void refresh();
    const stopStream = connectTickerStream({
      onData: ticker => {
        if (!alive) return;
        wsConnected = true;
        setMarketTickers(current => ({ ...current, [ticker.symbol]: ticker }));
        setMarketUpdatedAt(new Date().toISOString());
        setMarketError("");
      },
      onStatus: (status, source) => {
        if (!alive) return;
        if (status !== "connected") wsConnected = false;
        setMarketWsStatus(status);
        setMarketSource(source);
        if (!wsConnected) void refresh();
      },
    });
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => { alive = false; stopStream(); window.clearInterval(timer); };
  }, []);
  // Keep the active candle moving from the live ticker feed as well as
  // the exchange kline stream. This is a visual OHLC fallback if kline WS
  // packets are delayed or blocked; it uses the actual exchange last price.
  const liveChartPrice = marketTickers[chartSymbol]?.lastPrice;
  const indicatorValues = useMemo(() => calculateIndicators(candles), [candles]);
  const marketStructure = useMemo(() => calculateMarketStructure(candles), [candles]);
  const bestBid = Number(orderBook.bids[0]?.[0] ?? 0);
  const bestAsk = Number(orderBook.asks[0]?.[0] ?? 0);
  const spread = bestBid > 0 && bestAsk > 0 ? bestAsk - bestBid : null;
  const bidDepth = orderBook.bids.slice(0, 10).reduce((sum, level) => sum + Number(level[0]) * Number(level[1]), 0);
  const askDepth = orderBook.asks.slice(0, 10).reduce((sum, level) => sum + Number(level[0]) * Number(level[1]), 0);
  const depthImbalance = bidDepth + askDepth > 0 ? ((bidDepth - askDepth) / (bidDepth + askDepth)) * 100 : null;
  const bidWall = orderBook.bids.reduce((best, level) => Number(level[1]) > Number(best?.[1] ?? 0) ? level : best, orderBook.bids[0]);
  const askWall = orderBook.asks.reduce((best, level) => Number(level[1]) > Number(best?.[1] ?? 0) ? level : best, orderBook.asks[0]);
  useEffect(() => {
    const price = Number(liveChartPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    const now = Date.now();
    const bucketStart = getCandleBucketStart(now, chartInterval);
    const bucketEnd = chartInterval === "1M"
      ? Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1) - 1
      : bucketStart + (CHART_INTERVAL_MS[chartInterval] ?? 3_600_000) - 1;
    setCandles(current => {
      const next = [...current];
      const last = next[next.length - 1];
      if (last && Number(last[0]) === bucketStart) {
        next[next.length - 1] = [
          last[0], last[1],
          String(Math.max(Number(last[2]), price)),
          String(Math.min(Number(last[3]), price)),
          String(price), last[5], last[6], String(bucketEnd),
          last[8], last[9], last[10], last[11],
        ];
        return next;
      }
      if (last && Number(last[0]) > bucketStart) return current;
      next.push([bucketStart, String(price), String(price), String(price), String(price), "0", 0, String(bucketEnd), 0, "0", "0", "0"]);
      return next.slice(-120);
    });
    setChartUpdatedAt(new Date(now).toISOString());
  }, [liveChartPrice, chartInterval]);

  useEffect(() => {
    let alive = true;
    let firstLoad = true;
    let wsConnected = false;
    const refreshCandles = async () => {
      if (wsConnected) return;
      try {
        const result = await getMarketKlines(chartSymbol, chartInterval, 120);
        if (alive && !wsConnected) { setCandles(result.data); setChartSource(result.source); setChartUpdatedAt(result.receivedAt); setChartError(""); }
      } catch (error) {
        if (alive && !wsConnected) setChartError(error instanceof Error ? error.message : "Chart data unavailable");
      } finally {
        if (alive && firstLoad) { setChartLoading(false); firstLoad = false; }
      }
    };
    setChartLoading(true); setChartError("");
    void refreshCandles();
    const stopStream = connectKlineStream(chartSymbol, chartInterval, {
      onData: candle => {
        if (!alive) return;
        wsConnected = true;
        setCandles(current => {
          const merged = new Map(current.map(item => [Number(item[0]), item]));
          merged.set(Number(candle[0]), candle);
          return [...merged.values()].sort((a, b) => Number(a[0]) - Number(b[0])).slice(-120);
        });
        setChartUpdatedAt(new Date().toISOString());
        setChartError("");
        if (firstLoad) { setChartLoading(false); firstLoad = false; }
      },
      onStatus: (status, source) => {
        if (!alive) return;
        if (status !== "connected") wsConnected = false;
        setChartWsStatus(status);
        setChartSource(source);
        if (!wsConnected) void refreshCandles();
      },
    });
    const timer = window.setInterval(() => void refreshCandles(), 60000);
    return () => { alive = false; stopStream(); window.clearInterval(timer); };
  }, [chartSymbol, chartInterval]);
  useEffect(() => {
    let alive = true;
    let busy = false;
    const refreshOrderBook = async () => {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch(`https://api.binance.com/api/v3/depth?symbol=${encodeURIComponent(chartSymbol)}&limit=20`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Order book unavailable (${response.status})`);
        const payload = await response.json() as { bids: [string,string][]; asks: [string,string][] };
        if (alive) setOrderBook({ bids: payload.bids ?? [], asks: payload.asks ?? [], updatedAt: new Date().toISOString(), error: "" });
      } catch (error) {
        if (alive) setOrderBook(current => ({ ...current, error: error instanceof Error ? error.message : "Order book unavailable" }));
      } finally { busy = false; }
    };
    void refreshOrderBook();
    const timer = window.setInterval(() => void refreshOrderBook(), 10000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [chartSymbol]);

  useEffect(() => {
    let alive = true;
    const intervals = ["15m", "1h", "4h", "1d", "1w"];
    setMtfRows(Object.fromEntries(intervals.map(interval => [interval, { trend: "Neutral" as const, loading: true }])));
    Promise.all(intervals.map(async interval => {
      try {
        const result = await getMarketKlines(chartSymbol, interval, 100);
        return [interval, getEmaTrend(result.data)] as const;
      } catch {
        return [interval, "Neutral" as const] as const;
      }
    })).then(results => {
      if (!alive) return;
      setMtfRows(Object.fromEntries(results.map(([interval, trend]) => [interval, { trend, loading: false }])));
    });
    return () => { alive = false; };
  }, [chartSymbol]);

  useEffect(() => {
    let alive = true;
    if (supabase && session) {
      Promise.all([
        supabase.from("profiles").select("display_name").eq("id", session.user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", session.user.id).maybeSingle(),
      ]).then(([profileResult, roleResult]) => {
        if (!alive) return;
        if (profileResult.data?.display_name) setDisplayName(profileResult.data.display_name);
        const role = roleResult.data?.role;
        if (role === "admin" || role === "super_admin") setUserRole(role);
      });
    }
    return () => { alive = false; };
  }, [session?.user.id]);
  useEffect(() => {
    if (!adminOpen || !userRole || !supabase) return;
    let alive = true;
    setSettingsLoading(true);
    setSettingsError("");
    supabase.from("site_settings")
      .select("maintenance_mode,announcement_enabled,announcement,trading_enabled,min_signal_quality")
      .eq("id", true).single()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setDatabaseStatus("offline");
          setSettingsError(error.message);
        } else {
          setDatabaseStatus("online");
          if (data) setSiteSettings({
            maintenance_mode: data.maintenance_mode,
            announcement_enabled: data.announcement_enabled,
            announcement: data.announcement,
            trading_enabled: data.trading_enabled,
            min_signal_quality: data.min_signal_quality,
          });
        }
        setSettingsLoading(false);
      });
    fetch("/api/health").then(response => {
      if (!response.ok) throw new Error("Worker health check failed");
      return response.json();
    }).then(() => { if (alive) setWorkerStatus("online"); })
      .catch(() => { if (alive) setWorkerStatus("offline"); });
    return () => { alive = false; };
  }, [adminOpen, userRole]);

  async function saveSiteSettings() {
    if (!supabase || !userRole) return;
    setSettingsSaving(true); setSettingsError(""); setSettingsMessage("");
    const { error } = await supabase.from("site_settings").update({
      maintenance_mode: siteSettings.maintenance_mode,
      announcement_enabled: siteSettings.announcement_enabled,
      announcement: siteSettings.announcement,
      trading_enabled: siteSettings.trading_enabled,
      min_signal_quality: siteSettings.min_signal_quality,
    }).eq("id", true);
    setSettingsSaving(false);
    if (error) setSettingsError(error.message);
    else setSettingsMessage("Settings saved securely to Supabase.");
  }

  async function signOut() {
    if (!supabase || !session) { onSignIn(); return; }
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) { window.alert(error.message); setSigningOut(false); }
  }
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">M</div><div><b>CRYPTO<span>BOT</span></b><small>MISHAD EDITION</small></div></div>
      <div className="workspace"><span className="live-dot" /> MARKET WORKSPACE <ChevronDown size={14}/></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{nav.map(({label, icon: Icon, active}) => <button className={activePage === label ? "nav-item active" : "nav-item"} type="button" onClick={() => {setActivePage(label);setAdminOpen(false);}} key={label}><Icon size={17}/>{label}{activePage === label && <span className="nav-indicator"/>}</button>)}</nav>
      {userRole && <><div className="nav-label lower">ADMINISTRATION</div><button className={adminOpen ? "nav-item active admin-nav" : "nav-item admin-nav"} onClick={() => setAdminOpen(true)}><ShieldCheck size={17}/> Admin Control {adminOpen && <span className="nav-indicator"/>}</button></>}
      <div className="nav-label lower">PERSONAL</div>
      <button className={activePage === "Watchlist" ? "nav-item active" : "nav-item"} onClick={() => {setActivePage("Watchlist");setAdminOpen(false);}}><ListFilter size={17}/> Watchlist</button>
      <button className={activePage === "Settings" ? "nav-item active" : "nav-item"} onClick={() => {setActivePage("Settings");setAdminOpen(false);}}><Settings2 size={17}/> Settings</button>
      <div className="sidebar-bottom"><div className="security"><ShieldCheck size={16}/><span>Read-only market access<br/><small>No exchange keys stored</small></span></div><div className="edition">Designed by <b>Mishad</b></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="crumb">Workspace <span>/</span> {adminOpen ? "Admin Control" : "Overview"}</div><div className="top-actions"><div className="market-status"><i/> {userRole ? userRole === "super_admin" ? "SUPER ADMIN" : "ADMIN" : session ? "AUTHENTICATED WORKSPACE" : "GUEST MODE"}</div><button className="icon-btn" aria-label="Search"><Search size={18}/></button><button className="icon-btn" aria-label="Notifications"><Bell size={18}/></button><div className="avatar">{(displayName || session?.user.email || "G").slice(0,1).toUpperCase()}</div>{session ? <button className="icon-btn" aria-label="Sign out" title={session.user.email} onClick={signOut} disabled={signingOut}><LogOut size={17}/></button> : <button className="guest-signin-btn" onClick={onSignIn}>Sign in</button>}</div></header>
      <section className="content">
        {adminOpen && userRole ? <>
          <div className="page-heading"><div><div className="eyebrow">RESTRICTED AREA <span>•</span> {userRole === "super_admin" ? "SUPER ADMIN" : "ADMIN"}</div><h1>Admin control center</h1><p>Manage website configuration and monitor connected services.</p></div><button className="outline-btn" onClick={() => setAdminOpen(false)}>Back to overview</button></div>
          <div className="admin-welcome"><ShieldCheck size={22}/><div><b>{userRole === "super_admin" ? "Super Admin access verified" : "Admin access verified"}</b><span>{session?.user.email} · Permissions are enforced by Supabase Row Level Security.</span></div><span className="admin-role-pill">{userRole === "super_admin" ? "FULL ACCESS" : "ADMIN"}</span></div>
          <div className="admin-section-heading"><div><h2>Website controls</h2><p>Changes are saved to the protected site settings table.</p></div>{settingsLoading && <span className="admin-inline-status">Loading settings…</span>}</div>
          <div className="admin-settings-grid">
            <article className="admin-settings-card">
              <div className="admin-control-row"><div><b>Maintenance mode</b><p>Configuration switch for planned maintenance.</p></div><label className="admin-switch"><input type="checkbox" checked={siteSettings.maintenance_mode} onChange={e=>setSiteSettings(s=>({...s,maintenance_mode:e.target.checked}))}/><span/></label></div>
              <div className="admin-control-row"><div><b>Public announcement</b><p>Enable or disable the site announcement setting.</p></div><label className="admin-switch"><input type="checkbox" checked={siteSettings.announcement_enabled} onChange={e=>setSiteSettings(s=>({...s,announcement_enabled:e.target.checked}))}/><span/></label></div>
              <label className="admin-field"><span>Announcement message</span><textarea value={siteSettings.announcement} onChange={e=>setSiteSettings(s=>({...s,announcement:e.target.value}))} maxLength={240} placeholder="Write a short announcement for users…"/></label>
              <div className="admin-control-row"><div><b>Signal engine setting</b><p>Enable flag for the future signal engine.</p></div><label className="admin-switch"><input type="checkbox" checked={siteSettings.trading_enabled} onChange={e=>setSiteSettings(s=>({...s,trading_enabled:e.target.checked}))}/><span/></label></div>
              <label className="admin-field"><span>Minimum signal quality <b>{siteSettings.min_signal_quality}%</b></span><input type="range" min="50" max="100" step="1" value={siteSettings.min_signal_quality} onChange={e=>setSiteSettings(s=>({...s,min_signal_quality:Number(e.target.value)}))}/></label>
              {settingsError && <div className="auth-message error">{settingsError}</div>}
              {settingsMessage && <div className="auth-message success">{settingsMessage}</div>}
              <button className="auth-submit admin-save" onClick={saveSiteSettings} disabled={settingsSaving || settingsLoading}>{settingsSaving ? <LoaderCircle size={15} className="spin"/> : null}Save website settings</button>
              <div className="admin-config-note"><LockKeyhole size={14}/> Settings persist in Supabase. Site-wide maintenance enforcement and signal-engine behavior are not active yet.</div>
            </article>
            <article className="admin-settings-card">
              <div className="admin-section-heading compact"><div><h2>System health</h2><p>Live checks from this admin session.</p></div></div>
              <div className="health-row"><span><Activity size={16}/> Cloudflare Worker API</span><strong className={workerStatus}>{workerStatus === "online" ? "ONLINE" : workerStatus === "offline" ? "OFFLINE" : "CHECKING"}</strong></div>
              <div className="health-row"><span><ShieldCheck size={16}/> Supabase database / RLS</span><strong className={databaseStatus}>{databaseStatus === "online" ? "ONLINE" : databaseStatus === "offline" ? "ERROR" : "CHECKING"}</strong></div>
              <div className="health-row"><span><CandlestickChart size={16}/> Live market feed</span><strong className={marketError ? "offline" : marketUpdatedAt ? "online" : "checking"}>{marketError ? "ERROR" : marketUpdatedAt ? "LIVE" : "CHECKING"}</strong></div>
              <div className="health-foot">Market feed last received: {marketUpdatedAt ? new Date(marketUpdatedAt).toLocaleString() : "Not received yet"}</div>
              <button className="outline-btn health-refresh" onClick={()=>{setAdminOpen(false);window.setTimeout(()=>setAdminOpen(true),50);}}>Refresh health checks</button>
            </article>
          </div>
          <div className="admin-grid admin-future-grid">
            <article className="admin-card"><div className="admin-card-icon"><UserRound size={18}/></div><b>User management</b><p>Account directory, role assignment and account suspension require a protected server-side admin endpoint.</p><small>SECURE API · PLANNED</small></article>
            <article className="admin-card"><div className="admin-card-icon"><Crosshair size={18}/></div><b>Trading system</b><p>Signal engine execution and paper-trading controls will be connected after the engine is implemented.</p><small>ENGINE · PLANNED</small></article>
          </div>
          <div className="admin-security-note"><LockKeyhole size={15}/> No service-role key is exposed in the browser. Admin updates pass through Supabase RLS policies.</div>
        </> : <><div className="page-heading"><div><div className="eyebrow">{session ? "PRIVATE WORKSPACE" : "PUBLIC GUEST WORKSPACE"} <span>•</span> {session?.user.email || "Browsing without an account"}</div><h1>Market overview</h1><p>Your market intelligence, signals and risk in one place.</p></div><button className="outline-btn"><Command size={15}/> Command center <span>⌘ K</span></button></div>
        <div className="stats-grid">
          <article className="stat-card"><div className="stat-top">TOTAL MARKET CAP <span className="muted-pill">GLOBAL</span></div><div className="stat-value">—</div><div className="stat-foot">Market cap feed not connected</div></article>
          <article className="stat-card"><div className="stat-top">WATCHLIST VOLUME <span className="muted-pill">24H SPOT</span></div><div className="stat-value">{Object.values(marketTickers).reduce((sum, ticker) => sum + Number(ticker.quoteVolume || 0), 0).toLocaleString("en-US", {maximumFractionDigits:0})} <small>USDT</small></div><div className="stat-foot">24h quote volume · live market source</div></article>
          <article className="stat-card"><div className="stat-top">ACTIVE SETUPS <span className="muted-pill">ENGINE</span></div><div className="stat-value">0 <small>signals</small></div><div className="stat-foot">No setup evaluated yet</div></article>
          <article className="stat-card"><div className="stat-top">RISK STATUS <span className="status-safe">● SAFE</span></div><div className="stat-value">NO TRADE</div><div className="stat-foot">Waiting for validated conditions</div></article>
        </div>
        <div className="section-row"><div><h2>Live Market</h2><p>{marketError ? `Feed error: ${marketError}` : marketUpdatedAt ? `${marketSource} · Last update ${new Date(marketUpdatedAt).toLocaleTimeString()}` : "Connecting to live exchange stream…"}</p></div><div className={marketError ? "market-feed-state offline" : marketUpdatedAt ? "market-feed-state online" : "market-feed-state"}><i/>{marketError ? "FEED ERROR" : marketUpdatedAt ? `LIVE · ${marketWsStatus === "connected" ? "WEBSOCKET" : "REST BACKUP"}` : "CONNECTING"}</div></div>
        <div className="market-table live-market-table"><div className="table-head"><span>ASSET</span><span>LAST PRICE</span><span>24H CHANGE</span><span>24H VOLUME</span><span>STATUS</span></div>{watchlist.map(coin => { const live = marketTickers[`${coin.symbol}USDT`]; const change = live ? Number(live.priceChangePercent) : null; return <button type="button" className="coin-row coin-row-button" key={coin.symbol} onClick={() => { setChartSymbol(`${coin.symbol}USDT`); setActivePage("Market Analysis"); }}><div className="coin-name"><div className="coin-icon">{coin.symbol.slice(0,1)}</div><div><b>{coin.symbol}</b><small>{coin.pair}</small></div></div><b className="price">{live ? Number(live.lastPrice).toLocaleString("en-US", {maximumFractionDigits:8}) : "—"}</b><span className={change !== null && change < 0 ? "negative" : "positive"}>{change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</span><span className="market-volume">{live ? (Number(live.quoteVolume)/1e6).toLocaleString("en-US",{maximumFractionDigits:2})+"M USDT" : "—"}</span><span className="market-open"><i/> {live ? "LIVE" : "WAITING"}</span></button>; })}</div>
        <div className="bottom-grid"><section className="panel chart-panel"><div className="panel-head"><div><h2>Live Candlestick Chart</h2><p>{chartSymbol.replace("USDT"," / USDT")} · {chartInterval} OHLC candles · live WebSocket updates</p></div><div className="chart-controls compact-chart-controls"><select aria-label="Chart timeframe" value={chartInterval} onChange={e=>setChartInterval(e.target.value)}>{CHART_INTERVALS.map(t=><option key={t} value={t}>{t.toUpperCase()}</option>)}</select><button className="select-btn" onClick={() => setActivePage("Market Analysis")}>Open analysis <ArrowUpRight size={14}/></button></div></div><div className="chart-placeholder"><div className="chart-grid"/>{chartLoading ? <div className="chart-center">Loading live candles…</div> : chartError ? <div className="chart-center">{chartError}</div> : candles.length > 0 ? <CandlestickChartView key={`${chartSymbol}-${chartInterval}`} candles={candles} enabledIndicators={enabledIndicators} structure={marketStructure}/> : <div className="chart-center"><CandlestickChart size={25}/><b>No candle data</b><span>{marketError || "Waiting for live candle feed."}</span></div>}</div></section><section className="panel signal-panel"><div className="panel-head"><div><h2>Signal intelligence</h2><p>Validated setups only</p></div><span className="signal-count">0 ACTIVE</span></div><div className="empty-state"><div className="empty-icon"><CircleDot size={22}/></div><b>No confirmed setup</b><span>The engine will show a signal only when all required conditions pass.</span><strong>NO TRADE</strong></div></section></div>
        {!adminOpen && activePage !== "Overview" && <div className="user-page">
          <div className="page-heading"><div><div className="eyebrow">{session ? "USER WORKSPACE" : "GUEST WORKSPACE"} <span>•</span> {session?.user.email || "Public access"}</div><h1>{activePage}</h1><p>Live public market data · Manual paper trading only.</p></div></div>
          {activePage === "Market Analysis" && <section className="panel full-market-panel">
            <div className="market-toolbar"><div><h2>Price analysis</h2><p>Live exchange OHLC candles</p></div><div className="chart-controls"><select value={chartSymbol} onChange={e=>setChartSymbol(e.target.value)}>{["BTCUSDT","ETHUSDT","SUIUSDT","SOLUSDT"].map(s=><option key={s}>{s}</option>)}</select><select value={chartInterval} onChange={e=>setChartInterval(e.target.value)}>{CHART_INTERVALS.map(t=><option key={t} value={t}>{t.toUpperCase()}</option>)}</select></div></div>
            <div className="chart-meta"><span>LAST PRICE <b>{marketTickers[chartSymbol] ? Number(marketTickers[chartSymbol].lastPrice).toLocaleString("en-US",{minimumFractionDigits:4,maximumFractionDigits:4}) : "—"}</b></span><span>24H CHANGE <b>{marketTickers[chartSymbol] ? Number(marketTickers[chartSymbol].priceChangePercent).toFixed(2)+"%" : "—"}</b></span><span>24H HIGH <b>{marketTickers[chartSymbol] ? Number(marketTickers[chartSymbol].highPrice).toLocaleString("en-US",{minimumFractionDigits:4,maximumFractionDigits:4}) : "—"}</b></span><span>24H LOW <b>{marketTickers[chartSymbol] ? Number(marketTickers[chartSymbol].lowPrice).toLocaleString("en-US",{minimumFractionDigits:4,maximumFractionDigits:4}) : "—"}</b></span><span>24H VOLUME <b>{marketTickers[chartSymbol] ? (Number(marketTickers[chartSymbol].quoteVolume)/1e6).toFixed(2)+"M USDT" : "—"}</b></span></div>
            <div className="live-chart"><div className="chart-grid"/>{chartLoading ? <div className="chart-center">Loading market candles…</div> : chartError ? <div className="chart-center">{chartError}</div> : candles.length ? <CandlestickChartView key={`${chartSymbol}-${chartInterval}`} candles={candles} enabledIndicators={enabledIndicators} structure={marketStructure}/> : <div className="chart-center">No candle data available.</div>}</div>
            <div className="chart-legend"><span className={marketError ? "market-feed-error" : "market-feed-live"}>{chartError ? "FEED ERROR" : chartWsStatus === "connected" ? "LIVE · WS" : chartUpdatedAt ? "REST BACKUP" : "CONNECTING"}</span> {chartSource} · {candles.length} candles · WebSocket updates · REST backup · last tick {chartUpdatedAt ? new Date(chartUpdatedAt).toLocaleTimeString() : "—"} {chartError ? " · "+chartError : ""}</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,padding:"14px 0",borderBottom:"1px solid var(--border-soft)"}}>
              <span style={{fontSize:10,color:"var(--muted)",alignSelf:"center",letterSpacing:1}}>OVERLAYS</span>
              {([{key:"ema20",label:"EMA 20"},{key:"ema50",label:"EMA 50"},{key:"ema100",label:"EMA 100"},{key:"ema200",label:"EMA 200"},{key:"sma20",label:"SMA 20"},{key:"sma50",label:"SMA 50"},{key:"sma200",label:"SMA 200"},{key:"vwap",label:"VWAP"},{key:"bollinger",label:"BOLLINGER"}] as const).map(item=><button key={item.key} onClick={()=>setEnabledIndicators(current=>({...current,[item.key]:!current[item.key]}))} style={{padding:"7px 11px",borderRadius:7,border:"1px solid "+(enabledIndicators[item.key]?"#32745d":"var(--border)"),background:enabledIndicators[item.key]?"#153328":"var(--surface-2)",color:enabledIndicators[item.key]?"#8ce5c2":"var(--text-2)",fontSize:10}}>{item.label} {enabledIndicators[item.key]?"ON":"OFF"}</button>)}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:9,padding:"14px 0"}}>
              {[{label:"RSI (14)",value:indicatorValues.rsi14===null?"—":indicatorValues.rsi14.toFixed(2),hint:indicatorValues.rsi14===null?"Need more candles":indicatorValues.rsi14>=70?"Overbought":indicatorValues.rsi14<=30?"Oversold":"Neutral"},{label:"MACD (12,26,9)",value:indicatorValues.macd===null?"—":indicatorValues.macd.toFixed(4),hint:indicatorValues.macdSignal===null?"Need more candles":indicatorValues.macd!==null&&indicatorValues.macd>indicatorValues.macdSignal?"Above signal":"Below signal"},{label:"ATR (14)",value:indicatorValues.atr14===null?"—":indicatorValues.atr14.toFixed(4),hint:"Volatility measure"}].map(metric=><div key={metric.label} style={{background:"var(--surface-2)",border:"1px solid var(--border-soft)",borderRadius:9,padding:"11px 13px"}}><div style={{fontSize:9,color:"var(--muted)",letterSpacing:1}}>{metric.label}</div><b style={{display:"block",fontSize:17,marginTop:6,fontVariantNumeric:"tabular-nums"}}>{metric.value}</b><small style={{fontSize:10,color:"var(--text-2)"}}>{metric.hint}</small></div>)}
            </div>
            <section style={{padding:"12px 0 16px",borderTop:"1px solid var(--border-soft)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><b style={{fontSize:12}}>Multi-timeframe trend</b><span style={{fontSize:9,color:"var(--muted)"}}>EMA 20 / EMA 50 alignment</span></div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(105px,1fr))",gap:8}}>
                {["15m","1h","4h","1d","1w"].map(interval=>{const row=mtfRows[interval];const tone=row?.trend==="Bullish"?"#42d2a3":row?.trend==="Bearish"?"#f07883":"var(--text-2)";return <div key={interval} style={{background:"var(--surface-2)",border:"1px solid var(--border-soft)",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:10,color:"var(--muted)"}}>{interval.toUpperCase()}</div><b style={{fontSize:12,color:tone,display:"block",marginTop:5}}>{row?.loading?"Loading…":row?.trend??"—"}</b></div>})}
              </div>
              <small style={{display:"block",marginTop:8,color:"var(--muted)",fontSize:10}}>Trend rule: close above EMA 20 above EMA 50 = Bullish; inverse = Bearish. Neutral means mixed or insufficient data.</small>
            </section>
            <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:9,padding:"12px 0",borderTop:"1px solid var(--border-soft)"}}>
              <div style={{background:"var(--surface-2)",border:"1px solid var(--border-soft)",borderRadius:8,padding:12}}><div style={{fontSize:9,color:"var(--muted)",letterSpacing:1}}>MARKET STRUCTURE</div><b style={{display:"block",marginTop:6,fontSize:13,color:marketStructure.trend==="Bullish"?"#42d2a3":marketStructure.trend==="Bearish"?"#f07883":"var(--text)"}}>{marketStructure.event}</b><small style={{fontSize:10,color:"var(--muted)"}}>Pivot-based close confirmation</small></div>
              <div style={{background:"var(--surface-2)",border:"1px solid var(--border-soft)",borderRadius:8,padding:12}}><div style={{fontSize:9,color:"var(--muted)",letterSpacing:1}}>SUPPORT</div><b style={{display:"block",marginTop:6,fontSize:14}}>{marketStructure.support===null?"—":marketStructure.support.toFixed(4)}</b><small style={{fontSize:10,color:"var(--muted)"}}>Nearest confirmed swing low</small></div>
              <div style={{background:"var(--surface-2)",border:"1px solid var(--border-soft)",borderRadius:8,padding:12}}><div style={{fontSize:9,color:"var(--muted)",letterSpacing:1}}>RESISTANCE</div><b style={{display:"block",marginTop:6,fontSize:14}}>{marketStructure.resistance===null?"—":marketStructure.resistance.toFixed(4)}</b><small style={{fontSize:10,color:"var(--muted)"}}>Nearest confirmed swing high</small></div>
            </section>
            <section style={{padding:"12px 0 16px",borderTop:"1px solid var(--border-soft)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><b style={{fontSize:12}}>Order book · Binance Spot</b><small style={{fontSize:10,color:"var(--muted)"}}>{orderBook.updatedAt?new Date(orderBook.updatedAt).toLocaleTimeString():"Waiting for feed"} · refresh 10s</small></div>
              {orderBook.error&&<small style={{color:"#f07883"}}>{orderBook.error}</small>}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(115px,1fr))",gap:8,marginBottom:10}}>
                {[{label:"SPREAD",value:spread===null?"—":spread.toFixed(4)},{label:"DEPTH IMBALANCE",value:depthImbalance===null?"—":(depthImbalance>0?"+":"")+depthImbalance.toFixed(1)+"%"},{label:"BID WALL",value:bidWall?Number(bidWall[0]).toFixed(4):"—"},{label:"ASK WALL",value:askWall?Number(askWall[0]).toFixed(4):"—"}].map(metric=><div key={metric.label} style={{background:"var(--surface-2)",border:"1px solid var(--border-soft)",borderRadius:7,padding:"8px 10px"}}><small style={{fontSize:8,color:"var(--muted)"}}>{metric.label}</small><b style={{display:"block",fontSize:12,marginTop:4}}>{metric.value}</b></div>)}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[{label:"BIDS",rows:orderBook.bids.slice(0,6),color:"#42d2a3"},{label:"ASKS",rows:orderBook.asks.slice(0,6),color:"#f07883"}].map(book=><div key={book.label} style={{background:"var(--surface-2)",border:"1px solid var(--border-soft)",borderRadius:8,padding:10,minWidth:0}}><b style={{fontSize:10,color:book.color}}>{book.label}</b><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:8,fontSize:9,color:"var(--muted)"}}><span>PRICE</span><span style={{textAlign:"right"}}>QTY</span></div>{book.rows.map((level,index)=><div key={index} style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:6,fontSize:10,fontVariantNumeric:"tabular-nums"}}><span style={{color:book.color}}>{Number(level[0]).toFixed(4)}</span><span style={{textAlign:"right"}}>{Number(level[1]).toFixed(4)}</span></div>)}{!book.rows.length&&<small style={{display:"block",marginTop:8,color:"var(--muted)"}}>No data</small>}</div>)}
              </div>
            </section>
            <div className="table-head candle-head"><span>TIME</span><span>OPEN</span><span>HIGH</span><span>LOW</span><span>CLOSE</span></div>{candles.slice(-10).reverse().map(k=><div className="candle-row" key={String(k[0])}><span>{new Date(k[0]).toLocaleString()}</span><span>{Number(k[1]).toFixed(4)}</span><span>{Number(k[2]).toFixed(4)}</span><span>{Number(k[3]).toFixed(4)}</span><b>{Number(k[4]).toFixed(4)}</b></div>)}
          </section>}
          {activePage === "Signal Center" && <section className="panel user-empty-panel"><div className="empty-state"><div className="empty-icon"><Crosshair size={22}/></div><b>NO TRADE · Signal engine not live</b><span>We will not invent BUY/SELL signals. Strategy validation and Bangla rejection reasons will be added before live signals are shown.</span><strong>NO TRADE</strong></div></section>}
          {(activePage === "Portfolio" || activePage === "Paper Trading") && <PaperTradingPanel session={session} marketTickers={marketTickers}/> }
          {activePage === "Backtesting" && <section className="panel user-empty-panel"><div className="empty-state"><div className="empty-icon"><SlidersHorizontal size={22}/></div><b>Backtesting module pending</b><span>Historical candle feed is ready. Strategy rules, fees, slippage and performance reports will be added next.</span></div></section>}
          {activePage === "Watchlist" && <div className="market-table"><div className="table-head"><span>ASSET</span><span>LAST PRICE</span><span>24H CHANGE</span><span>MARKET</span></div>{watchlist.map(coin=>{const live=marketTickers[coin.symbol+"USDT"];const change=live?Number(live.priceChangePercent):null;return <button className="coin-row coin-row-button" key={coin.symbol} onClick={()=>{setChartSymbol(coin.symbol+"USDT");setActivePage("Market Analysis");}}><div className="coin-name"><div className="coin-icon">{coin.symbol[0]}</div><div><b>{coin.symbol}</b><small>{coin.pair}</small></div></div><b className="price">{live?Number(live.lastPrice).toLocaleString("en-US",{maximumFractionDigits:8}):"—"}</b><span className={change!==null&&change<0?"negative":"positive"}>{change===null?"—":change.toFixed(2)+"%"}</span><span className="market-open"><i/>{live?"LIVE":"Connecting"}</span></button>})}</div>}
          {activePage === "Settings" && <section className="panel user-empty-panel"><h2>Workspace settings</h2><p>Account: {session?.user.email || "Guest (not signed in)"}</p><p>Market data: Binance public Spot</p><p>Trading: Manual paper trading only</p><p>Exchange API credentials: Not used</p></section>}
        </div>}
        {!adminOpen && <footer>CRYPTOBOT <span>·</span> MISHAD EDITION <span className="footer-right">{session ? "SUPABASE AUTH CONNECTED" : "GUEST ACCESS"} <i/></span></footer>}{adminOpen && userRole && <footer>CRYPTOBOT <span>·</span> RESTRICTED ADMIN AREA <span className="footer-right">ROLE VERIFIED <i/></span></footer>}</>}
      </section>
    </main>
  </div>;
}

function CandlestickChartView({ candles, enabledIndicators, structure }: { candles: Kline[]; enabledIndicators: { ema20: boolean; ema50: boolean; ema100: boolean; ema200: boolean; sma20: boolean; sma50: boolean; sma200: boolean; vwap: boolean; bollinger: boolean }; structure: { support: number | null; resistance: number | null } }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleSeriesRef = useRef<ReturnType<ReturnType<typeof createChart>["addSeries"]> | null>(null);
  const volumeSeriesRef = useRef<ReturnType<ReturnType<typeof createChart>["addSeries"]> | null>(null);
  const overlaySeriesRef = useRef<Record<string, any>>({});
  const structureSeriesRef = useRef<{ support: any; resistance: any } | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "#0b1219" },
        textColor: "#8496a9",
        fontFamily: '"DM Mono", ui-monospace, monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "#26374655" },
        horzLines: { color: "#26374655" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#263746" },
      timeScale: {
        borderColor: "#263746",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#42d2a3",
      downColor: "#f07883",
      wickUpColor: "#42d2a3",
      wickDownColor: "#f07883",
      borderVisible: false,
      lastValueVisible: true,
      priceLineVisible: true,
      priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
    });
    const overlaySeries = {
      ema20: chart.addSeries(LineSeries, { color: "#e6bd67", lineWidth: 2, priceLineVisible: false, lastValueVisible: false }),
      ema50: chart.addSeries(LineSeries, { color: "#63a8ed", lineWidth: 2, priceLineVisible: false, lastValueVisible: false }),
      ema100: chart.addSeries(LineSeries, { color: "#bd8a56", lineWidth: 2, priceLineVisible: false, lastValueVisible: false }),
      ema200: chart.addSeries(LineSeries, { color: "#c28be8", lineWidth: 2, priceLineVisible: false, lastValueVisible: false }),
      sma20: chart.addSeries(LineSeries, { color: "#e5e7eb", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }),
      sma50: chart.addSeries(LineSeries, { color: "#94a3b8", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }),
      sma200: chart.addSeries(LineSeries, { color: "#64748b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }),
      vwap: chart.addSeries(LineSeries, { color: "#f39b61", lineWidth: 2, priceLineVisible: false, lastValueVisible: false }),
      bbUpper: chart.addSeries(LineSeries, { color: "#8194aa88", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }),
      bbLower: chart.addSeries(LineSeries, { color: "#8194aa88", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }),
    };
    const structureSeries = {
      support: chart.addSeries(LineSeries, { color: "#42d2a388", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }),
      resistance: chart.addSeries(LineSeries, { color: "#f0788388", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }),
    };
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.84, bottom: 0 },
      visible: false,
    });
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    overlaySeriesRef.current = overlaySeries;
    structureSeriesRef.current = structureSeries;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) chart.applyOptions({ width: rect.width, height: rect.height });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      overlaySeriesRef.current = {};
      structureSeriesRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!candles.length || !candleSeriesRef.current || !volumeSeriesRef.current) return;
    const values = calculateIndicators(candles);
    const toChartPoints = (items: { time: number; value: number }[]) => items.map(item => ({ time: item.time as UTCTimestamp, value: item.value }));
    overlaySeriesRef.current.ema20?.setData(enabledIndicators.ema20 ? toChartPoints(values.ema20) : []);
    overlaySeriesRef.current.ema50?.setData(enabledIndicators.ema50 ? toChartPoints(values.ema50) : []);
    overlaySeriesRef.current.ema100?.setData(enabledIndicators.ema100 ? toChartPoints(values.ema100) : []);
    overlaySeriesRef.current.ema200?.setData(enabledIndicators.ema200 ? toChartPoints(values.ema200) : []);
    overlaySeriesRef.current.sma20?.setData(enabledIndicators.sma20 ? toChartPoints(values.sma20) : []);
    overlaySeriesRef.current.sma50?.setData(enabledIndicators.sma50 ? toChartPoints(values.sma50) : []);
    overlaySeriesRef.current.sma200?.setData(enabledIndicators.sma200 ? toChartPoints(values.sma200) : []);
    overlaySeriesRef.current.vwap?.setData(enabledIndicators.vwap ? toChartPoints(values.vwap) : []);
    overlaySeriesRef.current.bbUpper?.setData(enabledIndicators.bollinger ? toChartPoints(values.bbUpper) : []);
    overlaySeriesRef.current.bbLower?.setData(enabledIndicators.bollinger ? toChartPoints(values.bbLower) : []);
    const firstTime = Math.floor(Number(candles[0][0]) / 1000) as UTCTimestamp;
    const lastTime = Math.floor(Number(candles[candles.length - 1][0]) / 1000) as UTCTimestamp;
    structureSeriesRef.current?.support?.setData(structure.support === null ? [] : [{ time: firstTime, value: structure.support }, { time: lastTime, value: structure.support }]);
    structureSeriesRef.current?.resistance?.setData(structure.resistance === null ? [] : [{ time: firstTime, value: structure.resistance }, { time: lastTime, value: structure.resistance }]);
    const candleData = candles.map(k => ({
      time: Math.floor(Number(k[0]) / 1000) as UTCTimestamp,
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
    }));
    const volumeData = candles.map(k => ({
      time: Math.floor(Number(k[0]) / 1000) as UTCTimestamp,
      value: Number(k[5]),
      color: Number(k[4]) >= Number(k[1]) ? "#42d2a355" : "#f0788355",
    }));
    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);
    if (!fittedRef.current) {
      chartRef.current?.timeScale().fitContent();
      fittedRef.current = true;
    }
  }, [candles, enabledIndicators, structure]);

  return <div className="chart-engine" ref={containerRef} role="img" aria-label="Interactive live candlestick chart with volume"/>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [authScreen, setAuthScreen] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({data}) => { setSession(data.session); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (nextSession || event === "SIGNED_OUT") setAuthScreen(false);
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
    });
    return () => subscription.unsubscribe();
  }, []);
  if (!isSupabaseConfigured) return <div className="auth-shell"><div className="auth-card"><div className="brand auth-brand"><div className="brand-mark">M</div><div><b>CRYPTO<span>BOT</span></b><small>MISHAD EDITION</small></div></div><h1>Connect your workspace.</h1><p className="auth-description">Add the Supabase project URL and publishable key to the Vite environment before starting the app.</p><pre className="env-hint">VITE_SUPABASE_URL=...{"\n"}VITE_SUPABASE_PUBLISHABLE_KEY=...</pre></div></div>;
  if (loading) return <div className="auth-shell"><div className="auth-loading"><LoaderCircle className="spin" size={24}/> Securing your workspace…</div></div>;
  if (recoveryMode && session) return <PasswordRecoveryScreen onComplete={() => setRecoveryMode(false)}/>;
  if (session) return <Dashboard session={session} onSignIn={() => setAuthScreen(true)}/>;
  if (authScreen) return <AuthScreen onContinueGuest={() => setAuthScreen(false)}/>;
  return <Dashboard session={null} onSignIn={() => setAuthScreen(true)}/>;
}
