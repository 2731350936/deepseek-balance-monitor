/**
 * Cookie extraction — Node.js 22.5+ required (for node:sqlite).
 * Reads Chrome/Edge cookies DB, decrypts them, outputs JSON to stdout.
 *
 * Usage: node extract-cookies.js
 * Output: { "cookie": "sessionid=xxx; ...", "source": "Edge" }
 *   or:   { "error": "...", "lockedBy": "Edge" }
 */
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---- DPAPI decryption via PowerShell ----
function dpapiDecrypt(b64Key) {
  const psScript = `
Add-Type -AssemblyName System.Security
$e = [Convert]::FromBase64String('${b64Key}')
$d = [System.Security.Cryptography.ProtectedData]::Unprotect($e, $null, 'CurrentUser')
[Convert]::ToBase64String($d)
`;
  const output = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psScript],
    { timeout: 10000, windowsHide: true, encoding: 'utf8' }
  );
  return Buffer.from(output.trim(), 'base64');
}

function decryptValue(encValue, key) {
  try {
    const buf = Buffer.from(encValue);
    const prefix = buf.subarray(0, 3).toString('ascii');
    if (prefix !== 'v10' && prefix !== 'v20') return null;
    const nonce = buf.subarray(3, 15);
    const tag = buf.subarray(buf.length - 16);
    const ct = buf.subarray(15, buf.length - 16);
    const dec = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    dec.setAuthTag(tag);
    return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
  } catch { return null; }
}

function getEncryptedKey(localStatePath) {
  try {
    const state = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
    const ek = state?.os_crypt?.encrypted_key;
    if (!ek) return null;
    const buf = Buffer.from(ek, 'base64');
    if (buf.subarray(0, 5).toString() === 'DPAPI') {
      return buf.subarray(5).toString('base64');
    }
    return ek;
  } catch { return null; }
}

function main() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const browsers = [
    { name: 'Edge', dir: path.join(localAppData, 'Microsoft', 'Edge', 'User Data') },
    { name: 'Chrome', dir: path.join(localAppData, 'Google', 'Chrome', 'User Data') },
  ];

  let lockedBy = null;

  for (const browser of browsers) {
    const lsPath = path.join(browser.dir, 'Local State');
    const dbPath = path.join(browser.dir, 'Default', 'Network', 'Cookies');

    if (!fs.existsSync(lsPath) || !fs.existsSync(dbPath)) continue;

    const tmpDb = path.join(os.tmpdir(), `ds_cookies_${Date.now()}.db`);
    let readPath = null;

    // Try copy first
    try {
      fs.copyFileSync(dbPath, tmpDb);
      readPath = tmpDb;
    } catch (e) {
      if (e.code === 'EBUSY') {
        lockedBy = browser.name;
        // Try direct read as fallback
        try {
          const db = new DatabaseSync(dbPath, { readonly: true });
          readPath = dbPath; // direct read worked
        } catch {
          continue; // fully locked, try next browser
        }
      } else {
        continue;
      }
    }

    if (!readPath) continue;

    try {
      const b64Key = getEncryptedKey(lsPath);
      if (!b64Key) { if (tmpDb === readPath) fs.unlinkSync(tmpDb); continue; }

      let key;
      try { key = dpapiDecrypt(b64Key); } catch { if (tmpDb === readPath) fs.unlinkSync(tmpDb); continue; }

      let db;
      try {
        db = new DatabaseSync(readPath, { readonly: true });
      } catch {
        if (tmpDb === readPath) fs.unlinkSync(tmpDb);
        continue;
      }

      try {
        const stmt = db.prepare(
          "SELECT host_key, name, encrypted_value FROM cookies WHERE host_key LIKE ?"
        );
        const rows = stmt.all('%deepseek.com%');

        if (rows && rows.length > 0) {
          const cookies = [];
          for (const row of rows) {
            const val = decryptValue(row.encrypted_value, key);
            if (val) cookies.push(`${row.name}=${val}`);
          }
          if (cookies.length > 0) {
            console.log(JSON.stringify({ cookie: cookies.join('; '), source: browser.name }));
            return;
          }
        }
      } finally {
        db.close();
      }

      if (tmpDb === readPath) fs.unlinkSync(tmpDb);
    } catch (e) {
      if (tmpDb === readPath) { try { fs.unlinkSync(tmpDb); } catch { /* */ } }
    }
  }

  // Not found
  const errMsg = lockedBy
    ? `${lockedBy} 浏览器正在运行，数据库被锁定。请关闭 ${lockedBy} 后重试，或使用「手动输入 Cookie」备用。`
    : '未找到 deepseek.com 的 Cookie。请在 Edge 中打开 platform.deepseek.com 确认已登录。';

  console.log(JSON.stringify({ error: errMsg, lockedBy: lockedBy || null }));
}

main();
