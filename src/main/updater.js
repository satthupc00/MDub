'use strict';
// Tự cập nhật từ GitHub Releases (satthupc00/MDub) bằng electron-updater.

const { app } = require('electron');

class Updater {
  constructor({ onState, log }) {
    this.onState = onState;
    this.log = log || (() => {});
    this.state = { status: 'idle', version: app.getVersion() };
    this.au = null;
    if (!app.isPackaged) return;
    const { autoUpdater } = require('electron-updater');
    this.au = autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }));
    autoUpdater.on('update-available', (i) => this.set({ status: 'available', latest: i.version, notes: i.releaseNotes || '' }));
    autoUpdater.on('update-not-available', () => this.set({ status: 'latest' }));
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i) => this.set({ status: 'downloaded', latest: i.version }));
    autoUpdater.on('error', (e) => { this.log('Lỗi cập nhật: ' + e.message); this.set({ status: 'error', error: 'Không kiểm tra được bản cập nhật' }); });
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
  }

  async check() {
    if (!this.au) { this.set({ status: 'dev' }); return this.state; }
    try { await this.au.checkForUpdates(); } catch (e) { this.set({ status: 'error', error: e.message }); }
    return this.state;
  }

  async download() {
    if (!this.au) return;
    this.set({ status: 'downloading', percent: 0 });
    await this.au.downloadUpdate();
  }

  install() {
    if (this.au) this.au.quitAndInstall(true, true);
  }
}

module.exports = { Updater };
