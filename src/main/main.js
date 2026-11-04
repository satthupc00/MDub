'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, safeStorage, nativeImage, net, screen, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

const { Settings } = require('./settings');
const { Translator, MODELS } = require('./translate');
const { JobManager } = require('./jobs');
const { ModelStore } = require('./tts/models');
const { TTSEngine } = require('./tts/engine');
const { VOICES } = require('./tts/voices');
const { createServer } = require('./server');
const { syncExtension } = require('./extension-sync');
const { Updater } = require('./updater');

const APP_TITLE = 'MDub';
const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');

// Cho phép chạy thử với thư mục dữ liệu riêng (dùng khi test)
if (process.env.MDUB_USER_DATA) app.setPath('userData', process.env.MDUB_USER_DATA);
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null, tray = null, quitting = false;
let settings, translator, jobs, store, tts, updater, server = { port: 0 }, extInfo = { dir: '', version: '' };
let modelState = { status: 'missing', done: 0, total: 0, file: '' };
let userWantsUpdate = false;
const logs = [];
const userData = () => app.getPath('userData');

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logs.push(line); if (logs.length > 300) logs.shift();
  try { fs.appendFileSync(path.join(userData(), 'mdub.log'), line + '\n'); } catch { /* ignore */ }
  send('log', line);
}

function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

const WHATSNEW = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'whatsnew.json'), 'utf8')); } catch { return null; } })();

function createWindow(show = true) {
  const s = settings.get();
  const b = s.bounds || {};
  const visible = b.x !== undefined && screen.getAllDisplays().some((d) => {
    const a = d.workArea; return b.x >= a.x - 50 && b.y >= a.y - 50 && b.x < a.x + a.width && b.y < a.y + a.height;
  });
  win = new BrowserWindow({
    title: APP_TITLE,
    width: b.width || 1200, height: b.height || 780,
    x: visible ? b.x : undefined, y: visible ? b.y : undefined,
    minWidth: 900, minHeight: 600,
    backgroundColor: '#1F2126',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1F2126', symbolColor: '#FFFFFF', height: 58 },
    autoHideMenuBar: true,
    icon: ICON,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (show) win.show(); });
  let bt = null;
  const saveBounds = () => {
    clearTimeout(bt);
    bt = setTimeout(() => { if (win && !win.isDestroyed() && !win.isMaximized() && !win.isMinimized()) { settings.get().bounds = win.getBounds(); settings.save(); } }, 500);
  };
  win.on('resize', saveBounds); win.on('move', saveBounds);
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function createTray() {
  const img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('MDub — thuyết minh YouTube');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mở MDub', click: showWindow },
    { label: 'Kiểm tra cập nhật', click: () => { showWindow(); updater.check(); } },
    { type: 'separator' },
    { label: 'Thoát', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

function appState() {
  return {
    version: app.getVersion(),
    settings: settings.public(),
    models: MODELS,
    voices: VOICES,
    availableVoices: store.availableVoices(),
    modelState: { ...modelState, status: store.isReady() ? 'ready' : modelState.status },
    provider: tts.provider,
    update: updater.state,
    extension: { dir: extInfo.dir, version: extInfo.version, port: server.port, lastSeen: extLastSeen },
    cacheSize: jobs.totalSize(),
    whatsnew: WHATSNEW,
    jobs: jobs.activeJobs(),
  };
}

let extLastSeen = 0;

async function downloadModels() {
  if (modelState.status === 'downloading') return;
  modelState = { status: 'downloading', done: 0, total: 0, file: '' };
  send('model', modelState);
  try {
    await store.downloadAll((url, opt) => net.fetch(url, opt), (p) => {
      modelState = { status: 'downloading', ...p };
      send('model', modelState);
    });
    modelState = { status: 'ready', done: modelState.total, total: modelState.total };
    log('Đã tải xong model Kokoro + giọng đọc');
    tts.restart();
    tts.start().then(() => send('state', appState())).catch((e) => log('Lỗi khởi động Kokoro: ' + e.message));
  } catch (e) {
    modelState = { status: 'error', error: e.message };
    log('Lỗi tải model: ' + e.message);
  }
  send('model', modelState);
  send('state', appState());
}

function setupIpc() {
  ipcMain.handle('state', () => appState());
  ipcMain.handle('settings:set', (_e, patch) => settings.set(patch));
  ipcMain.handle('settings:apiKey', async (_e, key) => {
    settings.setApiKey(key);
    if (!key) return { ok: true };
    try { await translator.testKey(); return { ok: true }; } catch (e) { return { ok: false, error: require('./jobs').friendlyError(e) }; }
  });
  ipcMain.handle('model:download', () => downloadModels());
  ipcMain.handle('voice:preview', async (_e, { voice, text }) => {
    if (!store.isReady()) throw new Error('Chưa tải model giọng đọc');
    const s = settings.get();
    const r = await tts.synth({ text: text || 'Xin chào, mình là giọng đọc thuyết minh của MDub.', voice, speed: s.speed || 1 });
    return r.wav;
  });
  ipcMain.handle('job:detail', (_e, id) => jobs.detail(id));
  ipcMain.handle('job:retranslate', (_e, id) => jobs.retranslate(id));
  ipcMain.handle('job:cancel', (_e, id) => jobs.cancel(id));
  ipcMain.handle('job:edit', (_e, { id, i, text }) => jobs.editLine(id, i, text));
  ipcMain.handle('job:audio', (_e, { id, i }) => { const f = jobs.audioFile(id, i); return f ? fs.readFileSync(f).toString('base64') : null; });
  ipcMain.handle('library', () => jobs.library());
  ipcMain.handle('library:remove', (_e, id) => jobs.remove(id));
  ipcMain.handle('cache:clear', () => jobs.clearAll());
  ipcMain.handle('cache:open', () => shell.openPath(path.join(userData(), 'cache')));
  ipcMain.handle('ext:openFolder', () => shell.openPath(extInfo.dir));
  ipcMain.handle('ext:copyPath', () => { clipboard.writeText(extInfo.dir); return extInfo.dir; });
  ipcMain.handle('ext:openChrome', () => openChromeExtensions());
  ipcMain.handle('open:video', (_e, { id, url }) => {
    if (url && /^https?:\/\//i.test(url)) return shell.openExternal(url);
    return shell.openExternal(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`);
  });
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:install', async () => { userWantsUpdate = true; await updater.download(); });
  ipcMain.handle('logs', () => logs);
}

function openChromeExtensions() {
  const { spawn } = require('child_process');
  const cands = [
    path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  const exe = cands.find((p) => p && fs.existsSync(p));
  if (exe) { spawn(exe, ['chrome://extensions/'], { detached: true, stdio: 'ignore' }).unref(); return true; }
  return false;
}

async function startServer() {
  const handlers = {
    status: async () => {
      extLastSeen = Date.now();
      return {
        app: 'MDub', version: app.getVersion(), extVersion: extInfo.version,
        ready: store.isReady(), hasApiKey: !!settings.getApiKey(), settings: settings.public(),
        voices: VOICES.filter((v) => store.availableVoices().includes(v.id) || !store.isReady()),
        update: updater.state,
      };
    },
    open: (b) => {
      if (!store.isReady()) return { state: 'error', error: 'Chưa tải giọng đọc. Mở app MDub để tải (1 lần).' };
      return jobs.open(b);
    },
    job: (id) => jobs.status(id),
    cursor: (id, t) => jobs.setCursor(id, t),
    audio: (id, i, v) => jobs.audioFile(id, i, v),
    settings: (patch) => settings.set(patch, { fromExtension: true }),
    checkUpdate: () => updater.check(),
    show: () => showWindow(),
  };
  server = await createServer({ token: () => settings.get().token, handlers });
  log('Cổng cho extension: 127.0.0.1:' + server.port);
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.mondiro.mdub');
  settings = new Settings(userData(), safeStorage);
  store = new ModelStore(path.join(userData(), 'models'));
  tts = new TTSEngine({ store, getSettings: () => settings.get(), log });
  translator = new Translator({ getApiKey: () => settings.getApiKey(), getSettings: () => settings.get(), log });
  if (process.env.MDUB_FAKE_TRANSLATE) {
    // chỉ dùng khi test tự động: không gọi Claude API
    translator.translate = async (cues) => ({ vi: cues.map((c) => `Câu thử nghiệm số ${c.i + 1}.`), model: 'test' });
  }
  jobs = new JobManager({ cacheDir: path.join(userData(), 'cache'), translator, tts, settings, log });
  updater = new Updater({
    log,
    onState: (st) => {
      send('update', st);
      if (st.status === 'downloaded' && userWantsUpdate) { quitting = true; setTimeout(() => updater.install(), 600); }
    },
  });
  jobs.on('update', (j) => send('job', j));
  settings.onChange((pub, patch) => {
    send('settings', pub);
    if ('autoStart' in patch) applyAutoStart();
    if ('useGpu' in patch) tts.restart();
  });

  setupIpc();
  try { await startServer(); } catch (e) { log(e.message); }
  try {
    extInfo = syncExtension({ appPath: app.getAppPath(), targetDir: path.join(userData(), 'extension'), port: server.port, token: settings.get().token });
  } catch (e) { log('Lỗi chuẩn bị extension: ' + e.message); }

  applyAutoStart();
  createTray();
  const hidden = process.argv.includes('--hidden');
  createWindow(!hidden);
  if (store.isReady()) tts.start().then(() => send('state', appState())).catch((e) => log('Lỗi khởi động Kokoro: ' + e.message));
  setTimeout(() => updater.check(), 4000);
  setInterval(() => updater.check(), 6 * 3600 * 1000);
});

function applyAutoStart() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!settings.get().autoStart, args: ['--hidden'] });
}

app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* chạy tiếp ở khay hệ thống */ });
