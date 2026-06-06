import { SecretStorage, workspace } from 'vscode';

const API_KEY_SECRET = 'deepseekBalance.apiKey';
const COOKIE_SECRET = 'deepseekBalance.platformCookie';

// ---- API Key ----
export async function setApiKey(secrets: SecretStorage, key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed.length === 0) throw new Error('API Key 不能为空');
  await secrets.store(API_KEY_SECRET, trimmed);
}
export async function getApiKey(secrets: SecretStorage): Promise<string | undefined> {
  return secrets.get(API_KEY_SECRET);
}
export async function deleteApiKey(secrets: SecretStorage): Promise<void> {
  await secrets.delete(API_KEY_SECRET);
}

// ---- Platform Cookie ----
export async function setPlatformCookie(secrets: SecretStorage, cookie: string): Promise<void> {
  const trimmed = cookie.trim();
  if (trimmed.length === 0) throw new Error('Cookie 不能为空');
  await secrets.store(COOKIE_SECRET, trimmed);
}
export async function getPlatformCookie(secrets: SecretStorage): Promise<string | undefined> {
  return secrets.get(COOKIE_SECRET);
}
export async function deletePlatformCookie(secrets: SecretStorage): Promise<void> {
  await secrets.delete(COOKIE_SECRET);
}

// ---- Extension Config ----
export function getExtensionConfig(): ExtensionConfig {
  const config = workspace.getConfiguration('deepseekBalance');
  return {
    refreshIntervalMs: config.get<number>('refreshIntervalSeconds', 300) * 1000,
    lowBalanceThreshold: config.get<number>('lowBalanceThresholdCNY', 10.0),
    showStatusBar: config.get<boolean>('showStatusBar', true),
    requestTimeoutMs: config.get<number>('requestTimeoutMs', 10000),
  };
}

export interface ExtensionConfig {
  refreshIntervalMs: number;
  lowBalanceThreshold: number;
  showStatusBar: boolean;
  requestTimeoutMs: number;
}
