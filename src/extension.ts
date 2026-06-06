import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
import { StatusBarManager } from './statusbar/statusBarManager';
import { DashboardPanel } from './webview/dashboardPanel';
import { IntervalTimer } from './timer/intervalTimer';
import { fetchBalance, fetchFullUsage, UserSummaryResponse } from './balance/api';
import {
  getApiKey, setApiKey, deleteApiKey,
  getPlatformCookie, setPlatformCookie, deletePlatformCookie,
  getExtensionConfig,
} from './config/settings';
import {
  loadState, appendBalanceSnapshot, saveUsageHistory, updateFetchMeta,
} from './storage/historyStore';
import { extractDeepSeekCookie } from './config/cookieExtractor';
import { ApiError, ApiErrorKind, BalanceSnapshot, UsageData } from './types';

let authServer: http.Server | null = null;

let statusBar: StatusBarManager;
let timer: IntervalTimer;
let isRefreshing = false;
let panelListenerSetup = false;

let latestBalanceSnapshot: BalanceSnapshot | null = null;
let latestUsageData: UsageData | null = null;
let latestUserSummary: UserSummaryResponse = {};
let hasCookie = false;
let platformReachable = false;
let cookieLastUpdated: string | null = null;
const COOKIE_TIMESTAMP_KEY = 'deepseekBalance.cookieLastUpdated';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  statusBar = new StatusBarManager('deepseekBalance.showDashboard');
  timer = new IntervalTimer();

  // Check if cookie is configured
  const savedCookie = await getPlatformCookie(context.secrets);
  hasCookie = !!savedCookie;
  cookieLastUpdated = context.globalState.get<string>(COOKIE_TIMESTAMP_KEY) || null;

  // ---- Register commands ----
  context.subscriptions.push(
    vscode.commands.registerCommand('deepseekBalance.showDashboard', () => {
      const panel = DashboardPanel.createOrShow(context, false);
      if (!panelListenerSetup) { setupPanelMessageHandler(context, panel); panelListenerSetup = true; }
      pushAllDataToPanel(context);
    }),

    vscode.commands.registerCommand('deepseekBalance.refreshBalance', () => doRefresh(context)),

    // API Key
    vscode.commands.registerCommand('deepseekBalance.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: '请输入 DeepSeek API Key',
        password: true, placeHolder: 'sk-...',
        validateInput: (v) => v.trim().length < 10 ? 'API Key 太短（最少10字符）' : null,
        ignoreFocusOut: true,
      });
      if (key) {
        await setApiKey(context.secrets, key.trim());
        vscode.window.showInformationMessage('API Key 已保存。');
        await doRefresh(context);
      }
    }),

    vscode.commands.registerCommand('deepseekBalance.clearApiKey', async () => {
      const ok = await vscode.window.showWarningMessage('确定清除 API Key？', { modal: true }, '确定');
      if (ok === '确定') { await deleteApiKey(context.secrets); statusBar.showNotConfigured(); }
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
        await setPlatformCookie(context.secrets, combined);
        hasCookie = true;
        cookieLastUpdated = new Date().toISOString();
        await context.globalState.update(COOKIE_TIMESTAMP_KEY, cookieLastUpdated);
        vscode.window.showInformationMessage('Cookie 和 Token 已保存。正在刷新...');
        await doRefresh(context);
        notifyDashboard(context, { type: 'apiKeyStatus', configured: true });
      }
    }),

    vscode.commands.registerCommand('deepseekBalance.autoExtractCookie', async () => {
      vscode.window.showInformationMessage('正在从浏览器提取 Cookie...');
      try {
        const result = await extractDeepSeekCookie();
        if (result) {
          await setPlatformCookie(context.secrets, result.cookie);
          hasCookie = true;
          cookieLastUpdated = new Date().toISOString();
          await context.globalState.update(COOKIE_TIMESTAMP_KEY, cookieLastUpdated);
          vscode.window.showInformationMessage(`✅ 已从 ${result.source} 自动提取 Cookie！刷新数据中...`);
          await doRefresh(context);
        } else {
          vscode.window.showWarningMessage(
            '未能自动提取 Cookie。请确保已用 Chrome/Edge 登录 platform.deepseek.com，然后重试。'
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(`提取失败: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('deepseekBalance.clearCookie', async () => {
      await deletePlatformCookie(context.secrets);
      hasCookie = false;
      cookieLastUpdated = null;
      await context.globalState.update(COOKIE_TIMESTAMP_KEY, undefined);
      vscode.window.showInformationMessage('Cookie 已清除。');
      notifyDashboard(context, { type: 'apiKeyStatus', configured: false });
    }),

    // Playwright auto-sync
    vscode.commands.registerCommand('deepseekBalance.syncPlaywright', async () => {
      const scriptPath = path.join(context.extensionPath, 'scripts', 'sync-playwright.js');
      const terminal = vscode.window.createTerminal('DeepSeek Auth Sync');
      terminal.show();
      terminal.sendText(`node "${scriptPath}" --login`);
      vscode.window.showInformationMessage('请在弹出的浏览器中登录 DeepSeek，完成后关闭浏览器即可。');
    })
  );

  // ---- Init ----
  const config = getExtensionConfig();
  statusBar.setVisibility(config.showStatusBar);

  const apiKey = await getApiKey(context.secrets);
  if (!apiKey) {
    statusBar.showNotConfigured();
    vscode.window.showInformationMessage('DeepSeek 用量监控: 请先设置 API Key。', '设置 API Key').then((sel) => {
      if (sel === '设置 API Key') vscode.commands.executeCommand('deepseekBalance.setApiKey');
    });
  } else {
    await doRefresh(context);
  }

  timer.start(() => doRefresh(context), config.refreshIntervalMs);

  startAuthServer(context);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('deepseekBalance')) {
        const nc = getExtensionConfig();
        statusBar.setVisibility(nc.showStatusBar);
        timer.start(() => doRefresh(context), nc.refreshIntervalMs);
      }
    })
  );
}

// ---------------------------------------------------------------
async function doRefresh(context: vscode.ExtensionContext): Promise<void> {
  if (isRefreshing) return;

  const apiKey = await getApiKey(context.secrets);
  if (!apiKey) { statusBar.showNotConfigured(); return; }

  isRefreshing = true;
  statusBar.showLoading();

  try {
    const config = getExtensionConfig();
    const cookie = await getPlatformCookie(context.secrets) ?? undefined;

    const [balanceSnapshot, usageResult] = await Promise.all([
      fetchBalance(apiKey, config.requestTimeoutMs),
      fetchFullUsage(apiKey, config.requestTimeoutMs, cookie),
    ]);

    await appendBalanceSnapshot(context, balanceSnapshot);
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
  } catch (err) {
    const apiErr = err as ApiError;
    const message = apiErr?.message ?? (err as Error).message ?? '未知错误';
    await updateFetchMeta(context, message);

    if (apiErr?.kind === ApiErrorKind.InvalidKey) {
      statusBar.showError('API Key 无效');
      vscode.window.showErrorMessage(message, '更新 API Key').then((sel) => {
        if (sel === '更新 API Key') vscode.commands.executeCommand('deepseekBalance.setApiKey');
      });
    } else {
      statusBar.showError(message);
    }
    notifyDashboard(context, { type: 'error', message });
  } finally {
    isRefreshing = false;
  }
}

// ---------------------------------------------------------------
function pushAllDataToPanel(context: vscode.ExtensionContext): void {
  const panel = DashboardPanel.currentPanel;
  if (!panel || !panel.isActive()) return;

  const state = loadState(context);

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

function notifyDashboard(context: vscode.ExtensionContext, msg: { type: 'apiKeyStatus'; configured: boolean } | { type: 'error'; message: string }): void {
  const panel = DashboardPanel.currentPanel;
  if (panel && panel.isActive()) panel.postMessage(msg as never);
}

// ---------------------------------------------------------------
function setupPanelMessageHandler(context: vscode.ExtensionContext, panel: DashboardPanel): void {
  panel.onDidReceiveMessage(async (msg) => {
    switch (msg.type) {
      case 'requestRefresh': await doRefresh(context); break;
      case 'requestSetApiKey': await vscode.commands.executeCommand('deepseekBalance.setApiKey'); break;
      case 'clearApiKey': await vscode.commands.executeCommand('deepseekBalance.clearApiKey'); break;
      case 'extractCookie': await vscode.commands.executeCommand('deepseekBalance.autoExtractCookie'); break;
      case 'inputCookie': await vscode.commands.executeCommand('deepseekBalance.setCookie'); break;
      case 'clearCookie': await vscode.commands.executeCommand('deepseekBalance.clearCookie'); break;
      case 'syncPlaywright': await vscode.commands.executeCommand('deepseekBalance.syncPlaywright'); break;
      case 'webviewReady':
        pushAllDataToPanel(context);
        panel.postMessage({ type: 'apiKeyStatus', configured: hasCookie });
        panel.postMessage({ type: 'cookieStatus', configured: hasCookie, lastUpdated: cookieLastUpdated });
        break;
    }
  });
}

// ---------------------------------------------------------------
//  Local HTTP server to receive browser cookie
// ---------------------------------------------------------------
function startAuthServer(context: vscode.ExtensionContext): void {
  authServer = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', 'https://platform.deepseek.com');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204); res.end(); return;
    }

    if (req.method === 'POST' && req.url === '/auth') {
      let body = '';
      req.on('data', (c: string) => body += c);
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          // Merge with existing: don't overwrite token/cookie with empty values
          const existing = await getPlatformCookie(context.secrets) || '';
          const parts = existing.split('|||');
          const oldToken = parts[0] || '';
          const oldCookie = parts[1] || '';
          const newToken = data.token || oldToken;
          const newCookie = data.cookie || oldCookie;
          const combined = newToken + '|||' + newCookie;
          await setPlatformCookie(context.secrets, combined);
          hasCookie = true;
          cookieLastUpdated = new Date().toISOString();
          await context.globalState.update(COOKIE_TIMESTAMP_KEY, cookieLastUpdated);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, hasToken: !!newToken, hasCookie: !!newCookie, updated: cookieLastUpdated }));
          vscode.window.showInformationMessage('✅ Cookie 已接收！正在刷新...');
          await doRefresh(context);
        } catch {
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

export function deactivate(): void {
  timer?.stop();
  statusBar?.dispose();
  DashboardPanel.currentPanel?.dispose();
  if (authServer) { authServer.close(); authServer = null; }
}
