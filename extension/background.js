'use strict';
// MDub service worker: cầu nối giữa trang YouTube và app MDub chạy trên máy (127.0.0.1).

const PORTS = [47821, 47822, 47823, 47824, 47825];
let pair = null;
let goodPort = null;

async function loadPair() {
  try {
    const r = await fetch(chrome.runtime.getURL('pair.json') + '?t=' + Date.now(), { cache: 'no-store' });
    pair = await r.json();
  } catch { pair = null; }
  return pair;
}

async function api(path, { method = 'GET', body, raw = false } = {}, retried = false) {
  if (!pair) await loadPair();
  if (!pair) throw new Error('not_paired');
  const ports = [...new Set([goodPort, pair.port, ...PORTS].filter(Boolean))];
  let lastErr;
  for (const port of ports) {
    let res;
    try {
      res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { 'X-MDub-Token': pair.token, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch (e) { lastErr = e; continue; }
    if (res.status === 401) {
      if (!retried) { await loadPair(); return api(path, { method, body, raw }, true); }
      lastErr = new Error('unauthorized'); continue;
    }
    goodPort = port;
    if (raw) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    }
    return res.json();
  }
  throw new Error(lastErr && lastErr.message === 'unauthorized' ? 'unauthorized' : 'offline');
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Khi app đã cập nhật extension trên ổ cứng → tự nạp lại.
async function maybeReload(status) {
  const mine = chrome.runtime.getManifest().version;
  if (!status || !status.extVersion || status.extVersion === mine) return;
  // chống nạp lại liên tục (vd extension được nạp từ thư mục khác thư mục của app)
  const { lastReload = 0 } = await chrome.storage.local.get('lastReload');
  if (Date.now() - lastReload < 10 * 60 * 1000) return;
  await chrome.storage.local.set({ lastReload: Date.now() });
  setTimeout(() => chrome.runtime.reload(), 500);
}

async function handle(msg) {
  switch (msg.type) {
    case 'status': { const st = await api('/status'); maybeReload(st); return st; }
    case 'open': return api('/open', { method: 'POST', body: msg.payload });
    case 'job': return api('/job/' + encodeURIComponent(msg.videoId));
    case 'cursor': return api('/cursor', { method: 'POST', body: { videoId: msg.videoId, t: msg.t } });
    case 'audio': {
      const q = msg.v ? '?v=' + encodeURIComponent(msg.v) : '';
      const buf = await api(`/audio/${encodeURIComponent(msg.videoId)}/${msg.i}${q}`, { raw: true });
      return { b64: toBase64(buf) };
    }
    case 'settings': return api('/settings', { method: 'POST', body: msg.patch });
    case 'checkUpdate': return api('/update/check', { method: 'POST' });
    case 'showApp': return api('/show', { method: 'POST' });
    case 'site': return siteAction(msg);
    default: throw new Error('unknown');
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  handle(msg).then((data) => reply({ ok: true, data }), (e) => reply({ ok: false, error: String(e.message || e) }));
  return true;
});

chrome.alarms.create('mdub-ping', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'mdub-ping') return;
  try { maybeReload(await api('/status')); } catch { /* app chưa chạy */ }
});

// ---------- Trang web người dùng tự thêm ----------
// Lưu: chrome.storage.local.sites = [{ host, enabled }]
const BUILTIN = ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'www.netflix.com', 'netflix.com'];
const scriptIds = (host) => [`mdub-main-${host}`, `mdub-iso-${host}`];
const patterns = (host) => [`https://${host}/*`, `http://${host}/*`];

async function getSites() {
  const { sites } = await chrome.storage.local.get('sites');
  return Array.isArray(sites) ? sites : [];
}

async function register(host) {
  const existing = new Set((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  const [mainId, isoId] = scriptIds(host);
  const toAdd = [];
  if (!existing.has(mainId)) toAdd.push({ id: mainId, matches: patterns(host), js: ['hook-generic.js'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true });
  if (!existing.has(isoId)) toAdd.push({ id: isoId, matches: patterns(host), js: ['content.js'], css: ['content.css'], runAt: 'document_idle', persistAcrossSessions: true });
  if (toAdd.length) await chrome.scripting.registerContentScripts(toAdd);
}

async function unregister(host) {
  const existing = new Set((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  const ids = scriptIds(host).filter((id) => existing.has(id));
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
}

// Đăng ký lại sau khi extension được cập nhật / Chrome khởi động
async function syncSites() {
  for (const s of await getSites()) {
    const has = await chrome.permissions.contains({ origins: patterns(s.host) }).catch(() => false);
    if (s.enabled && has) await register(s.host).catch(() => {});
    else await unregister(s.host).catch(() => {});
  }
}
chrome.runtime.onInstalled.addListener(syncSites);
chrome.runtime.onStartup.addListener(syncSites);

async function siteAction(msg) {
  let sites = await getSites();
  const host = String(msg.host || '').toLowerCase();
  if (msg.action === 'list') return { sites, builtin: BUILTIN };
  if (!host || BUILTIN.includes(host)) throw new Error('bad host');
  if (msg.action === 'enable') {
    if (!sites.some((s) => s.host === host)) sites.push({ host, enabled: true });
    sites = sites.map((s) => (s.host === host ? { ...s, enabled: true } : s));
    await chrome.storage.local.set({ sites });
    await register(host);
  } else if (msg.action === 'disable') {
    sites = sites.map((s) => (s.host === host ? { ...s, enabled: false } : s));
    await chrome.storage.local.set({ sites });
    await unregister(host);
  } else if (msg.action === 'remove') {
    sites = sites.filter((s) => s.host !== host);
    await chrome.storage.local.set({ sites });
    await unregister(host);
    await chrome.permissions.remove({ origins: patterns(host) }).catch(() => {});
  }
  if (msg.tabId && msg.action !== 'remove') chrome.tabs.reload(msg.tabId);
  return { sites, builtin: BUILTIN };
}
