import {
  WebviewPanel,
  window,
  ViewColumn,
  Uri,
  ExtensionContext,
  Disposable,
} from 'vscode';
import { ToWebviewMessage, FromWebviewMessage } from '../types';
import { generateDashboardHtml } from './templateGenerator';

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;

  private readonly panel: WebviewPanel;
  private readonly disposables: Disposable[] = [];

  private constructor(panel: WebviewPanel) {
    this.panel = panel;

    // Track panel disposal
    this.panel.onDidDispose(
      () => {
        DashboardPanel.currentPanel = undefined;
      },
      null,
      this.disposables
    );
  }

  /** Create or reveal the singleton panel */
  public static createOrShow(
    context: ExtensionContext,
    apiKeyConfigured: boolean
  ): DashboardPanel {
    const column = ViewColumn.Two;

    // If panel already exists, reveal it
    if (DashboardPanel.currentPanel) {
      const existing = DashboardPanel.currentPanel;
      if (!existing.panel.visible) {
        existing.panel.reveal(column);
      }
      return existing;
    }

    // Otherwise create a new panel
    const panel = window.createWebviewPanel(
      'deepseekBalanceDashboard',
      'DeepSeek Balance',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [Uri.joinPath(context.extensionUri, 'media')],
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel);
    DashboardPanel.currentPanel.render(context, apiKeyConfigured);
    return DashboardPanel.currentPanel;
  }

  /** Render/update HTML content */
  private render(context: ExtensionContext, apiKeyConfigured: boolean): void {
    this.panel.webview.html = generateDashboardHtml(
      this.panel.webview,
      context.extensionUri,
      apiKeyConfigured
    );
  }

  /** Send data to the webview */
  public postMessage(message: ToWebviewMessage): void {
    if (this.isActive()) {
      try {
        this.panel.webview.postMessage(message);
      } catch {
        // Panel may have been disposed between the isActive check and postMessage
      }
    }
  }

  /** Check if panel is still active */
  public isActive(): boolean {
    return this.panel.visible;
  }

  /** Register listener for messages FROM webview */
  public onDidReceiveMessage(
    handler: (msg: FromWebviewMessage) => void
  ): void {
    this.panel.webview.onDidReceiveMessage(
      handler,
      null,
      this.disposables
    );
  }

  /** Update the panel content (e.g., after API key change) */
  public refreshContent(
    context: ExtensionContext,
    apiKeyConfigured: boolean
  ): void {
    if (this.isActive()) {
      this.render(context, apiKeyConfigured);
    }
  }

  /** Clean up */
  public dispose(): void {
    DashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}
