import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Activity, ArrowDownRight, ArrowUpRight, Bell, CandlestickChart,
  ChevronDown, CircleDot, Command, Crosshair, LayoutDashboard,
  ListFilter, Search, Settings2, ShieldCheck, SlidersHorizontal,
  Wallet, LogOut, LockKeyhole, Mail, UserRound, LoaderCircle, Eye, EyeOff
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { getMarketTickers, getMarketKlines, type MarketTicker, type Kline } from "./lib/market";

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

function Dashboard({ session, onSignIn }: { session: Session | null; onSignIn: () => void }) {
  const [signingOut, setSigningOut] = useState(false);
  const [activePage, setActivePage] = useState("Overview");
  const [chartSymbol, setChartSymbol] = useState("BTCUSDT");
  const [chartInterval, setChartInterval] = useState("1h");
  const [candles, setCandles] = useState<Kline[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState("");
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
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const result = await getMarketTickers();
        if (!alive) return;
        setMarketTickers(Object.fromEntries(result.data.map((ticker) => [ticker.symbol, ticker])));
        setMarketUpdatedAt(result.receivedAt);
        setMarketError("");
      } catch (error) {
        if (alive) setMarketError(error instanceof Error ? error.message : "Market feed unavailable");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let alive = true;
    setChartLoading(true); setChartError("");
    getMarketKlines(chartSymbol, chartInterval, 120)
      .then(result => { if (alive) setCandles(result.data); })
      .catch(error => { if (alive) setChartError(error instanceof Error ? error.message : "Chart data unavailable"); })
      .finally(() => { if (alive) setChartLoading(false); });
    return () => { alive = false; };
  }, [chartSymbol, chartInterval]);
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
              <div className="health-row"><span><CandlestickChart size={16}/> Binance market feed</span><strong className={marketError ? "offline" : marketUpdatedAt ? "online" : "checking"}>{marketError ? "ERROR" : marketUpdatedAt ? "LIVE" : "CHECKING"}</strong></div>
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
          <article className="stat-card"><div className="stat-top">WATCHLIST VOLUME <span className="muted-pill">24H SPOT</span></div><div className="stat-value">{Object.values(marketTickers).reduce((sum, ticker) => sum + Number(ticker.quoteVolume || 0), 0).toLocaleString("en-US", {maximumFractionDigits:0})} <small>USDT</small></div><div className="stat-foot">24h quote volume · Binance Spot</div></article>
          <article className="stat-card"><div className="stat-top">ACTIVE SETUPS <span className="muted-pill">ENGINE</span></div><div className="stat-value">0 <small>signals</small></div><div className="stat-foot">No setup evaluated yet</div></article>
          <article className="stat-card"><div className="stat-top">RISK STATUS <span className="status-safe">● SAFE</span></div><div className="stat-value">NO TRADE</div><div className="stat-foot">Waiting for validated conditions</div></article>
        </div>
        <div className="section-row"><div><h2>Market watch</h2><p>{marketError ? marketError : marketUpdatedAt ? `Binance Spot · Updated ${new Date(marketUpdatedAt).toLocaleTimeString()}` : "Connecting to live market feed…"}</p></div><button className="text-btn">View all markets <ArrowUpRight size={14}/></button></div>
        <div className="market-table"><div className="table-head"><span>ASSET</span><span>LAST PRICE</span><span>24H CHANGE</span><span>MARKET</span></div>{watchlist.map(coin => { const live = marketTickers[`${coin.symbol}USDT`]; const change = live ? Number(live.priceChangePercent) : null; return <div className="coin-row" key={coin.symbol}><div className="coin-name"><div className="coin-icon">{coin.symbol.slice(0,1)}</div><div><b>{coin.symbol}</b><small>{coin.pair}</small></div></div><b className="price">{live ? Number(live.lastPrice).toLocaleString("en-US", {maximumFractionDigits:8}) : "—"}</b><span className={change !== null && change < 0 ? "negative" : "positive"}>{change !== null && change < 0 ? <ArrowDownRight size={14}/> : <ArrowUpRight size={14}/>} {change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</span><span className="market-open"><i/> {live ? "LIVE" : "Connecting"}</span></div>; })}</div>
        <div className="bottom-grid"><section className="panel chart-panel"><div className="panel-head"><div><h2>Market structure</h2><p>BTC / USDT · Multi-timeframe analysis</p></div><button className="select-btn">BTC / USDT <ChevronDown size={14}/></button></div><div className="chart-placeholder"><div className="chart-grid"/><div className="chart-center"><CandlestickChart size={25}/><b>Chart engine ready</b><span>Live candles will appear when market data connects.</span></div></div></section><section className="panel signal-panel"><div className="panel-head"><div><h2>Signal intelligence</h2><p>Validated setups only</p></div><span className="signal-count">0 ACTIVE</span></div><div className="empty-state"><div className="empty-icon"><CircleDot size={22}/></div><b>No confirmed setup</b><span>The engine will show a signal only when all required conditions pass.</span><strong>NO TRADE</strong></div></section></div>
        {!adminOpen && activePage !== "Overview" && <div className="user-page">
          <div className="page-heading"><div><div className="eyebrow">{session ? "USER WORKSPACE" : "GUEST WORKSPACE"} <span>•</span> {session?.user.email || "Public access"}</div><h1>{activePage}</h1><p>Live public market data · Manual paper trading only.</p></div></div>
          {activePage === "Market Analysis" && <section className="panel full-market-panel">
            <div className="market-toolbar"><div><h2>Price analysis</h2><p>Binance Spot OHLC candles</p></div><div className="chart-controls"><select value={chartSymbol} onChange={e=>setChartSymbol(e.target.value)}>{["BTCUSDT","ETHUSDT","SUIUSDT","SOLUSDT"].map(s=><option key={s}>{s}</option>)}</select><select value={chartInterval} onChange={e=>setChartInterval(e.target.value)}>{["15m","1h","4h","1d"].map(t=><option key={t}>{t}</option>)}</select></div></div>
            <div className="chart-meta"><span>PRICE <b>{marketTickers[chartSymbol] ? Number(marketTickers[chartSymbol].lastPrice).toLocaleString("en-US",{maximumFractionDigits:8}) : "—"}</b></span><span>24H CHANGE <b>{marketTickers[chartSymbol] ? Number(marketTickers[chartSymbol].priceChangePercent).toFixed(2)+"%" : "—"}</b></span><span>24H HIGH <b>{marketTickers[chartSymbol] ? Number(marketTickers[chartSymbol].highPrice).toLocaleString() : "—"}</b></span><span>24H LOW <b>{marketTickers[chartSymbol] ? Number(marketTickers[chartSymbol].lowPrice).toLocaleString() : "—"}</b></span></div>
            <div className="live-chart"><div className="chart-grid"/>{chartLoading ? <div className="chart-center">Loading market candles…</div> : chartError ? <div className="chart-center">{chartError}</div> : candles.length ? <svg viewBox="0 0 1000 300" preserveAspectRatio="none"><polyline fill="none" stroke="#62d0aa" strokeWidth="2" vectorEffect="non-scaling-stroke" points={candles.map((k,i)=>{const vals=candles.map(x=>Number(x[4]));const lo=Math.min(...vals),hi=Math.max(...vals);return (5+i/(candles.length-1)*990)+","+(280-(Number(k[4])-lo)/(hi-lo||1)*250);}).join(" ")}/></svg> : <div className="chart-center">No candle data available.</div>}</div>
            <div className="chart-legend">Binance public market data · {candles.length} candles · Closing-price line</div>
            <div className="table-head candle-head"><span>TIME</span><span>OPEN</span><span>HIGH</span><span>LOW</span><span>CLOSE</span></div>{candles.slice(-10).reverse().map(k=><div className="candle-row" key={String(k[0])}><span>{new Date(k[0]).toLocaleString()}</span><span>{Number(k[1]).toPrecision(7)}</span><span>{Number(k[2]).toPrecision(7)}</span><span>{Number(k[3]).toPrecision(7)}</span><b>{Number(k[4]).toPrecision(7)}</b></div>)}
          </section>}
          {activePage === "Signal Center" && <section className="panel user-empty-panel"><div className="empty-state"><div className="empty-icon"><Crosshair size={22}/></div><b>NO TRADE · Signal engine not live</b><span>We will not invent BUY/SELL signals. Strategy validation and Bangla rejection reasons will be added before live signals are shown.</span><strong>NO TRADE</strong></div></section>}
          {(activePage === "Portfolio" || activePage === "Paper Trading") && <section className="panel user-empty-panel"><div className="empty-state"><div className="empty-icon"><Wallet size={22}/></div><b>Paper trading workspace</b><span>Next: manual entries, open positions, close trade, stop-loss, take-profit and trade history.</span></div></section>}
          {activePage === "Backtesting" && <section className="panel user-empty-panel"><div className="empty-state"><div className="empty-icon"><SlidersHorizontal size={22}/></div><b>Backtesting module pending</b><span>Historical candle feed is ready. Strategy rules, fees, slippage and performance reports will be added next.</span></div></section>}
          {activePage === "Watchlist" && <div className="market-table"><div className="table-head"><span>ASSET</span><span>LAST PRICE</span><span>24H CHANGE</span><span>MARKET</span></div>{watchlist.map(coin=>{const live=marketTickers[coin.symbol+"USDT"];const change=live?Number(live.priceChangePercent):null;return <button className="coin-row coin-row-button" key={coin.symbol} onClick={()=>{setChartSymbol(coin.symbol+"USDT");setActivePage("Market Analysis");}}><div className="coin-name"><div className="coin-icon">{coin.symbol[0]}</div><div><b>{coin.symbol}</b><small>{coin.pair}</small></div></div><b className="price">{live?Number(live.lastPrice).toLocaleString("en-US",{maximumFractionDigits:8}):"—"}</b><span className={change!==null&&change<0?"negative":"positive"}>{change===null?"—":change.toFixed(2)+"%"}</span><span className="market-open"><i/>{live?"LIVE":"Connecting"}</span></button>})}</div>}
          {activePage === "Settings" && <section className="panel user-empty-panel"><h2>Workspace settings</h2><p>Account: {session?.user.email || "Guest (not signed in)"}</p><p>Market data: Binance public Spot</p><p>Trading: Manual paper trading only</p><p>Exchange API credentials: Not used</p></section>}
        </div>}
        {!adminOpen && <footer>CRYPTOBOT <span>·</span> MISHAD EDITION <span className="footer-right">{session ? "SUPABASE AUTH CONNECTED" : "GUEST ACCESS"} <i/></span></footer>}{adminOpen && userRole && <footer>CRYPTOBOT <span>·</span> RESTRICTED ADMIN AREA <span className="footer-right">ROLE VERIFIED <i/></span></footer>}</>}
      </section>
    </main>
  </div>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({data}) => { setSession(data.session); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
    });
    return () => subscription.unsubscribe();
  }, []);
  if (!isSupabaseConfigured) return <div className="auth-shell"><div className="auth-card"><div className="brand auth-brand"><div className="brand-mark">M</div><div><b>CRYPTO<span>BOT</span></b><small>MISHAD EDITION</small></div></div><h1>Connect your workspace.</h1><p className="auth-description">Add the Supabase project URL and publishable key to the Vite environment before starting the app.</p><pre className="env-hint">VITE_SUPABASE_URL=...{"\n"}VITE_SUPABASE_PUBLISHABLE_KEY=...</pre></div></div>;
  if (loading) return <div className="auth-shell"><div className="auth-loading"><LoaderCircle className="spin" size={24}/> Securing your workspace…</div></div>;
  if (recoveryMode && session) return <PasswordRecoveryScreen onComplete={() => setRecoveryMode(false)}/>;
  if (session) return <Dashboard session={session} onSignIn={() => {}}/>;
  if (guestMode) return <Dashboard session={null} onSignIn={() => setGuestMode(false)}/>;
  return <AuthScreen onContinueGuest={() => setGuestMode(true)}/>;
}
