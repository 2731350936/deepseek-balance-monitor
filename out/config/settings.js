"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setApiKey = setApiKey;
exports.getApiKey = getApiKey;
exports.deleteApiKey = deleteApiKey;
exports.setPlatformCookie = setPlatformCookie;
exports.getPlatformCookie = getPlatformCookie;
exports.deletePlatformCookie = deletePlatformCookie;
exports.getExtensionConfig = getExtensionConfig;
const vscode_1 = require("vscode");
const API_KEY_SECRET = 'deepseekBalance.apiKey';
const COOKIE_SECRET = 'deepseekBalance.platformCookie';
// ---- API Key ----
async function setApiKey(secrets, key) {
    const trimmed = key.trim();
    if (trimmed.length === 0)
        throw new Error('API Key 不能为空');
    await secrets.store(API_KEY_SECRET, trimmed);
}
async function getApiKey(secrets) {
    return secrets.get(API_KEY_SECRET);
}
async function deleteApiKey(secrets) {
    await secrets.delete(API_KEY_SECRET);
}
// ---- Platform Cookie ----
async function setPlatformCookie(secrets, cookie) {
    const trimmed = cookie.trim();
    if (trimmed.length === 0)
        throw new Error('Cookie 不能为空');
    await secrets.store(COOKIE_SECRET, trimmed);
}
async function getPlatformCookie(secrets) {
    return secrets.get(COOKIE_SECRET);
}
async function deletePlatformCookie(secrets) {
    await secrets.delete(COOKIE_SECRET);
}
// ---- Extension Config ----
function getExtensionConfig() {
    const config = vscode_1.workspace.getConfiguration('deepseekBalance');
    return {
        refreshIntervalMs: config.get('refreshIntervalSeconds', 300) * 1000,
        lowBalanceThreshold: config.get('lowBalanceThresholdCNY', 10.0),
        showStatusBar: config.get('showStatusBar', true),
        requestTimeoutMs: config.get('requestTimeoutMs', 10000),
    };
}
//# sourceMappingURL=settings.js.map