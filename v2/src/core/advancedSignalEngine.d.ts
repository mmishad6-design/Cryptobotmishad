export type AdvancedSignalResult = {
  decision: "LONG" | "SHORT" | "NO TRADE";
  score: number;
  reasons: string[];
  riskPlan: { ok: boolean; reason?: string; entry: number|null; stop: number|null; target: number|null; stopDistance: number; rewardDistance: number; quantity: number; riskUsd: number; netRR: number|null; [key:string]: unknown } | null;
  gates: Record<string, boolean>;
  diagnostics: Record<string, unknown>;
};
export function evaluateAdvancedSignal(options?: {
  data?: Record<string, { close:number; trend:"BULLISH"|"BEARISH"|"MIXED"; rsi:number; adx:number; volumeRatio:number; atr:number; structure?:string; takerRatio?:number }>;
  market?: "Spot"|"Futures"; entry?:number; accountBalance?:number|null; leverage?:number;
  flow?: { takerRatio?:number; depthRatio?:number };
  thresholds?: Record<string,number>;
}): AdvancedSignalResult;
