import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Activity, ArrowDownRight, ArrowUpRight, Bell, CandlestickChart,
  ChevronDown, CircleDot, Command, Crosshair, LayoutDashboard,
  ListFilter, Search, Settings2, ShieldCheck, SlidersHorizontal,
  Wallet, LogOut, LockKeyhole, Mail, UserRound, LoaderCircle
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

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

function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
          email, password, options: { data: { display_name: displayName.trim() } },
        });
        if (authError) throw authError;
        setMessage(data.session
          ? "Account created. Your workspace is ready."
          : "Account created. Check your email to confirm your address, then sign in.");
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
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
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
        <label><span><LockKeyhole size={14}/> Password</span><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required /></label>
        {mode === "login" && <button type="button" className="forgot-btn" onClick={resetPassword}>Forgot password?</button>}
        {error && <div className="auth-message error">{error}</div>}
        {message && <div className="auth-message success">{message}</div>}
        <button className="auth-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin"/> : null}{mode === "login" ? "Sign in to CryptoBot" : "Create account"}</button>
      </form>
      <div className="auth-security"><ShieldCheck size={16}/><span>Public market data only. No exchange API secrets or real-money execution.</span></div>
      <div className="auth-credit">DESIGNED BY MISHAD</div>
    </div>
  </div>;
}

function Dashboard({ session }: { session: Session }) {
  const [signingOut, setSigningOut] = useState(false);
  const [displayName, setDisplayName] = useState("");
  useEffect(() => {
    let alive = true;
    if (supabase) supabase.from("profiles").select("display_name").eq("id", session.user.id).maybeSingle()
      .then(({data}) => { if (alive && data?.display_name) setDisplayName(data.display_name); });
    return () => { alive = false; };
  }, [session.user.id]);
  async function signOut() {
    if (!supabase) return;
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) { window.alert(error.message); setSigningOut(false); }
  }
  return <div className="shell">
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
      <header className="topbar"><div className="crumb">Workspace <span>/</span> Overview</div><div className="top-actions"><div className="market-status"><i/> AUTHENTICATED WORKSPACE</div><button className="icon-btn" aria-label="Search"><Search size={18}/></button><button className="icon-btn" aria-label="Notifications"><Bell size={18}/></button><div className="avatar">{(displayName || session.user.email || "M").slice(0,1).toUpperCase()}</div><button className="icon-btn" aria-label="Sign out" title={session.user.email} onClick={signOut} disabled={signingOut}><LogOut size={17}/></button></div></header>
      <section className="content">
        <div className="page-heading"><div><div className="eyebrow">PRIVATE WORKSPACE <span>•</span> {session.user.email}</div><h1>Market overview</h1><p>Your market intelligence, signals and risk in one place.</p></div><button className="outline-btn"><Command size={15}/> Command center <span>⌘ K</span></button></div>
        <div className="stats-grid">
          <article className="stat-card"><div className="stat-top">TOTAL MARKET CAP <span className="muted-pill">GLOBAL</span></div><div className="stat-value">—</div><div className="stat-foot">Live market feed not connected yet</div></article>
          <article className="stat-card"><div className="stat-top">24H VOLUME <span className="muted-pill">SPOT</span></div><div className="stat-value">—</div><div className="stat-foot">Public exchange data</div></article>
          <article className="stat-card"><div className="stat-top">ACTIVE SETUPS <span className="muted-pill">ENGINE</span></div><div className="stat-value">0 <small>signals</small></div><div className="stat-foot">No setup evaluated yet</div></article>
          <article className="stat-card"><div className="stat-top">RISK STATUS <span className="status-safe">● SAFE</span></div><div className="stat-value">NO TRADE</div><div className="stat-foot">Waiting for validated conditions</div></article>
        </div>
        <div className="section-row"><div><h2>Market watch</h2><p>Live pairs selected for monitoring</p></div><button className="text-btn">View all markets <ArrowUpRight size={14}/></button></div>
        <div className="market-table"><div className="table-head"><span>ASSET</span><span>LAST PRICE</span><span>24H CHANGE</span><span>MARKET</span></div>{watchlist.map(coin => <div className="coin-row" key={coin.symbol}><div className="coin-name"><div className="coin-icon">{coin.symbol.slice(0,1)}</div><div><b>{coin.symbol}</b><small>{coin.pair}</small></div></div><b className="price">{coin.price}</b><span className="positive">{coin.up ? <ArrowUpRight size={14}/> : <ArrowDownRight size={14}/>} {coin.change}</span><span className="market-open"><i/> Pending feed</span></div>)}</div>
        <div className="bottom-grid"><section className="panel chart-panel"><div className="panel-head"><div><h2>Market structure</h2><p>BTC / USDT · Multi-timeframe analysis</p></div><button className="select-btn">BTC / USDT <ChevronDown size={14}/></button></div><div className="chart-placeholder"><div className="chart-grid"/><div className="chart-center"><CandlestickChart size={25}/><b>Chart engine ready</b><span>Live candles will appear when market data connects.</span></div></div></section><section className="panel signal-panel"><div className="panel-head"><div><h2>Signal intelligence</h2><p>Validated setups only</p></div><span className="signal-count">0 ACTIVE</span></div><div className="empty-state"><div className="empty-icon"><CircleDot size={22}/></div><b>No confirmed setup</b><span>The engine will show a signal only when all required conditions pass.</span><strong>NO TRADE</strong></div></section></div>
        <footer>CRYPTOBOT <span>·</span> MISHAD EDITION <span className="footer-right">SUPABASE AUTH CONNECTED <i/></span></footer>
      </section>
    </main>
  </div>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({data}) => { setSession(data.session); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => subscription.unsubscribe();
  }, []);
  if (!isSupabaseConfigured) return <div className="auth-shell"><div className="auth-card"><div className="brand auth-brand"><div className="brand-mark">M</div><div><b>CRYPTO<span>BOT</span></b><small>MISHAD EDITION</small></div></div><h1>Connect your workspace.</h1><p className="auth-description">Add the Supabase project URL and publishable key to the Vite environment before starting the app.</p><pre className="env-hint">VITE_SUPABASE_URL=...{"\n"}VITE_SUPABASE_PUBLISHABLE_KEY=...</pre></div></div>;
  if (loading) return <div className="auth-shell"><div className="auth-loading"><LoaderCircle className="spin" size={24}/> Securing your workspace…</div></div>;
  return session ? <Dashboard session={session}/> : <AuthScreen/>;
}
