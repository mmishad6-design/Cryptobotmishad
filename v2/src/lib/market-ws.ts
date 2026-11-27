import type { Kline, MarketTicker } from "./market";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SUIUSDT", "SOLUSDT"];

type StreamCallbacks<T> = {
  onData: (value: T) => void;
  onStatus: (status: "connecting" | "connected" | "reconnecting", source: string) => void;
};

function startFailoverSocket(
  makePrimary: () => WebSocket,
  makeFallback: () => WebSocket,
  onMessage: (event: MessageEvent, source: string) => void,
  onStatus: (status: "connecting" | "connected" | "reconnecting", source: string) => void,
) {
  let socket: WebSocket | null = null;
  let stopped = false;
  let fallbackActive = false;
  let reconnectTimer = 0;
  let watchdogTimer = 0;
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
    let received = false;
    const current = socket;
    current.onopen = () => {
      if (stopped || socket !== current) return;
      attempt = 0;
      if (fallback) {
        const args = SYMBOLS.map(symbol => "tickers." + symbol);
        // The Bybit subscription payload is supplied by the caller via its URL protocol.
        if (current.protocol === "bybit-spot") current.send(JSON.stringify({ op: "subscribe", args }));
      }
      onStatus("connected", source);
      window.clearTimeout(watchdogTimer);
      watchdogTimer = window.setTimeout(() => {
        if (!received && !fallback && !stopped) {
          current.close();
          connect(true);
        }
      }, 9000);
    };
    current.onmessage = event => {
      if (stopped || socket !== current) return;
      received = true;
      window.clearTimeout(watchdogTimer);
      onMessage(event, source);
    };
    current.onerror = () => {
      if (stopped || socket !== current) return;
      current.close();
    };
    current.onclose = () => {
      if (stopped || socket !== current) return;
      window.clearTimeout(watchdogTimer);
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
    socket?.close();
  };
}

export function connectTickerStream(callbacks: StreamCallbacks<MarketTicker>) {
  const streams = SYMBOLS.map(symbol => symbol.toLowerCase() + "@ticker").join("/");
  const primary = () => new WebSocket("wss://stream.binance.com:9443/stream?streams=" + streams);
  const fallback = () => {
    const socket = new WebSocket("wss://stream.bybit.com/v5/public/spot", "bybit-spot");
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
  "1h": "60", "2h": "120", "4h": "240", "6h": "360",
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
    let received = false;
    current.onopen = () => {
      if (stopped || socket !== current) return;
      retry = 0;
      if (fallbackMode) current.send(JSON.stringify({ op: "subscribe", args: ["kline." + interval + "." + symbol] }));
      callbacks.onStatus("connected", source);
      window.clearTimeout(watchdogTimer);
      watchdogTimer = window.setTimeout(() => {
        if (!received && !fallbackMode && !stopped) { current.close(); connect(true); }
      }, 9000);
    };
    current.onmessage = event => {
      if (stopped || socket !== current) return;
      received = true;
      window.clearTimeout(watchdogTimer);
      try {
        const message = JSON.parse(String(event.data));
        if (!fallbackMode && message.data?.k) {
          const k = message.data.k;
          callbacks.onData([Number(k.t), k.o, k.h, k.l, k.c, k.v, Number(k.q), String(k.T), Number(k.n), k.V, k.Q, "0"]);
        } else if (fallbackMode && message.topic?.startsWith("kline.") && Array.isArray(message.data)) {
          const k = message.data[0];
          callbacks.onData([Number(k.start), k.open, k.high, k.low, k.close, k.volume, Number(k.turnover), "", 0, "", "", ""]);
        }
      } catch { /* Ignore heartbeat and malformed messages. */ }
    };
    current.onerror = () => { if (!stopped && socket === current) current.close(); };
    current.onclose = () => {
      if (stopped || socket !== current) return;
      window.clearTimeout(watchdogTimer);
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
    socket?.close();
  };
}
