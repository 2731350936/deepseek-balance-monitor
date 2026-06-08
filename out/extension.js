"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const http = __importStar(require("http"));
const path = __importStar(require("path"));
const cp = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const statusBarManager_1 = require("./statusbar/statusBarManager");
const dashboardPanel_1 = require("./webview/dashboardPanel");
const intervalTimer_1 = require("./timer/intervalTimer");
const api_1 = require("./balance/api");
const settings_1 = require("./config/settings");
const historyStore_1 = require("./storage/historyStore");
const cookieExtractor_1 = require("./config/cookieExtractor");
const types_1 = require("./types");
let authServer = null;
let statusBar;
let timer;
let isRefreshing = false;
let panelListenerSetup = false;
let latestBalanceSnapshot = null;
let latestUsageData = null;
let latestUserSummary = {};
let hasCookie = false;
let platformReachable = false;
let cookieLastUpdated = null;
const COOKIE_TIMESTAMP_KEY = 'deepseekBalance.cookieLastUpdated';
// ---------------------------------------------------------------
//  Playwright auto-install helpers
// ---------------------------------------------------------------
function findPlaywrightModulePath() {
    // Try local (development) resolution first
    try {
        return require.resolve('playwright');
    }
    catch { /* not in local node_modules */ }
    // Search global npm paths
    let globalRoot = '';
    try {
        globalRoot = cp.execSync('npm root -g', { encoding: 'utf8', timeout: 5000 }).trim();
    }
    catch { /* ignore */ }
    const searchPaths = [
        globalRoot,
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules'),
        path.join(os.homedir(), 'AppData', 'Local', 'pnpm', 'global', '5', 'node_modules'),
        '/usr/local/lib/node_modules',
        '/usr/lib/node_modules',
    ].filter(Boolean);
    for (const p of searchPaths) {
        const playwrightPath = path.join(p, 'playwright');
        if (fs.existsSync(playwrightPath)) {
            return playwrightPath;
        }
    }
    return null;
}
function findChromiumCache() {
    const cacheBases = [
        // macOS
        path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
        // Windows
        path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright'),
        // Linux
        path.join(os.homedir(), '.cache', 'ms-playwright'),
    ];
    for (const base of cacheBases) {
        if (!fs.existsSync(base))
            continue;
        let entries = [];
        try {
            entries = fs.readdirSync(base);
        }
        catch {
            continue;
        }
        if (entries.some(e => e.startsWith('chromium-'))) {
            return base;
        }
    }
    return null;
}
function execCommand(command) {
    return new Promise((resolve, reject) => {
        cp.exec(command, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err)
                reject(new Error(stderr || err.message));
            else
                resolve(stdout);
        });
    });
}
async function ensurePlaywright() {
    const pwPath = findPlaywrightModulePath();
    const chromiumCache = findChromiumCache();
    if (pwPath && chromiumCache) {
        // Everything already installed — fast path
        return true;
    }
    // Need to install something — show progress
    return await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'DeepSeek Monitor',
        cancellable: false,
    }, async (progress) => {
        try {
            if (!pwPath) {
                progress.report({ message: '安装 Playwright（约 2 MB）...' });
                await execCommand('npm install -g playwright');
            }
            if (!chromiumCache) {
                progress.report({ message: '下载 Chromium 浏览器（约 170 MB，仅首次下载）...' });
                await execCommand('npx playwright install chromium');
            }
            vscode.window.showInformationMessage('✅ Playwright 安装完成，正在启动浏览器...');
            return true;
        }
        catch (err) {
            const msg = err.message || '';
            console.error('[deepseek] Playwright install error:', msg);
            return false;
        }
    });
}
// ---------------------------------------------------------------
async function activate(context) {
    statusBar = new statusBarManager_1.StatusBarManager('deepseekBalance.showDashboard');
    timer = new intervalTimer_1.IntervalTimer();
    // Check if cookie is configured
    const savedCookie = await (0, settings_1.getPlatformCookie)(context.secrets);
    hasCookie = !!savedCookie;
    cookieLastUpdated = context.globalState.get(COOKIE_TIMESTAMP_KEY) || null;
    // ---- Register commands ----
    context.subscriptions.push(vscode.commands.registerCommand('deepseekBalance.showDashboard', () => {
        const panel = dashboardPanel_1.DashboardPanel.createOrShow(context, false);
        if (!panelListenerSetup) {
            setupPanelMessageHandler(context, panel);
            panelListenerSetup = true;
        }
        pushAllDataToPanel(context);
    }), vscode.commands.registerCommand('deepseekBalance.refreshBalance', () => doRefresh(context)), 
    // API Key
    vscode.commands.registerCommand('deepseekBalance.setApiKey', async () => {
        const key = await vscode.window.showInputBox({
            prompt: '请输入 DeepSeek API Key',
            password: true, placeHolder: 'sk-...',
            validateInput: (v) => v.trim().length < 10 ? 'API Key 太短（最少10字符）' : null,
            ignoreFocusOut: true,
        });
        if (key) {
            await (0, settings_1.setApiKey)(context.secrets, key.trim());
            vscode.window.showInformationMessage('API Key 已保存。');
            await doRefresh(context);
        }
    }), vscode.commands.registerCommand('deepseekBalance.clearApiKey', async () => {
        const ok = await vscode.window.showWarningMessage('确定清除 API Key？', { modal: true }, '确定');
        if (ok === '确定') {
            await (0, settings_1.deleteApiKey)(context.secrets);
            statusBar.showNotConfigured();
        }
    }), 
    // --- Cookie commands ---
    vscode.commands.registerCommand('deepseekBalance.setCookie', async () => {
        const cookie = await vscode.window.showInputBox({
            prompt: '粘贴 Cookie（不含 Authorization 那行）',
            password: true,
            placeHolder: 'smidV2=xxx; HWWAFSESID=xxx; ...',
            ignoreFocusOut: true,
        });
        if (cookie && cookie.trim()) {
            // Ask for the platform Authorization token separately
            const authToken = await vscode.window.showInputBox({
                prompt: '粘贴 Network 面板中 authorization 头的值（Bearer xxx）',
                password: true,
                placeHolder: 'Bearer vfjBkesFGvGJ1DQo5sKyy...',
                ignoreFocusOut: true,
            });
            // Store cookie + auth together: "BEARER_TOKEN|||COOKIE_STRING"
            const combined = (authToken?.trim() ?? '') + '|||' + cookie.trim();
            await (0, settings_1.setPlatformCookie)(context.secrets, combined);
            hasCookie = true;
            cookieLastUpdated = new Date().toISOString();
            await context.globalState.update(COOKIE_TIMESTAMP_KEY, cookieLastUpdated);
            vscode.window.showInformationMessage('Cookie 和 Token 已保存。正在刷新...');
            await doRefresh(context);
            notifyDashboard(context, { type: 'apiKeyStatus', configured: true });
        }
    }), vscode.commands.registerCommand('deepseekBalance.autoExtractCookie', async () => {
        vscode.window.showInformationMessage('正在从浏览器提取 Cookie...');
        try {
            const result = await (0, cookieExtractor_1.extractDeepSeekCookie)();
            if (result) {
                await (0, settings_1.setPlatformCookie)(context.secrets, result.cookie);
                hasCookie = true;
                cookieLastUpdated = new Date().toISOString();
                await context.globalState.update(COOKIE_TIMESTAMP_KEY, cookieLastUpdated);
                vscode.window.showInformationMessage(`✅ 已从 ${result.source} 自动提取 Cookie！刷新数据中...`);
                await doRefresh(context);
            }
            else {
                vscode.window.showWarningMessage('未能自动提取 Cookie。请确保已用 Chrome/Edge 登录 platform.deepseek.com，然后重试。');
            }
        }
        catch (err) {
            vscode.window.showErrorMessage(`提取失败: ${err.message}`);
        }
    }), vscode.commands.registerCommand('deepseekBalance.clearCookie', async () => {
        await (0, settings_1.deletePlatformCookie)(context.secrets);
        hasCookie = false;
        cookieLastUpdated = null;
        await context.globalState.update(COOKIE_TIMESTAMP_KEY, undefined);
        vscode.window.showInformationMessage('Cookie 已清除。');
        notifyDashboard(context, { type: 'apiKeyStatus', configured: false });
    }), 
    // Playwright auto-sync (with auto-install)
    vscode.commands.registerCommand('deepseekBalance.syncPlaywright', async () => {
        const ready = await ensurePlaywright();
        if (!ready) {
            const action = await vscode.window.showErrorMessage('Playwright 自动安装失败。请手动执行以下命令后重试：\nnpm install -g playwright\nnpx playwright install chromium', '复制命令', '取消');
            if (action === '复制命令') {
                await vscode.env.clipboard.writeText('npm install -g playwright && npx playwright install chromium');
                vscode.window.showInformationMessage('命令已复制到剪贴板');
            }
            return;
        }
        const scriptPath = path.join(context.extensionPath, 'scripts', 'sync-playwright.js');
        const terminal = vscode.window.createTerminal('DeepSeek Auth Sync');
        terminal.show();
        terminal.sendText(`node "${scriptPath}" --login`);
        vscode.window.showInformationMessage('请在弹出的浏览器中登录 DeepSeek，完成后关闭浏览器即可。');
    }));
    // ---- Init ----
    const config = (0, settings_1.getExtensionConfig)();
    statusBar.setVisibility(config.showStatusBar);
    const apiKey = await (0, settings_1.getApiKey)(context.secrets);
    if (!apiKey) {
        statusBar.showNotConfigured();
        vscode.window.showInformationMessage('DeepSeek 用量监控: 请先设置 API Key。', '设置 API Key').then((sel) => {
            if (sel === '设置 API Key')
                vscode.commands.executeCommand('deepseekBalance.setApiKey');
        });
    }
    else {
        await doRefresh(context);
    }
    timer.start(() => doRefresh(context), config.refreshIntervalMs);
    startAuthServer(context);
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('deepseekBalance')) {
            const nc = (0, settings_1.getExtensionConfig)();
            statusBar.setVisibility(nc.showStatusBar);
            timer.start(() => doRefresh(context), nc.refreshIntervalMs);
            // Notify webview of the new interval
            const panel = dashboardPanel_1.DashboardPanel.currentPanel;
            if (panel && panel.isActive()) {
                panel.postMessage({ type: 'configUpdate', refreshIntervalSeconds: nc.refreshIntervalMs / 1000 });
            }
        }
    }));
}
// ---------------------------------------------------------------
async function doRefresh(context) {
    if (isRefreshing)
        return;
    const apiKey = await (0, settings_1.getApiKey)(context.secrets);
    if (!apiKey) {
        statusBar.showNotConfigured();
        return;
    }
    isRefreshing = true;
    statusBar.showLoading();
    try {
        const config = (0, settings_1.getExtensionConfig)();
        const cookie = await (0, settings_1.getPlatformCookie)(context.secrets) ?? undefined;
        const [balanceSnapshot, usageResult] = await Promise.all([
            (0, api_1.fetchBalance)(apiKey, config.requestTimeoutMs),
            (0, api_1.fetchFullUsage)(apiKey, config.requestTimeoutMs, cookie),
        ]);
        await (0, historyStore_1.appendBalanceSnapshot)(context, balanceSnapshot);
        latestBalanceSnapshot = balanceSnapshot;
        latestUsageData = usageResult.data;
        latestUserSummary = usageResult.userSummary;
        platformReachable = usageResult.platformReachable;
        // Warn if cookie is configured but platform API is unreachable (likely expired JWT)
        if (hasCookie && !platformReachable) {
            console.log('[deepseek] Platform API unreachable — JWT token may have expired');
        }
        const todayTokens = usageResult.data.today.totalTokens || 0;
        const isLow = balanceSnapshot.totalBalance < config.lowBalanceThreshold;
        const todayCacheRate = usageResult.data.today.cacheHitRate;
        statusBar.updateBalance(balanceSnapshot.totalBalance, balanceSnapshot.currency, isLow, todayTokens, todayCacheRate);
        pushAllDataToPanel(context);
    }
    catch (err) {
        const apiErr = err;
        const message = apiErr?.message ?? err.message ?? '未知错误';
        await (0, historyStore_1.updateFetchMeta)(context, message);
        if (apiErr?.kind === types_1.ApiErrorKind.InvalidKey) {
            statusBar.showError('API Key 无效');
            vscode.window.showErrorMessage(message, '更新 API Key').then((sel) => {
                if (sel === '更新 API Key')
                    vscode.commands.executeCommand('deepseekBalance.setApiKey');
            });
        }
        else {
            statusBar.showError(message);
        }
        notifyDashboard(context, { type: 'error', message });
    }
    finally {
        isRefreshing = false;
    }
}
// ---------------------------------------------------------------
function pushAllDataToPanel(context) {
    const panel = dashboardPanel_1.DashboardPanel.currentPanel;
    if (!panel || !panel.isActive())
        return;
    const state = (0, historyStore_1.loadState)(context);
    // Balance
    const lastBal = latestBalanceSnapshot ?? (state.balanceHistory.length > 0 ? state.balanceHistory[state.balanceHistory.length - 1] : null);
    if (lastBal) {
        const now = Date.now();
        const history7d = state.balanceHistory.filter((r) => now - new Date(r.isoTime).getTime() < 7 * 86400000);
        const history30d = state.balanceHistory.filter((r) => now - new Date(r.isoTime).getTime() < 30 * 86400000);
        panel.postMessage({ type: 'updateBalance', current: lastBal, history7d, history30d });
    }
    // Usage
    if (latestUsageData) {
        panel.postMessage({
            type: 'updateUsage',
            data: latestUsageData,
            userSummary: {
                currentToken: latestUserSummary.current_token,
                availableTokenEstimation: latestUserSummary.total_available_token_estimation,
                monthlyTokenUsage: latestUserSummary.monthly_token_usage,
                totalCost: latestUserSummary.total_cost,
            },
            platformReachable,
        });
    }
    // Cookie status
    panel.postMessage({ type: 'apiKeyStatus', configured: hasCookie });
    panel.postMessage({ type: 'cookieStatus', configured: hasCookie, lastUpdated: cookieLastUpdated });
}
function notifyDashboard(context, msg) {
    const panel = dashboardPanel_1.DashboardPanel.currentPanel;
    if (panel && panel.isActive())
        panel.postMessage(msg);
}
// ---------------------------------------------------------------
function setupPanelMessageHandler(context, panel) {
    panel.onDidReceiveMessage(async (msg) => {
        switch (msg.type) {
            case 'requestRefresh':
                await doRefresh(context);
                break;
            case 'requestSetApiKey':
                await vscode.commands.executeCommand('deepseekBalance.setApiKey');
                break;
            case 'clearApiKey':
                await vscode.commands.executeCommand('deepseekBalance.clearApiKey');
                break;
            case 'extractCookie':
                await vscode.commands.executeCommand('deepseekBalance.autoExtractCookie');
                break;
            case 'inputCookie':
                await vscode.commands.executeCommand('deepseekBalance.setCookie');
                break;
            case 'clearCookie':
                await vscode.commands.executeCommand('deepseekBalance.clearCookie');
                break;
            case 'syncPlaywright':
                await vscode.commands.executeCommand('deepseekBalance.syncPlaywright');
                break;
            case 'setRefreshInterval':
                await vscode.workspace.getConfiguration('deepseekBalance').update('refreshIntervalSeconds', msg.seconds, vscode.ConfigurationTarget.Global);
                break;
            case 'webviewReady':
                pushAllDataToPanel(context);
                panel.postMessage({ type: 'apiKeyStatus', configured: hasCookie });
                panel.postMessage({ type: 'cookieStatus', configured: hasCookie, lastUpdated: cookieLastUpdated });
                panel.postMessage({ type: 'configUpdate', refreshIntervalSeconds: (0, settings_1.getExtensionConfig)().refreshIntervalMs / 1000 });
                break;
        }
    });
}
// ---------------------------------------------------------------
//  Local HTTP server to receive browser cookie
// ---------------------------------------------------------------
function startAuthServer(context) {
    authServer = http.createServer(async (req, res) => {
        // CORS
        res.setHeader('Access-Control-Allow-Origin', 'https://platform.deepseek.com');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.method === 'POST' && req.url === '/auth') {
            let body = '';
            req.on('data', (c) => body += c);
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
                    // Merge with existing: don't overwrite token/cookie with empty values
                    const existing = await (0, settings_1.getPlatformCookie)(context.secrets) || '';
                    const parts = existing.split('|||');
                    const oldToken = parts[0] || '';
                    const oldCookie = parts[1] || '';
                    const newToken = data.token || oldToken;
                    const newCookie = data.cookie || oldCookie;
                    const combined = newToken + '|||' + newCookie;
                    await (0, settings_1.setPlatformCookie)(context.secrets, combined);
                    hasCookie = true;
                    cookieLastUpdated = new Date().toISOString();
                    await context.globalState.update(COOKIE_TIMESTAMP_KEY, cookieLastUpdated);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, hasToken: !!newToken, hasCookie: !!newCookie, updated: cookieLastUpdated }));
                    vscode.window.showInformationMessage('✅ Cookie 已接收！正在刷新...');
                    await doRefresh(context);
                }
                catch {
                    res.writeHead(400);
                    res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
                }
            });
            return;
        }
        res.writeHead(404);
        res.end('Not found');
    });
    authServer.listen(9877, '127.0.0.1', () => {
        console.log('[deepseek] Auth server listening on http://127.0.0.1:9877');
    });
}
function deactivate() {
    timer?.stop();
    statusBar?.dispose();
    dashboardPanel_1.DashboardPanel.currentPanel?.dispose();
    if (authServer) {
        authServer.close();
        authServer = null;
    }
}
//# sourceMappingURL=extension.js.map