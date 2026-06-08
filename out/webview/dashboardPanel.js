"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardPanel = void 0;
const vscode_1 = require("vscode");
const templateGenerator_1 = require("./templateGenerator");
class DashboardPanel {
    constructor(panel) {
        this.disposables = [];
        this.panel = panel;
        // Track panel disposal
        this.panel.onDidDispose(() => {
            DashboardPanel.currentPanel = undefined;
        }, null, this.disposables);
    }
    /** Create or reveal the singleton panel */
    static createOrShow(context, apiKeyConfigured) {
        const column = vscode_1.ViewColumn.Two;
        // If panel already exists, reveal it
        if (DashboardPanel.currentPanel) {
            const existing = DashboardPanel.currentPanel;
            if (!existing.panel.visible) {
                existing.panel.reveal(column);
            }
            return existing;
        }
        // Otherwise create a new panel
        const panel = vscode_1.window.createWebviewPanel('deepseekBalanceDashboard', 'DeepSeek Balance', column, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode_1.Uri.joinPath(context.extensionUri, 'media')],
        });
        DashboardPanel.currentPanel = new DashboardPanel(panel);
        DashboardPanel.currentPanel.render(context, apiKeyConfigured);
        return DashboardPanel.currentPanel;
    }
    /** Render/update HTML content */
    render(context, apiKeyConfigured) {
        this.panel.webview.html = (0, templateGenerator_1.generateDashboardHtml)(this.panel.webview, context.extensionUri, apiKeyConfigured);
    }
    /** Send data to the webview */
    postMessage(message) {
        if (this.isActive()) {
            try {
                this.panel.webview.postMessage(message);
            }
            catch {
                // Panel may have been disposed between the isActive check and postMessage
            }
        }
    }
    /** Check if panel is still active */
    isActive() {
        return this.panel.visible;
    }
    /** Register listener for messages FROM webview */
    onDidReceiveMessage(handler) {
        this.panel.webview.onDidReceiveMessage(handler, null, this.disposables);
    }
    /** Update the panel content (e.g., after API key change) */
    refreshContent(context, apiKeyConfigured) {
        if (this.isActive()) {
            this.render(context, apiKeyConfigured);
        }
    }
    /** Clean up */
    dispose() {
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
exports.DashboardPanel = DashboardPanel;
//# sourceMappingURL=dashboardPanel.js.map