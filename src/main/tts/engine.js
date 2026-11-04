'use strict';
// Điều khiển tiến trình TTS chạy ngầm (utilityProcess).

const path = require('path');

class TTSEngine {
  constructor({ store, getSettings, log }) {
    this.store = store;
    this.getSettings = getSettings;
    this.log = log || (() => {});
    this.proc = null;
    this.pending = new Map();
    this.seq = 0;
    this.ready = null;
    this.provider = null;
  }

  start() {
    if (this.ready) return this.ready;
    const { utilityProcess } = require('electron');
    this.proc = utilityProcess.fork(path.join(__dirname, 'worker.js'), [], { serviceName: 'MDub TTS' });
    this.proc.on('message', (m) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
    });
    this.proc.on('exit', () => {
      for (const p of this.pending.values()) p.reject(new Error('Tiến trình giọng đọc đã dừng'));
      this.pending.clear();
      this.proc = null;
      this.ready = null;
    });
    const voices = {};
    for (const id of this.store.availableVoices()) voices[id] = this.store.voicePath(id);
    this.ready = this.call({
      type: 'init', modelPath: this.store.modelPath(), voices, useGpu: this.getSettings().useGpu,
    }).then((r) => { this.provider = r.provider; this.log('Kokoro sẵn sàng: ' + r.provider); return r; })
      .catch((e) => { this.ready = null; throw e; });
    return this.ready;
  }

  call(msg) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.proc.postMessage({ ...msg, id });
    });
  }

  async synth(opts) {
    await this.start();
    return this.call({ type: 'synth', ...opts });
  }

  restart() {
    if (this.proc) this.proc.kill();
    this.proc = null;
    this.ready = null;
  }
}

module.exports = { TTSEngine };
