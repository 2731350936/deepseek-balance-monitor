import {
  StatusBarItem,
  StatusBarAlignment,
  window,
  ThemeColor,
} from 'vscode';

export class StatusBarManager {
  private readonly item: StatusBarItem;

  constructor(commandId: string) {
    this.item = window.createStatusBarItem(StatusBarAlignment.Right, 100);
    this.item.command = commandId;
    this.item.name = 'DeepSeek 用量监控';
    this.item.tooltip = 'DeepSeek 用量监控';
  }

  /** Show balance + usage stats */
  updateBalance(balance: number, currency: string, isLow: boolean, todayTokens?: number, cacheHitRate?: number | null): void {
    const formatted = balance.toFixed(2);
    const symbol = currency === 'CNY' ? '¥' : '$';
    let extra = '';
    if (todayTokens !== undefined && todayTokens > 0) {
      extra += ' | ' + this.fmtTokens(todayTokens);
    }
    if (cacheHitRate !== null && cacheHitRate !== undefined) {
      extra += ' | ' + cacheHitRate.toFixed(2) + '%';
    }
    if (isLow) {
      this.item.text = `$(warning) DeepSeek ${symbol}${formatted}${extra}`;
      this.item.backgroundColor = new ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.text = `$(dashboard) DeepSeek ${symbol}${formatted}${extra}`;
      this.item.backgroundColor = undefined;
    }
    this.item.show();
  }

  private fmtTokens(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }

  /** Show an error state in the status bar */
  showError(message: string): void {
    this.item.text = `$(error) DeepSeek 异常`;
    this.item.tooltip = `DeepSeek 用量监控\n错误: ${message}\n点击重试`;
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  /** Show a "not configured" state */
  showNotConfigured(): void {
    this.item.text = `$(key) DeepSeek: 点击设置API Key`;
    this.item.tooltip = 'DeepSeek 用量监控\nAPI Key 未配置。\n点击设置。';
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  /** Show a "loading" state */
  showLoading(): void {
    this.item.text = `$(sync~spin) DeepSeek`;
    this.item.tooltip = 'DeepSeek 用量监控\n正在获取余额...';
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  /** Show or hide based on setting */
  setVisibility(visible: boolean): void {
    if (visible) {
      this.item.show();
    } else {
      this.item.hide();
    }
  }

  /** Clean up on deactivation */
  dispose(): void {
    this.item.dispose();
  }
}
