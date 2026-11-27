import type { Kline, MarketTicker } from "./market";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SUIUSDT", "SOLUSDT"];

type StreamCallbacks<T> = {
  onData: (value: T) => void;
  onStatus: (status: "connecting" | "connected" | "stale" | "reconnecting", source: string) => void;
};

function startFailoverSocket(
  makePrimary: () => WebSocket,
  makeFallback: () => WebSocket,
  onMessage: (event: MessageEvent, source: string) => void,
  onStatus: (status: "connecting" | "connected" | "stale" | "reconnecting", source: string) => void,
) {
  let socket: WebSocket | null = null;
  let stopped = false;
  let fallbackActive = false;
  let reconnectTimer = 0;
  let watchdogTimer = 0;
  let heartbeatTimer = 0;
  let attempt = 0;

  const connect = (fallback = false) => {
    if (stopped) return;
    fallbackActive = fallback;
    const source = fallback ? "Bybit Spot WebSocket" : "Binance Spot WebSocket";
    onStatus(attempt ? "reconnecting" : "connecting", source);
    try {
      socket = fallback ? makeFallback() : makePrimary();
    } catch {
      scheduleReconnect(fallback);
      return;
    }
    const current = socket;
    const armWatchdog = () => {
      window.clearTimeout(watchdogTimer);
      watchdogTimer = window.setTimeout(() => {
        if (!stopped && socket === current) {
          onStatus("stale", source);
          current.close();
        }
      }, 12000);
    };
    current.onopen = () => {
      if (stopped || socket !== current) return;
      attempt = 0;
      if (fallback) {
        const args = SYMBOLS.map(symbol => "tickers." + symbol);
        current.send(JSON.stringify({ op: "subscribe", args }));
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = window.setInterval(() => { if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ op: "ping" })); }, 20000);
      }
      onStatus("connected", source);
      armWatchdog();
    };
    current.onmessage = event => {
      if (stopped || socket !== current) return;
      armWatchdog();
      onMessage(event, source);
    };
    current.onerror = () => {
      if (stopped || socket !== current) return;
      current.close();
    };
    current.onclose = () => {
      if (stopped || socket !== current) return;
      window.clearTimeout(watchdogTimer);
      window.clearInterval(heartbeatTimer);
      if (!fallback && !fallbackActive) {
        connect(true);
      } else {
        scheduleReconnect(true);
      }
    };
  };

  const scheduleReconnect = (fallback: boolean) => {
    if (stopped) return;
    attempt += 1;
    onStatus("reconnecting", fallback ? "Bybit Spot WebSocket" : "Binance Spot WebSocket");
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => connect(fallback), Math.min(15000, 1500 * attempt));
  };

  connect(false);
  return () => {
    stopped = true;
    window.clearTimeout(reconnectTimer);
    window.clearTimeout(watchdogTimer);
    window.clearInterval(heartbeatTimer);
    socket?.close();
  };
}

export function connectTickerStream(callbacks: StreamCallbacks<MarketTicker>) {
  const streams = SYMBOLS.map(symbol => symbol.toLowerCase() + "@ticker").join("/");
  const primary = () => new WebSocket("wss://stream.binance.com:9443/stream?streams=" + streams);
  const fallback = () => {
    const socket = new WebSocket("wss://stream.bybit.com/v5/public/spot");
    return socket;
  };
  return startFailoverSocket(primary, fallback, (event, source) => {
    try {
      const message = JSON.parse(String(event.data));
      if (source.startsWith("Binance")) {
        const row = message.data;
        if (!row?.s || !row?.c) return;
        callbacks.onData({
          symbol: row.s,
          lastPrice: row.c,
          priceChangePercent: row.P,
          quoteVolume: row.q,
          highPrice: row.h,
          lowPrice: row.l,
        });
      } else if (message.topic?.startsWith("tickers.") && message.data?.symbol) {
        const row = message.data;
        callbacks.onData({
          symbol: row.symbol,
          lastPrice: row.lastPrice,
          priceChangePercent: String(Number(row.price24hPcnt) * 100),
          quoteVolume: row.turnover24h ?? "",
          highPrice: row.highPrice24h ?? "",
          lowPrice: row.lowPrice24h ?? "",
        });
      } else if (message.op === "ping") {
        // Bybit application-level heartbeat.
      }
    } catch {
      // Ignore malformed or non-market stream messages.
    }
  }, callbacks.onStatus);
}

const BYBIT_INTERVAL: Record<string, string> = {
  "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30",
  "1h": "60", "2h": "120", "4h": "240", "6h": "360", "8h": "480",
  "12h": "720", "1d": "D", "1w": "W", "1M": "M",
};

export function connectKlineStream(symbol: string, interval: string, callbacks: StreamCallbacks<Kline>) {
  const primary = () => new WebSocket("wss://stream.binance.com:9443/ws/" + symbol.toLowerCase() + "@kline_" + interval);
  const bybitInterval = BYBIT_INTERVAL[interval];
  const fallback = () => new WebSocket("wss://stream.bybit.com/v5/public/spot");
  return startKlineSocket(primary, fallback, symbol, bybitInterval, callbacks);
}

function startKlineSocket(
  primary: () => WebSocket,
  fallback: () => WebSocket,
  symbol: string,
  interval: string | undefined,
  callbacks: StreamCallbacks<Kline>,
) {
  let socket: WebSocket | null = null;
  let stopped = false;
  let usingFallback = false;
  let retry = 0;
  let reconnectTimer = 0;
  let watchdogTimer = 0;
  let heartbeatTimer = 0;
  const connect = (fallbackMode: boolean) => {
    if (stopped) return;
    usingFallback = fallbackMode;
    const source = fallbackMode ? "Bybit Spot WebSocket" : "Binance Spot WebSocket";
    callbacks.onStatus(retry ? "reconnecting" : "connecting", source);
    if (fallbackMode && !interval) {
      callbacks.onStatus("reconnecting", "REST backup · unsupported Bybit interval");
      return;
    }
    try { socket = fallbackMode ? fallback() : primary(); }
    catch { schedule(fallbackMode); return; }
    const current = socket;
    const armWatchdog = () => {
      window.clearTimeout(watchdogTimer);
      watchdogTimer = window.setTimeout(() => {
        if (!stopped && socket === current) {
          callbacks.onStatus("stale", source);
          current.close();
        }
      }, 12000);
    };
    current.onopen = () => {
      if (stopped || socket !== current) return;
      retry = 0;
      if (fallbackMode) {
        current.send(JSON.stringify({ op: "subscribe", args: ["kline." + interval + "." + symbol] }));
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = window.setInterval(() => { if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ op: "ping" })); }, 20000);
      }
      callbacks.onStatus("connected", source);
      armWatchdog();
    };
    current.onmessage = event => {
      if (stopped || socket !== current) return;
      armWatchdog();
      try {
        const message = JSON.parse(String(event.data));
        // Binance /ws streams send the kline at message.k; combined
        // streams wrap it in message.data.k. Accept both response shapes.
        const binanceKline = message.k ?? message.data?.k;
        if (!fallbackMode && binanceKline) {
          const k = binanceKline;
          callbacks.onData([Number(k.t), k.o, k.h, k.l, k.c, k.v, Number(k.q), String(k.T), Number(k.n), k.V, k.Q, "0"]);
        } else if (fallbackMode && message.topic?.startsWith("kline.") && Array.isArray(message.data)) {
          const k = message.data[0];
          const start = Number(k.start);
          const closeTime = interval === "M"
            ? Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth() + 1, 1) - 1
            : start + (interval === "W" ? 7 * 86400000 : interval === "D" ? 86400000 : Number(interval) * 60000) - 1;
          callbacks.onData([start, k.open, k.high, k.low, k.close, k.volume, closeTime, "", 0, "", "", ""]);
        }
      } catch { /* Ignore heartbeat and malformed messages. */ }
    };
    current.onerror = () => { if (!stopped && socket === current) current.close(); };
    current.onclose = () => {
      if (stopped || socket !== current) return;
      window.clearTimeout(watchdogTimer);
      window.clearInterval(heartbeatTimer);
      if (!fallbackMode && !usingFallback) connect(true);
      else schedule(true);
    };
  };
  const schedule = (fallbackMode: boolean) => {
    if (stopped) return;
    retry += 1;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => connect(fallbackMode), Math.min(15000, 1500 * retry));
  };
  connect(false);
  return () => {
    stopped = true;
    window.clearTimeout(reconnectTimer);
    window.clearTimeout(watchdogTimer);
    window.clearInterval(heartbeatTimer);
    socket?.close();
  };
}


export type OrderBookLevel = [string, string];
export type LiveOrderBook = { bids: OrderBookLevel[]; asks: OrderBookLevel[]; updatedAt: string };
type DepthEvent = {
  U: number;
  u: number;
  pu?: number;
  E?: number;
  b: OrderBookLevel[];
  a: OrderBookLevel[];
};

type OrderBookCallbacks = {
  onData: (book: LiveOrderBook) => void;
  onStatus: (status: "connecting" | "live" | "stale" | "reconnecting" | "error", message: string) => void;
};

/**
 * Maintains a correctly sequenced local Binance Spot order book.
 * A REST snapshot establishes the initial state; diff-depth events then
 * update that state using Binance's U/u/pu sequence identifiers.
 */
export function connectOrderBookStream(symbol: string, callbacks: OrderBookCallbacks) {
  let socket: WebSocket | null = null;
  let stopped = false;
  let retry = 0;
  let reconnectTimer = 0;
  let staleTimer = 0;
  let snapshotTimer = 0;
  let generation = 0;

  const connect = () => {
    if (stopped) return;
    const currentGeneration = ++generation;
    const buffered: DepthEvent[] = [];
    let synchronized = false;
    let snapshotReady = false;
    let snapshotLoading = false;
    let nextSnapshotAttempt = 0;
    let lastUpdateId = 0;
    let bids = new Map<string, string>();
    let asks = new Map<string, string>();
    callbacks.onStatus(retry ? "reconnecting" : "connecting", "Binance Spot depth stream");

    const publish = () => {
      const sort = (book: Map<string, string>, descending: boolean): OrderBookLevel[] =>
        [...book.entries()]
          .sort((a, b) => descending ? Number(b[0]) - Number(a[0]) : Number(a[0]) - Number(b[0]))
          .slice(0, 20);
      callbacks.onData({ bids: sort(bids, true), asks: sort(asks, false), updatedAt: new Date().toISOString() });
      callbacks.onStatus("live", "Binance Spot depth WebSocket");
      window.clearTimeout(staleTimer);
      staleTimer = window.setTimeout(() => {
        if (!stopped && currentGeneration === generation) callbacks.onStatus("stale", "No depth update received for 5 seconds");
      }, 5000);
    };

    const apply = (event: DepthEvent) => {
      for (const [price, quantity] of event.b) {
        if (Number(quantity) === 0) bids.delete(price);
        else bids.set(price, quantity);
      }
      for (const [price, quantity] of event.a) {
        if (Number(quantity) === 0) asks.delete(price);
        else asks.set(price, quantity);
      }
      lastUpdateId = event.u;
      publish();
    };

    const loadSnapshot = async () => {
      if (snapshotLoading || stopped || currentGeneration !== generation || Date.now() < nextSnapshotAttempt) return;
      snapshotLoading = true;
      try {
        const response = await fetch("https://api.binance.com/api/v3/depth?symbol=" + encodeURIComponent(symbol) + "&limit=1000", { cache: "no-store" });
        if (!response.ok) throw new Error("Order book snapshot unavailable (" + response.status + ")");
        const snapshot = await response.json() as { lastUpdateId?: number; bids?: OrderBookLevel[]; asks?: OrderBookLevel[] };
        if (stopped || currentGeneration !== generation) return;
        if (!Number.isFinite(snapshot.lastUpdateId) || !Array.isArray(snapshot.bids) || !Array.isArray(snapshot.asks)) {
          throw new Error("Invalid order book snapshot");
        }
        bids = new Map(snapshot.bids.filter(level => Number(level[1]) > 0));
        asks = new Map(snapshot.asks.filter(level => Number(level[1]) > 0));
        lastUpdateId = Number(snapshot.lastUpdateId);
        snapshotReady = true;
        const pending = buffered.splice(0);
        for (const event of pending) {
          if (event.u <= lastUpdateId) continue;
          if (event.U > lastUpdateId + 1 || (event.pu !== undefined && synchronized && event.pu !== lastUpdateId)) {
            synchronized = false;
            snapshotReady = false;
            callbacks.onStatus("stale", "Depth sequence gap · resynchronizing");
            snapshotTimer = window.setTimeout(() => { snapshotLoading = false; void loadSnapshot(); }, 250);
            return;
          }
          if (event.U <= lastUpdateId + 1 && event.u >= lastUpdateId + 1) {
            apply(event);
            synchronized = true;
          }
        }
        if (synchronized) callbacks.onStatus("live", "Binance Spot depth WebSocket");
        else {
          const sort = (book: Map<string, string>, descending: boolean): OrderBookLevel[] =>
            [...book.entries()]
              .sort((a, b) => descending ? Number(b[0]) - Number(a[0]) : Number(a[0]) - Number(b[0]))
              .slice(0, 20);
          callbacks.onData({ bids: sort(bids, true), asks: sort(asks, false), updatedAt: new Date().toISOString() });
        }
      } catch (error) {
        if (!stopped && currentGeneration === generation) {
          callbacks.onStatus("error", error instanceof Error ? error.message : "Order book snapshot failed");
          nextSnapshotAttempt = Date.now() + 2500;
          snapshotTimer = window.setTimeout(() => { nextSnapshotAttempt = 0; snapshotLoading = false; void loadSnapshot(); }, 2500);
        }
      } finally {
        snapshotLoading = false;
      }
    };

    try {
      socket = new WebSocket("wss://stream.binance.com:9443/ws/" + symbol.toLowerCase() + "@depth@100ms");
    } catch {
      scheduleReconnect();
      return;
    }
    const current = socket;
    current.onopen = () => {
      if (stopped || socket !== current) return;
      retry = 0;
      void loadSnapshot();
    };
    current.onmessage = event => {
      if (stopped || socket !== current) return;
      try {
        const message = JSON.parse(String(event.data));
        const depth = (message.data ?? message) as DepthEvent;
        if (!Number.isFinite(depth?.U) || !Number.isFinite(depth?.u) || !Array.isArray(depth.b) || !Array.isArray(depth.a)) return;
        if (!synchronized) {
          if (!snapshotReady) {
            buffered.push(depth);
            if (!snapshotLoading) void loadSnapshot();
            if (buffered.length > 2000) {
              buffered.splice(0, buffered.length - 1000);
              snapshotReady = false;
              callbacks.onStatus("stale", "Depth buffer overflow · resynchronizing");
              snapshotLoading = false;
              void loadSnapshot();
            }
            return;
          }
          if (depth.u <= lastUpdateId) return;
          if (depth.U <= lastUpdateId + 1 && depth.u >= lastUpdateId + 1) {
            apply(depth);
            synchronized = true;
            return;
          }
          snapshotReady = false;
          buffered.push(depth);
          callbacks.onStatus("stale", "Depth sequence gap · resynchronizing");
          void loadSnapshot();
          return;
        }
        if (depth.u <= lastUpdateId) return;
        if (depth.U > lastUpdateId + 1 || (depth.pu !== undefined && depth.pu !== lastUpdateId)) {
          synchronized = false;
          snapshotReady = false;
          buffered.push(depth);
          callbacks.onStatus("stale", "Depth sequence gap · resynchronizing");
          void loadSnapshot();
          return;
        }
        apply(depth);
      } catch {
        // Ignore malformed or non-depth stream messages.
      }
    };
    current.onerror = () => { if (!stopped && socket === current) current.close(); };
    current.onclose = () => {
      if (stopped || socket !== current) return;
      window.clearTimeout(staleTimer);
      window.clearTimeout(snapshotTimer);
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    retry += 1;
    callbacks.onStatus("reconnecting", "Binance Spot depth reconnecting");
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connect, Math.min(15000, 1000 * Math.pow(2, Math.min(retry, 4))));
  };

  connect();
  return () => {
    stopped = true;
    generation += 1;
    window.clearTimeout(reconnectTimer);
    window.clearTimeout(staleTimer);
    window.clearTimeout(snapshotTimer);
    socket?.close();
  };
}
