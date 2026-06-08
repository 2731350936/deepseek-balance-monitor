/** Single currency balance entry from the DeepSeek API response */
export interface DeepSeekBalanceInfo {
  currency: string;
  total_balance: string;
  granted_balance: string;
  topped_up_balance: string;
}

/** Full DeepSeek /user/balance API response */
export interface DeepSeekBalanceResponse {
  is_available: boolean;
  balance_infos: DeepSeekBalanceInfo[];
}

/** Parsed and validated balance snapshot stored locally */
export interface BalanceSnapshot {
  isoTime: string;
  totalBalance: number;
  grantedBalance: number;
  toppedUpBalance: number;
  isAvailable: boolean;
  currency: string;
}

// ---------------------------------------------------------------
//  Usage statistics types
// ---------------------------------------------------------------

/** Individual usage record from /v1/usage endpoint */
export interface UsageRecord {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  model: string;
  timestamp: string; // ISO 8601
}

/** Category breakdown within a usage record */
export interface UsageCategory {
  tokens: number;
  cost: number;
}

/** Aggregated usage summary for a time period */
export interface UsageSummary {
  periodLabel: string;              // "Today" / "This Month"
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;            // total cost in CNY
  cacheHitTokens: number;           // 0 if unavailable
  cacheMissTokens: number;          // 0 if unavailable
  cacheHitRate: number | null;      // 0-100, null if unavailable
  recordCount: number;
}

/** Per-model breakdown */
export interface ModelBreakdown {
  model: string;
  cost: number;
  tokens: number;
  cacheHitTokens: number;
}

/** Full usage data sent to webview */
export interface UsageData {
  today: UsageSummary;
  monthly: UsageSummary;
  dailyHistory: DailyUsagePoint[];
  modelBreakdown: ModelBreakdown[];
}

/** Daily usage data point for ECharts */
export interface DailyUsagePoint {
  date: string;             // "2026-06-05"
  totalTokens: number;
  estimatedCost: number;
  cacheHitRate: number | null;
}

/** Response from /v1/usage endpoint (jsonl format, one JSON object per line) */
export interface DeepSeekUsageListResponse {
  data: UsageRecord[];
  has_more: boolean;
  total: number;
}

/** Response from platform internal /api/v0/usage/amount endpoint */
export interface PlatformUsageAmountItem {
  date: string;
  prompt_tokens: number;
  completion_tokens: number;
  prompt_cache_hit_tokens: number;
  prompt_cache_miss_tokens: number;
  cost: number;             // cost in CNY (or platform currency unit)
}

export interface PlatformUsageAmountResponse {
  data: PlatformUsageAmountItem[];
}

// ---------------------------------------------------------------

/** Shape of the globalState data persisted across sessions */
export interface PersistedState {
  balanceHistory: BalanceSnapshot[];
  usageHistory: DailyUsagePoint[];
  lastFetchTimeIso: string | null;
  lastErrorMessage: string | null;
}

/** User summary from platform API */
export interface UserSummary {
  currentToken?: number;
  availableTokenEstimation?: number;
  monthlyTokenUsage?: number;
  totalCost?: number;
}

/** Messages sent from extension to webview (postMessage) */
export type ToWebviewMessage =
  | { type: 'updateBalance'; current: BalanceSnapshot; history7d: BalanceSnapshot[]; history30d: BalanceSnapshot[] }
  | { type: 'updateUsage'; data: UsageData; userSummary: UserSummary; platformReachable: boolean }
  | { type: 'apiKeyStatus'; configured: boolean }
  | { type: 'cookieStatus'; configured: boolean; lastUpdated: string | null }
  | { type: 'configUpdate'; refreshIntervalSeconds: number }
  | { type: 'error'; message: string };

/** Messages sent from webview to extension (postMessage) */
export type FromWebviewMessage =
  | { type: 'requestRefresh' }
  | { type: 'requestSetApiKey' }
  | { type: 'clearApiKey' }
  | { type: 'extractCookie' }
  | { type: 'inputCookie' }
  | { type: 'clearCookie' }
  | { type: 'syncPlaywright' }
  | { type: 'setRefreshInterval'; seconds: number }
  | { type: 'webviewReady' };

/** Error categories for the API layer */
export enum ApiErrorKind {
  Network = 'Network',
  InvalidKey = 'InvalidKey',
  RateLimited = 'RateLimited',
  ServerError = 'ServerError',
  MalformedResponse = 'MalformedResponse',
  Timeout = 'Timeout',
}

/** Structured error from the API layer */
export interface ApiError {
  kind: ApiErrorKind;
  message: string;
  retryAfterSeconds?: number;
}

// ---------------------------------------------------------------
//  Model pricing table (CNY per 1 million tokens, approximately)
// ---------------------------------------------------------------
export interface ModelPricing {
  inputPrice: number;      // CNY per 1M tokens
  outputPrice: number;     // CNY per 1M tokens
  cacheHitPrice: number;   // CNY per 1M tokens (input only)
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'deepseek-chat':       { inputPrice: 1.0,  outputPrice: 2.0,  cacheHitPrice: 0.1  },
  'deepseek-v3':         { inputPrice: 1.0,  outputPrice: 2.0,  cacheHitPrice: 0.1  },
  'deepseek-reasoner':   { inputPrice: 4.0,  outputPrice: 16.0, cacheHitPrice: 0.4  },
  'deepseek-r1':         { inputPrice: 4.0,  outputPrice: 16.0, cacheHitPrice: 0.4  },
};

/** Fallback pricing for unknown models */
export const DEFAULT_PRICING: ModelPricing = {
  inputPrice: 1.0,
  outputPrice: 2.0,
  cacheHitPrice: 0.1,
};

export function getModelPricing(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

/** Calculate cost for a single usage record based on model pricing */
export function calculateCost(tokens: { prompt: number; completion: number; cacheHit?: number; cacheMiss?: number }, model: string): number {
  const pricing = getModelPricing(model);
  const cacheHit = tokens.cacheHit ?? 0;
  const cacheMiss = tokens.cacheMiss ?? tokens.prompt - cacheHit;

  const inputCost =
    (cacheHit / 1_000_000) * pricing.cacheHitPrice +
    (cacheMiss / 1_000_000) * pricing.inputPrice;
  const outputCost = (tokens.completion / 1_000_000) * pricing.outputPrice;

  return inputCost + outputCost;
}

// ---------------------------------------------------------------
//  Type guards
// ---------------------------------------------------------------

export function isDeepSeekBalanceResponse(obj: unknown): obj is DeepSeekBalanceResponse {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  const o = obj as Record<string, unknown>;
  if (typeof o.is_available !== 'boolean') {
    return false;
  }
  if (!Array.isArray(o.balance_infos)) {
    return false;
  }
  for (const info of o.balance_infos) {
    if (typeof info !== 'object' || info === null) {
      return false;
    }
    const i = info as Record<string, unknown>;
    if (typeof i.currency !== 'string') return false;
    if (typeof i.total_balance !== 'string') return false;
    if (typeof i.granted_balance !== 'string') return false;
    if (typeof i.topped_up_balance !== 'string') return false;
  }
  return true;
}

export function isUsageRecord(obj: unknown): obj is UsageRecord {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.prompt_tokens === 'number' &&
    typeof o.completion_tokens === 'number' &&
    typeof o.model === 'string'
  );
}

export function parseBalanceString(value: string): number {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}
