import * as https from 'https';
import {
  BalanceSnapshot, ApiErrorKind, ApiError,
  isDeepSeekBalanceResponse, parseBalanceString,
  UsageSummary, DailyUsagePoint, UsageData,
  getModelPricing, DEFAULT_PRICING,
} from '../types';

const API_HOST = 'api.deepseek.com';
const PLATFORM_HOST = 'platform.deepseek.com';

// ---------------------------------------------------------------
//  HTTP helper
// ---------------------------------------------------------------
function httpGet(
  hostname: string, path: string, apiKey: string,
  timeoutMs: number, cookie?: string
): Promise<string> {
  const headers: Record<string, string> = { Accept: 'application/json' };

  // Parse combined format: "JWT_TOKEN|||COOKIE_STRING"
  let authToken: string | undefined;
  let cookieStr: string | undefined;
  if (cookie && cookie.includes('|||')) {
    const p = cookie.split('|||');
    authToken = p[0]?.trim();
    cookieStr = p[1]?.trim();
  } else if (cookie) {
    cookieStr = cookie;
  }

  if (authToken) {
    headers['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
  } else if (!cookieStr) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  if (cookieStr) {
    headers['Cookie'] = cookieStr;
    headers['Referer'] = 'https://platform.deepseek.com/usage';
    headers['Origin'] = 'https://platform.deepseek.com';
    const m = cookieStr.match(/csrftoken=([^;]+)/);
    if (m) headers['X-CSRFToken'] = m[1];
  }

  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET', headers, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 200) resolve(body);
        else reject({ kind: ApiErrorKind.ServerError, message: `API 返回 ${res.statusCode}: ${path}` } as ApiError);
      });
    });
    req.on('error', (e: NodeJS.ErrnoException) => reject({ kind: ApiErrorKind.Network, message: `网络错误: ${e.message}` } as ApiError));
    req.on('timeout', () => { req.destroy(); reject({ kind: ApiErrorKind.Timeout, message: '请求超时' } as ApiError); });
    req.end();
  });
}

// ---------------------------------------------------------------
//  1. Balance
// ---------------------------------------------------------------
export function fetchBalance(apiKey: string, timeoutMs: number): Promise<BalanceSnapshot> {
  return httpGet(API_HOST, '/user/balance', apiKey, timeoutMs).then((body) => {
    const p = JSON.parse(body);
    if (!isDeepSeekBalanceResponse(p)) throw { kind: ApiErrorKind.MalformedResponse, message: '余额 API 格式异常' } as ApiError;
    const info = p.balance_infos[0];
    return {
      isoTime: new Date().toISOString(),
      totalBalance: info ? parseBalanceString(info.total_balance) : 0,
      grantedBalance: info ? parseBalanceString(info.granted_balance) : 0,
      toppedUpBalance: info ? parseBalanceString(info.topped_up_balance) : 0,
      isAvailable: p.is_available, currency: info?.currency ?? 'CNY',
    };
  });
}

// ---------------------------------------------------------------
//  2. v1/usage — Public API (API Key only, NO cookie needed!)
// ---------------------------------------------------------------

interface V1UsageRecord {
  request_id?: string;
  model_name?: string;
  model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  cost_in_cents?: number;
  cost?: number;
  timestamp?: string | number;
  created_at?: string;
}

/**
 * Fetch usage data from the public API endpoint.
 * This works with just the API Key — no cookie/JWT required!
 */
async function fetchV1UsageMonth(
  apiKey: string, timeoutMs: number, year: number, month: number
): Promise<V1UsageRecord[]> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  try {
    // Use shorter timeout for v1/usage — if endpoint doesn't exist, fail fast
    const v1Timeout = Math.min(timeoutMs, 5000);
    const path = `/v1/usage?start_date=${startDate}&end_date=${endDate}`;
    const body = await httpGet(API_HOST, path, apiKey, v1Timeout);
    const parsed = JSON.parse(body);

    // Handle various response shapes
    let records: V1UsageRecord[] = [];
    if (Array.isArray(parsed)) {
      records = parsed;
    } else if (parsed?.data && Array.isArray(parsed.data)) {
      records = parsed.data;
    } else if (parsed?.items && Array.isArray(parsed.items)) {
      records = parsed.items;
    } else {
      console.log('[deepseek] v1/usage unexpected shape:', JSON.stringify(parsed).slice(0, 200));
      return [];
    }

    console.log(`[deepseek] v1/usage ${year}-${month}: ${records.length} records`);
    return records;
  } catch (e) {
    const err = e as ApiError;
    console.log(`[deepseek] v1/usage unavailable (${year}-${month}): ${err.message}`);
    return [];
  }
}

/** Aggregate v1/usage records into the same format as platform API data */
function aggregateV1Records(records: V1UsageRecord[]): {
  dailyItems: ReturnType<typeof flattenModelUsage>[];
  monthlyCost: number;
} {
  const all: ReturnType<typeof flattenModelUsage>[] = [];
  let monthlyCost = 0;

  for (const r of records) {
    const model = r.model_name || r.model || 'unknown';
    const ts = r.timestamp || r.created_at;
    let date = '';
    if (typeof ts === 'number') {
      date = new Date(ts * 1000).toISOString().split('T')[0];
    } else if (typeof ts === 'string') {
      date = ts.split('T')[0] || ts.slice(0, 10);
    }

    const promptTokens = r.prompt_tokens || 0;
    const completionTokens = r.completion_tokens || 0;
    const cacheHit = r.prompt_cache_hit_tokens || 0;
    const cacheMiss = r.prompt_cache_miss_tokens || 0;

    // Cost
    let cost = 0;
    if (r.cost_in_cents !== undefined) {
      cost = r.cost_in_cents / 100; // cents → approximate CNY
    } else if (r.cost !== undefined) {
      cost = r.cost;
    } else {
      const pricing = getModelPricing(model);
      cost = (cacheMiss / 1_000_000) * pricing.inputPrice +
             (cacheHit / 1_000_000) * pricing.cacheHitPrice +
             (completionTokens / 1_000_000) * pricing.outputPrice;
    }

    monthlyCost += cost;

    all.push({
      date,
      model,
      promptTokens,
      completionTokens,
      cacheHitTokens: cacheHit,
      cacheMissTokens: cacheMiss,
      cost: Math.round(cost * 100) / 100,
      requests: 1,
    });
  }

  return { dailyItems: all, monthlyCost: Math.round(monthlyCost * 100) / 100 };
}

// ---------------------------------------------------------------
//  3. Platform APIs — actual response types (cookie-required, optional)
// ---------------------------------------------------------------
export interface UserSummaryResponse {
  current_token?: number;
  total_available_token_estimation?: number;
  monthly_token_usage?: number;
  total_cost?: number;
  total_topup_amount?: number;
  total_grant_amount?: number;
}

interface UsageEntry { type: string; amount: string }
interface ModelUsage {
  model: string;
  usage?: UsageEntry[];
  total_cost?: string;
  cost?: string;
  total_tokens?: number;
}
interface DailyItem {
  date: string;
  data?: ModelUsage[];
  items?: ModelUsage[];
  models?: ModelUsage[];
  model?: string;
  usage?: UsageEntry[];
  total_cost?: string;
  cost?: string;
}
interface BizData {
  total?: ModelUsage[];
  days?: DailyItem[];
}
interface UsageAmountResponse {
  code: number;
  msg: string;
  data: { biz_code: number; biz_msg: string; biz_data?: BizData };
}

// ---------------------------------------------------------------
//  Platform API calls
// ---------------------------------------------------------------
async function platformGet(path: string, apiKey: string, timeoutMs: number, cookie?: string): Promise<string | null> {
  try { return await httpGet(PLATFORM_HOST, path, apiKey, timeoutMs, cookie); }
  catch (e) {
    const err = e as ApiError;
    console.log(`[deepseek] Platform API error (${path}): ${err.message}`);
    return null;
  }
}

export async function fetchUserSummary(apiKey: string, timeoutMs: number, cookie?: string): Promise<UserSummaryResponse> {
  const body = await platformGet('/api/v0/users/get_user_summary', apiKey, timeoutMs, cookie);
  if (body) {
    try {
      const parsed = JSON.parse(body);
      const inner = parsed?.data?.biz_data || parsed?.data || parsed;
      // Extract actual billing data from API
      const monthlyCost = inner?.monthly_costs?.[0]?.amount ? parseFloat(inner.monthly_costs[0].amount) : (inner?.total_cost || 0);
      return {
        current_token: inner?.current_token,
        total_available_token_estimation: inner?.total_available_token_estimation ? parseFloat(inner.total_available_token_estimation) : undefined,
        monthly_token_usage: inner?.monthly_token_usage ? parseFloat(inner.monthly_token_usage) : undefined,
        total_cost: monthlyCost || undefined,
        total_topup_amount: inner?.total_topup_amount,
        total_grant_amount: inner?.total_grant_amount,
      };
    } catch { /* */ }
  }
  return {};
}

// ---------------------------------------------------------------
//  Parse the nested usage response
// ---------------------------------------------------------------
/** Extract token amounts from a usage array by type */
function usageAmount(usage: UsageEntry[] | undefined, types: string[]): number {
  if (!usage) return 0;
  for (const type of types) {
    const entry = usage.find(u => u.type === type);
    if (entry) return parseInt(entry.amount, 10) || 0;
  }
  return 0;
}

/** Convert a ModelUsage entry to our flat format */
function flattenModelUsage(mu: ModelUsage, date?: string, extraCost?: number): {
  date: string; model: string; promptTokens: number; completionTokens: number;
  cacheHitTokens: number; cacheMissTokens: number; cost: number; requests: number;
} {
  const usage = mu.usage ?? [];
  const directPrompt = usageAmount(usage, ['PROMPT_TOKEN']);
  const cacheHit = usageAmount(usage, ['PROMPT_CACHE_HIT_TOKEN']);
  const cacheMiss = usageAmount(usage, ['PROMPT_CACHE_MISS_TOKEN']);
  const prompt = directPrompt + cacheHit + cacheMiss;  // PROMPT_TOKEN is usually 0, input is cache tokens
  const completion = usageAmount(usage, ['RESPONSE_TOKEN', 'COMPLETION_TOKEN']);

  // Calculate cost from token counts using model pricing (CNY per 1M tokens)
  const pricing = getModelPricing(mu.model);
  const inputCost = (cacheMiss / 1_000_000) * pricing.inputPrice + (cacheHit / 1_000_000) * pricing.cacheHitPrice;
  const outputCost = (completion / 1_000_000) * pricing.outputPrice;
  const calculatedCost = inputCost + outputCost;

  // Use API cost if available, otherwise calculated
  const apiCost = parseFloat(mu.total_cost || mu.cost || '0') || extraCost || 0;

  return {
    date: date ?? '',
    model: mu.model,
    promptTokens: prompt,
    completionTokens: completion,
    cacheHitTokens: cacheHit,
    cacheMissTokens: cacheMiss,
    cost: apiCost > 0 ? apiCost : Math.round(calculatedCost * 100) / 100,
    requests: usageAmount(usage, ['REQUEST']),
  };
}

export async function fetchPlatformUsage(
  apiKey: string, timeoutMs: number, cookie?: string
): Promise<{ dailyItems: ReturnType<typeof flattenModelUsage>[]; monthlyCost: number; costMap: Record<string, number>; platformReachable: boolean }> {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  const [b1, b2, cost1, cost2] = await Promise.all([
    platformGet(`/api/v0/usage/amount?month=${month}&year=${year}`, apiKey, timeoutMs, cookie),
    platformGet(`/api/v0/usage/amount?month=${prevMonth}&year=${prevYear}`, apiKey, timeoutMs, cookie),
    platformGet(`/api/v0/usage/cost?month=${month}&year=${year}`, apiKey, timeoutMs, cookie),
    platformGet(`/api/v0/usage/cost?month=${prevMonth}&year=${prevYear}`, apiKey, timeoutMs, cookie),
  ]);

  // Build cost lookup: date → total cost
  var costMap: Record<string, number> = {};
  for (const costBody of [cost1, cost2]) {
    if (!costBody) continue;
    try {
      var costR = JSON.parse(costBody) as UsageAmountResponse;
      // cost API returns biz_data as array [{total, days}], not object
      var costArr = costR?.data?.biz_data;
      if (Array.isArray(costArr)) {
        for (const costEntry of costArr) {
          if ((costEntry as any).days) {
            for (const day of (costEntry as any).days) {
              if (day.date && day.data) {
                var dayTotalCost = 0;
                for (const item of day.data) {
                  for (const u of (item.usage || [])) {
                    dayTotalCost += parseFloat(u.amount || '0');
                  }
                }
                costMap[day.date] = (costMap[day.date] || 0) + dayTotalCost;
              }
            }
          }
        }
      }
    } catch { /* skip */ }
  }

  const all: ReturnType<typeof flattenModelUsage>[] = [];
  let monthlyCost = 0;

  for (const body of [b1, b2]) {
    if (!body) continue;
    try {
      const r = JSON.parse(body) as UsageAmountResponse;
      const biz = r?.data?.biz_data;
      if (!biz) continue;

      // Total view
      if (biz.total) {
        for (const mu of biz.total) {
          monthlyCost += parseFloat(mu.total_cost || '0') || 0;
        }
      }

      // Daily view — key is "days" not "daily"
      if (biz.days) {
        for (const day of biz.days) {
          const dayDate = day.date || '';
          // Use the day-level cost from API (actual billing)
          const dayCost = parseFloat(day.total_cost || day.cost || '0') || 0;

          // Key is "data" in the actual API
          const subItems = day.data || day.items || day.models;
          if (Array.isArray(subItems)) {
            // Split dayCost proportionally among models by token count
            var dayTotalTokens = 0;
            for (const item of subItems) {
              const iu = (item as ModelUsage).usage ?? [];
              dayTotalTokens += usageAmount(iu, ['PROMPT_TOKEN']) + usageAmount(iu, ['PROMPT_CACHE_HIT_TOKEN']) + usageAmount(iu, ['PROMPT_CACHE_MISS_TOKEN']) + usageAmount(iu, ['RESPONSE_TOKEN', 'COMPLETION_TOKEN']);
            }
            for (const item of subItems) {
              const iu = (item as ModelUsage).usage ?? [];
              var itemTokens = usageAmount(iu, ['PROMPT_TOKEN']) + usageAmount(iu, ['PROMPT_CACHE_HIT_TOKEN']) + usageAmount(iu, ['PROMPT_CACHE_MISS_TOKEN']) + usageAmount(iu, ['RESPONSE_TOKEN', 'COMPLETION_TOKEN']);
              var itemCost = dayTotalTokens > 0 ? (itemTokens / dayTotalTokens) * dayCost : 0;
              all.push(flattenModelUsage(item as ModelUsage, dayDate, itemCost));
            }
          } else if (day.model) {
            all.push(flattenModelUsage(day as any, dayDate, dayCost));
          } else if (day.usage) {
            all.push(flattenModelUsage(day as any, dayDate, dayCost));
          }
        }
      }
    } catch (e) { console.log('[deepseek] parse error: ' + (e as Error).message); }
  }

  const platformReachable = !!(b1 || b2 || cost1 || cost2);
  return { dailyItems: all, monthlyCost, costMap, platformReachable };
}

// ---------------------------------------------------------------
//  Aggregation
// ---------------------------------------------------------------
function aggregate(items: ReturnType<typeof flattenModelUsage>[], label: string): UsageSummary {
  let pt = 0, ct = 0, ch = 0, cm = 0, cost = 0, req = 0;
  for (const i of items) {
    pt += i.promptTokens;
    ct += i.completionTokens;
    ch += i.cacheHitTokens;
    cm += i.cacheMissTokens;
    cost += i.cost;
    req += i.requests;
  }
  const totalInput = ch + cm;
  return {
    periodLabel: label,
    promptTokens: pt, completionTokens: ct, totalTokens: pt + ct,
    estimatedCost: Math.round(cost * 100) / 100,
    cacheHitTokens: ch, cacheMissTokens: cm,
    cacheHitRate: totalInput > 0 ? Math.round((ch / totalInput) * 10000) / 100 : null,
    recordCount: req,
  };
}

function buildDailyPoints(items: ReturnType<typeof flattenModelUsage>[]): DailyUsagePoint[] {
  const map = new Map<string, { tokens: number; cost: number; hit: number; miss: number }>();
  for (const i of items) {
    const d = i.date || '';
    if (!d) continue;
    const e = map.get(d) || { tokens: 0, cost: 0, hit: 0, miss: 0 };
    e.tokens += i.promptTokens + i.completionTokens;
    e.cost += i.cost;
    e.hit += i.cacheHitTokens;
    e.miss += i.cacheMissTokens;
    map.set(d, e);
  }
  return Array.from(map.entries()).map(([date, v]) => ({
    date,
    totalTokens: v.tokens,
    estimatedCost: Math.round(v.cost * 100) / 100,
    cacheHitRate: (v.hit + v.miss) > 0 ? Math.round((v.hit / (v.hit + v.miss)) * 10000) / 100 : null,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------
//  Main entry
// ---------------------------------------------------------------
export async function fetchFullUsage(
  apiKey: string, timeoutMs: number, cookie?: string
): Promise<{ data: UsageData; dailyHistory: DailyUsagePoint[]; userSummary: UserSummaryResponse; platformReachable: boolean }> {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  try {
    // PRIMARY: v1/usage (API Key only, always works)
    // SECONDARY: platform API (needs cookie, provides cache stats + user summary)
    const [v1Current, v1Prev, userSummary, pu] = await Promise.all([
      fetchV1UsageMonth(apiKey, timeoutMs, year, month),
      fetchV1UsageMonth(apiKey, timeoutMs, prevYear, prevMonth),
      fetchUserSummary(apiKey, timeoutMs, cookie),
      fetchPlatformUsage(apiKey, timeoutMs, cookie),
    ]);

    // Aggregate v1 records into daily items
    const v1CurrentAgg = aggregateV1Records(v1Current);
    const v1PrevAgg = aggregateV1Records(v1Prev);
    let allItems = [...v1CurrentAgg.dailyItems, ...v1PrevAgg.dailyItems];
    let monthlyCost = v1CurrentAgg.monthlyCost;

    // Merge platform cache stats into v1 items (match by date+model)
    if (pu.platformReachable) {
      for (const item of allItems) {
        const match = pu.dailyItems.find(
          p => p.date === item.date && p.model === item.model
        );
        if (match) {
          // Enrich with platform cache data (more detailed)
          item.cacheHitTokens = match.cacheHitTokens || item.cacheHitTokens;
          item.cacheMissTokens = match.cacheMissTokens || item.cacheMissTokens;
          // Use platform cost if available (more accurate)
          if (match.cost > 0) item.cost = match.cost;
        }
      }
      // Also include any platform-only items
      const v1Keys = new Set(allItems.map(i => `${i.date}|${i.model}`));
      for (const pItem of pu.dailyItems) {
        if (!v1Keys.has(`${pItem.date}|${pItem.model}`)) {
          allItems.push(pItem);
        }
      }
      // Use platform monthly cost if higher (more complete)
      if (pu.monthlyCost > monthlyCost) monthlyCost = pu.monthlyCost;
    }

    const today = new Date().toISOString().split('T')[0];
    const monthStart = today.slice(0, 7) + '-01';
    const dailyHistory = buildDailyPoints(allItems);

    // Build per-model breakdown from today's data
    var modelMap: Record<string, { cost: number; tokens: number; cacheHit: number }> = {};
    for (const item of allItems.filter(i => i.date === today)) {
      var m = item.model;
      if (!modelMap[m]) modelMap[m] = { cost: 0, tokens: 0, cacheHit: 0 };
      modelMap[m].cost += item.cost;
      modelMap[m].tokens += item.promptTokens + item.completionTokens;
      modelMap[m].cacheHit += item.cacheHitTokens;
    }
    var modelBreakdown = Object.entries(modelMap)
      .filter(([_, v]) => v.tokens > 0)
      .map(([model, v]) => ({ model, cost: Math.round(v.cost * 100) / 100, tokens: v.tokens, cacheHitTokens: v.cacheHit }))
      .sort((a, b) => b.cost - a.cost);

    const v1Reachable = v1Current.length > 0 || v1Prev.length > 0;

    return {
      data: {
        today: aggregate(allItems.filter(i => i.date === today), '今日'),
        monthly: aggregate(allItems.filter(i => i.date >= monthStart && i.date <= today), '本月'),
        dailyHistory,
        modelBreakdown,
      },
      dailyHistory,
      userSummary,
      platformReachable: v1Reachable || pu.platformReachable,
    };
  } catch {
    const e = aggregate([], '');
    return { data: { today: { ...e, periodLabel: '今日' }, monthly: { ...e, periodLabel: '本月' }, dailyHistory: [], modelBreakdown: [] }, dailyHistory: [], userSummary: {}, platformReachable: false };
  }
}
