#!/usr/bin/env node
/**
 * DeepSeek Auth Auto-Sync — Playwright 版本
 *
 * 使用持久化浏览器实例，可以读取包括 HttpOnly 在内的所有 Cookie。
 * 首次运行需手动登录一次，之后每次运行自动提取最新认证信息发送到 VS Code 插件。
 *
 * 用法:
 *   node scripts/sync-playwright.js              # 自动模式（使用已保存的登录态）
 *   node scripts/sync-playwright.js --login      # 交互模式（手动登录/重新登录）
 *
 * 定时运行（Windows Task Scheduler 每 4 小时）:
 *   schtasks /create /tn "DeepSeekAuthSync" /tr "node D:\...\sync-playwright.js" /sc hourly /mo 4
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

// ============================================================
// 配置
// ============================================================
const PROFILE_DIR = path.join(os.homedir(), '.deepseek-monitor', 'browser-profile');
const PLUGIN_URL = 'http://127.0.0.1:9877/auth';
const PLATFORM_URL = 'https://platform.deepseek.com/usage';

// ============================================================
// 工具函数
// ============================================================
function log(msg) {
  const ts = new Date().toLocaleTimeString('zh-CN');
  console.log(`[${ts}] ${msg}`);
}

function postAuth(token, cookie) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ token, cookie });
    const req = http.request(PLUGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({ ok: res.statusCode === 200 });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const args = process.argv.slice(2);
  const interactive = args.includes('--login') || args.includes('-i');

  // 检查 Playwright 是否安装（全局安装的 npm 包 require 找不到，需要手动查路径）
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    // 尝试全局路径
    const { execSync } = require('child_process');
    let globalRoot = '';
    try {
      globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    } catch { /* ignore */ }

    const searchPaths = [
      globalRoot,
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules'),
      path.join(os.homedir(), 'AppData', 'Local', 'pnpm', 'global', '5', 'node_modules'),
      'C:\\Program Files\\nodejs\\node_modules',
    ].filter(Boolean);

    let found = false;
    for (const p of searchPaths) {
      const playwrightPath = path.join(p, 'playwright');
      if (fs.existsSync(playwrightPath)) {
        try {
          ({ chromium } = require(playwrightPath));
          found = true;
          break;
        } catch { /* try next */ }
      }
    }

    if (!found) {
      log('❌ Playwright 未找到。');
      log(`   搜索路径: ${searchPaths.join(', ')}`);
      log(`   安装命令: npm install -g playwright`);
      log(`   安装浏览器: npx playwright install chromium`);
      log(`   如已安装，手动指定路径: node scripts/sync-playwright.js --playwright-path "C:\\...\\node_modules"`);
      process.exit(1);
    }
  }

  // 确保 profile 目录存在
  if (!fs.existsSync(PROFILE_DIR)) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    log(`创建 profile 目录: ${PROFILE_DIR}`);
  }

  const isFirstRun = !fs.existsSync(path.join(PROFILE_DIR, 'Default'));

  // 判断是否需要交互模式
  const needLogin = interactive || isFirstRun;
  const headless = !needLogin;

  log(headless ? '🔍 自动模式（使用已保存登录态）' : '🔑 交互模式（需要登录）');

  // 启动持久化浏览器
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    viewport: { width: 1280, height: 800 },
    args: ['--no-sandbox'],
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    // 导航到 DeepSeek 平台
    await page.goto(PLATFORM_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(3000);

    // 检查登录状态 — 通过 URL 判断（不要依赖 localStorage key）
    const pageUrl = page.url();
    const onLoginPage = pageUrl.includes('login') || pageUrl.includes('signin');

    log(`当前页面: ${pageUrl}`);

    if (onLoginPage) {
      if (headless) {
        log('⚠ 登录态已过期，请用 --login 参数重新登录');
        await context.close();
        process.exit(1);
      }
      log('请在浏览器中登录 DeepSeek 平台...');

      // 等待跳转到 usage 页面（登录成功后会重定向）
      try {
        await page.waitForURL(url => !url.includes('login') && !url.includes('signin'), { timeout: 300000 });
        log('✅ 检测到登录成功！');
        await sleep(3000);
      } catch {
        log('❌ 登录超时（5 分钟）');
        await context.close();
        process.exit(1);
      }
    } else {
      log('✅ 已登录状态');
    }

    // 调试：dump localStorage 所有 key
    const lsKeys = await page.evaluate(() => {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key);
        keys.push(`${key}=${val.substring(0, 50)}...`);
      }
      return keys;
    });
    log(`localStorage keys: ${lsKeys.join(', ') || '(空)'}`);

    // 提取 JWT Token — 尝试多种来源
    let token = await page.evaluate(() => {
      // DeepSeek 把 token 存在 userToken key 里，值是 JSON: {"value":"OVFLARXK..."}
      for (const key of ['userToken', 'token', 'auth', 'authToken', 'access_token',
                          'accessToken', 'authorization', 'jwt', 'bearerToken', 'apiToken']) {
        let val = localStorage.getItem(key);
        if (!val || val.length < 10) continue;
        // 尝试解析 JSON（DeepSeek 用 {value: "..."} 格式）
        try {
          const parsed = JSON.parse(val);
          if (parsed && parsed.value && parsed.value.length > 10) return parsed.value;
        } catch {}
        return val; // 纯文本格式
      }
      for (const key of ['token', 'auth', 'authToken', 'access_token', 'userToken']) {
        let val = sessionStorage.getItem(key);
        if (!val || val.length < 10) continue;
        try {
          const parsed = JSON.parse(val);
          if (parsed && parsed.value && parsed.value.length > 10) return parsed.value;
        } catch {}
        return val;
      }
      return '';
    });

    // 提取所有 Cookie（Playwright 可以拿到 HttpOnly）
    const allCookies = await context.cookies();
    const deepseekCookies = allCookies.filter(c =>
      c.domain.includes('deepseek.com') || c.domain.includes('deepseek')
    );
    const cookieStr = deepseekCookies
      .map(c => `${c.name}=${c.value}`)
      .join('; ');

    log(`获取到 ${deepseekCookies.length} 个 DeepSeek Cookie`);
    log(`Cookie names: ${deepseekCookies.map(c => c.name).join(', ')}`);
    if (token) {
      log(`JWT Token: ${token.substring(0, 30)}...`);
    } else {
      log('⚠ 未从 localStorage/sessionStorage 提取到 JWT Token，将仅使用 Cookie');
    }

    // 必须有 Cookie（至少有一些认证相关的）
    if (deepseekCookies.length === 0) {
      log('❌ 未能提取到任何 DeepSeek Cookie');
      await context.close();
      process.exit(1);
    }

    // 发送到 VS Code 插件（token 可以为空，cookie 是必须的）
    log('发送认证信息到 VS Code 插件...');
    const result = await postAuth(token, cookieStr);

    if (result && result.ok) {
      log('✅ VS Code 插件已接收认证信息');
    } else {
      log('⚠ VS Code 插件可能未运行，但认证信息已准备好');
      log(`   result: ${JSON.stringify(result)}`);
    }
  } catch (err) {
    log(`❌ 错误: ${err.message}`);
  } finally {
    await context.close();
  }

  log('完成');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
