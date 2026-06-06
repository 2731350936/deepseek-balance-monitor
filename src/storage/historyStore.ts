import { ExtensionContext } from 'vscode';
import { BalanceSnapshot, DailyUsagePoint, PersistedState } from '../types';

const STORAGE_KEY = 'deepseekBalance.state';
const MAX_HISTORY_DAYS = 90;
const MAX_BALANCE_RECORDS = 4320; // 90 days * 48 half-hourly checks

const DEFAULT_STATE: PersistedState = {
  balanceHistory: [],
  usageHistory: [],
  lastFetchTimeIso: null,
  lastErrorMessage: null,
};

/** Load persisted state with migration from old format */
export function loadState(context: ExtensionContext): PersistedState {
  const raw = context.globalState.get<Record<string, unknown>>(STORAGE_KEY);
  if (!raw) {
    return { ...DEFAULT_STATE };
  }

  // Migration: old format had `history` instead of `balanceHistory`
  const balanceHistory: BalanceSnapshot[] = Array.isArray(raw.balanceHistory)
    ? (raw.balanceHistory as BalanceSnapshot[])
    : Array.isArray(raw.history)
      ? (raw.history as BalanceSnapshot[])
      : [];

  const usageHistory: DailyUsagePoint[] = Array.isArray(raw.usageHistory)
    ? (raw.usageHistory as DailyUsagePoint[])
    : [];

  return {
    balanceHistory,
    usageHistory,
    lastFetchTimeIso: (raw.lastFetchTimeIso as string) ?? null,
    lastErrorMessage: (raw.lastErrorMessage as string) ?? null,
  };
}

/** Append a new balance snapshot and prune old records */
export async function appendBalanceSnapshot(
  context: ExtensionContext,
  snapshot: BalanceSnapshot
): Promise<void> {
  const state = loadState(context);
  state.balanceHistory.push(snapshot);

  // Prune old records
  const cutoff = Date.now() - MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000;
  state.balanceHistory = state.balanceHistory.filter(
    (r) => new Date(r.isoTime).getTime() >= cutoff
  );

  if (state.balanceHistory.length > MAX_BALANCE_RECORDS) {
    state.balanceHistory = state.balanceHistory.slice(-MAX_BALANCE_RECORDS);
  }

  state.lastErrorMessage = null;
  state.lastFetchTimeIso = snapshot.isoTime;

  await context.globalState.update(STORAGE_KEY, state);
}

/** Save aggregated daily usage points to state */
export async function saveUsageHistory(
  context: ExtensionContext,
  usageHistory: DailyUsagePoint[]
): Promise<void> {
  const state = loadState(context);
  state.usageHistory = usageHistory;
  state.lastFetchTimeIso = new Date().toISOString();
  await context.globalState.update(STORAGE_KEY, state);
}

/** Update last fetch timestamp and error info without adding a record */
export async function updateFetchMeta(
  context: ExtensionContext,
  errorMessage: string | null
): Promise<void> {
  const state = loadState(context);
  state.lastFetchTimeIso = new Date().toISOString();
  state.lastErrorMessage = errorMessage;
  await context.globalState.update(STORAGE_KEY, state);
}

/** Wipe all persisted data */
export async function clearAllHistory(context: ExtensionContext): Promise<void> {
  await context.globalState.update(STORAGE_KEY, {
    balanceHistory: [],
    usageHistory: [],
    lastFetchTimeIso: null,
    lastErrorMessage: null,
  });
}
