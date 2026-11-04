'use strict';
// Chép extension Chrome đi kèm app ra một thư mục cố định để Chrome "Load unpacked".
// Mỗi lần app tự cập nhật, extension trong thư mục này cũng được thay mới;
// extension thấy version khác sẽ tự nạp lại (chrome.runtime.reload).

const fs = require('fs');
const path = require('path');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, e.name), b = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

function bundledExtensionDir(appPath) {
  const unpacked = appPath.replace(/app\.asar$/, 'app.asar.unpacked');
  const p = path.join(unpacked, 'extension');
  return fs.existsSync(p) ? p : path.join(appPath, 'extension');
}

function syncExtension({ appPath, targetDir, port, token }) {
  const src = bundledExtensionDir(appPath);
  const srcManifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
  let dstVersion = null;
  try { dstVersion = JSON.parse(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf8')).version; } catch { /* chưa có */ }
  if (dstVersion !== srcManifest.version || process.env.MDUB_DEV) copyDir(src, targetDir);
  const pair = { port, token, app: 'MDub' };
  const pairFile = path.join(targetDir, 'pair.json');
  let old = null;
  try { old = fs.readFileSync(pairFile, 'utf8'); } catch { /* chưa có */ }
  const next = JSON.stringify(pair);
  if (old !== next) fs.writeFileSync(pairFile, next);
  return { dir: targetDir, version: srcManifest.version };
}

module.exports = { syncExtension };
