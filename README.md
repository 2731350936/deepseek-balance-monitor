# DeepSeek Balance Monitor

实时在 VS Code 状态栏和仪表盘中显示 DeepSeek API 余额、Token 消耗、缓存命中率和每日费用。

![screenshot](media/icon.png)

## 功能

- 💰 **余额监控** — 状态栏实时显示，低余额警告
- 📊 **Token 用量** — 今日/本月消耗，输入/输出明细
- 🎯 **缓存命中率** — 输入缓存命中/未命中统计
- 📈 **趋势图表** — 每日 Token 热力图、余额趋势
- 🏷️ **模型明细** — 按模型拆分今日费用
- 🔄 **自动刷新** — 仪表盘一键切换 10s / 30s / 1m / 5m / 10m / 30m

## 安装

### 手动安装（.vsix）
下载 [Releases](https://github.com/2731350936/deepseek-balance-monitor/releases) 中的 `.vsix` 文件：
```
code --install-extension deepseek-balance-monitor-1.1.0.vsix
```

## 配置

### 1. API Key（必须）
`Ctrl+Shift+P` → `设置 API Key` → 输入 DeepSeek API Key（`sk-...`）

> 在 [platform.deepseek.com/apikeys](https://platform.deepseek.com/apikeys) 创建

### 2. 平台认证（Token 用量需要）

**★ 推荐 — Playwright 自动同步（全自动，含 HttpOnly Cookie）：**
点击仪表盘里的 "🔐 Playwright 自动登录" 按钮，**首次点击会自动安装** Playwright + Chromium（约 170 MB，仅一次），无需手动执行任何命令。登录后浏览器 Profile 持久化，几周才需重新登录一次。

如需定时全自动续期：
```powershell
schtasks /create /tn "DeepSeekAuthSync" /tr "node '路径\scripts\sync-playwright.js'" /sc hourly /mo 4
```

**备选 — 浏览器控制台（快速手动）：**
在 `platform.deepseek.com` 页面按 F12 → Console → 粘贴仪表盘中的一行代码

## 命令

| 命令 | 说明 |
|------|------|
| `显示用量面板` | 打开仪表盘 |
| `立即刷新` | 手动刷新数据 |
| `设置 API Key` | 配置 DeepSeek API Key |
| `Playwright 自动同步` | 用 Playwright 自动提取认证 |
| `手动输入 Cookie` | 手动粘贴 Cookie 和 JWT |
| `清除 Cookie` | 清除平台认证信息 |

## 开发

```powershell
git clone https://github.com/2731350936/deepseek-balance-monitor.git
cd deepseek-balance-monitor
npm install
npm run compile
# F5 启动调试
```

## Changelog

### v1.1.0
- ✨ 仪表盘新增**刷新间隔切换器**：10s / 30s / 1m / 5m / 10m / 30m 一键切换
- ✨ **Playwright 自动安装**：首次点击"Playwright 自动登录"自动安装依赖，无需手动执行命令
- 🔧 最小刷新间隔从 30s 降至 10s

### v1.0.0
- 初始版本

## 许可

MIT
