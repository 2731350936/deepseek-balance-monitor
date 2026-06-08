"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadState = loadState;
exports.appendBalanceSnapshot = appendBalanceSnapshot;
exports.saveUsageHistory = saveUsageHistory;
exports.updateFetchMeta = updateFetchMeta;
exports.clearAllHistory = clearAllHistory;
const STORAGE_KEY = 'deepseekBalance.state';
const MAX_HISTORY_DAYS = 90;
const MAX_BALANCE_RECORDS = 4320; // 90 days * 48 half-hourly checks
const DEFAULT_STATE = {
    balanceHistory: [],
    usageHistory: [],
    lastFetchTimeIso: null,
    lastErrorMessage: null,
};
/** Load persisted state with migration from old format */
function loadState(context) {
    const raw = context.globalState.get(STORAGE_KEY);
    if (!raw) {
        return { ...DEFAULT_STATE };
    }
    // Migration: old format had `history` instead of `balanceHistory`
    const balanceHistory = Array.isArray(raw.balanceHistory)
        ? raw.balanceHistory
        : Array.isArray(raw.history)
            ? raw.history
            : [];
    const usageHistory = Array.isArray(raw.usageHistory)
        ? raw.usageHistory
        : [];
    return {
        balanceHistory,
        usageHistory,
        lastFetchTimeIso: raw.lastFetchTimeIso ?? null,
        lastErrorMessage: raw.lastErrorMessage ?? null,
    };
}
/** Append a new balance snapshot and prune old records */
async function appendBalanceSnapshot(context, snapshot) {
    const state = loadState(context);
    state.balanceHistory.push(snapshot);
    // Prune old records
    const cutoff = Date.now() - MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000;
    state.balanceHistory = state.balanceHistory.filter((r) => new Date(r.isoTime).getTime() >= cutoff);
    if (state.balanceHistory.length > MAX_BALANCE_RECORDS) {
        state.balanceHistory = state.balanceHistory.slice(-MAX_BALANCE_RECORDS);
    }
    state.lastErrorMessage = null;
    state.lastFetchTimeIso = snapshot.isoTime;
    await context.globalState.update(STORAGE_KEY, state);
}
/** Save aggregated daily usage points to state */
async function saveUsageHistory(context, usageHistory) {
    const state = loadState(context);
    state.usageHistory = usageHistory;
    state.lastFetchTimeIso = new Date().toISOString();
    await context.globalState.update(STORAGE_KEY, state);
}
/** Update last fetch timestamp and error info without adding a record */
async function updateFetchMeta(context, errorMessage) {
    const state = loadState(context);
    state.lastFetchTimeIso = new Date().toISOString();
    state.lastErrorMessage = errorMessage;
    await context.globalState.update(STORAGE_KEY, state);
}
/** Wipe all persisted data */
async function clearAllHistory(context) {
    await context.globalState.update(STORAGE_KEY, {
        balanceHistory: [],
        usageHistory: [],
        lastFetchTimeIso: null,
        lastErrorMessage: null,
    });
}
//# sourceMappingURL=historyStore.js.map