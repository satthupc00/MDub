'use strict';
// Quản lý việc xử lý từng video: lấy câu → dịch → tạo giọng → lưu cache.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const { buildCues, slotOf } = require('./captions');

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const safeId = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '');

function friendlyError(e) {
  const Anthropic = require('@anthropic-ai/sdk');
  if (e instanceof Anthropic.AuthenticationError) return 'API key Claude không đúng. Kiểm tra lại trong Cài đặt.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'API key không có quyền dùng model này.';
  if (e instanceof Anthropic.RateLimitError) return 'Claude đang giới hạn tốc độ, thử lại sau ít phút.';
  if (e instanceof Anthropic.BadRequestError && /credit|balance/i.test(e.message)) return 'Tài khoản Claude API đã hết credits.';
  if (e instanceof Anthropic.APIConnectionError) return 'Không kết nối được tới Claude. Kiểm tra mạng.';
  if (e instanceof Anthropic.APIError) return `Lỗi Claude API (${e.status}): ${e.message}`;
  return String((e && e.message) || e);
}

class JobManager extends EventEmitter {
  constructor({ cacheDir, translator, tts, settings, log }) {
    super();
    this.dir = cacheDir;
    this.translator = translator;
    this.tts = tts;
    this.settings = settings;
    this.log = log || (() => {});
    this.jobs = new Map();
    this.loopRunning = false;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  videoDir(id) { return path.join(this.dir, safeId(id)); }
  metaPath(id) { return path.join(this.videoDir(id), 'meta.json'); }
  readMeta(id) { try { return JSON.parse(fs.readFileSync(this.metaPath(id), 'utf8')); } catch { return null; } }
  writeMeta(meta) {
    meta.updatedAt = new Date().toISOString();
    fs.mkdirSync(this.videoDir(meta.videoId), { recursive: true });
    fs.writeFileSync(this.metaPath(meta.videoId) + '.tmp', JSON.stringify(meta));
    fs.renameSync(this.metaPath(meta.videoId) + '.tmp', this.metaPath(meta.videoId));
  }

  voiceKey(voice) {
    const s = this.settings.get();
    return `${voice || s.voice}@${Number(s.speed || 1).toFixed(2)}`;
  }

  audioPath(id, vkey, i) { return path.join(this.videoDir(id), 'audio', vkey.replace(/[^A-Za-z0-9_.@-]/g, ''), `${i}.wav`); }

  // Gọi từ extension khi mở video
  // Gọi từ extension khi mở video.
  // subs = {format:'json3'|'vtt'|'srt'|'ttml', data, lang}; json3 = kiểu cũ (YouTube)
  async open({ videoId, title, channel, json3, subs, voice, lang, duration, url, site }) {
    videoId = safeId(videoId);
    if (!subs && json3) subs = { format: 'json3', data: json3, lang };
    let job = this.jobs.get(videoId);
    let meta = job ? job.meta : this.readMeta(videoId);
    if (!meta || !meta.cues || !meta.cues.length) {
      if (!subs) return { state: 'need_captions' };
      let built;
      try { built = buildCues({ format: subs.format, data: subs.data }); } catch (e) { return { state: 'error', error: 'Không đọc được phụ đề: ' + e.message }; }
      const { cues, asr } = built;
      if (!cues.length) return { state: 'error', error: 'Phụ đề trống.' };
      const subLang = String(subs.lang || lang || 'en').toLowerCase();
      const isVi = /^vi/.test(subLang);
      meta = {
        videoId, title, channel, url, site: site || 'youtube', lang: subLang, source: isVi ? 'vi' : 'translate',
        duration, asr, cues, translation: null, audio: {}, createdAt: new Date().toISOString(),
      };
      // Phụ đề tiếng Việt có sẵn → đọc thẳng, không gọi Claude
      if (isVi) meta.translation = { model: 'subtitle', vi: cues.map((c) => c.en), at: new Date().toISOString() };
      this.writeMeta(meta);
    } else if ((title && meta.title !== title) || (url && meta.url !== url)) {
      meta.title = title || meta.title; meta.channel = channel || meta.channel; meta.url = url || meta.url; meta.site = site || meta.site;
      this.writeMeta(meta);
    }
    if (!job) {
      job = { meta, state: 'idle', error: null, translateProgress: 0, cursor: 0, touchedAt: Date.now() };
      this.jobs.set(videoId, job);
    }
    job.touchedAt = Date.now();
    job.voiceKey = this.voiceKey(voice);
    if (job.state === 'error') { job.state = 'idle'; job.failed = null; }
    this.kick(job);
    return this.status(videoId);
  }

  setCursor(videoId, t) {
    const job = this.jobs.get(safeId(videoId));
    if (job) { job.cursor = Number(t) || 0; job.touchedAt = Date.now(); }
  }

  async kick(job) {
    if (!job.meta.translation && job.state !== 'translating') {
      job.state = 'translating';
      job.error = null;
      this.emitUpdate(job);
      try {
        const { vi, model } = await this.translator.translate(job.meta.cues, {
          title: job.meta.title,
          onProgress: (p) => { job.translateProgress = p; this.emitUpdate(job); },
        });
        job.meta.translation = { model, vi, at: new Date().toISOString(), glossary: hash(JSON.stringify(this.settings.get().glossary || [])) };
        this.writeMeta(job.meta);
        job.state = 'idle';
      } catch (e) {
        job.state = 'error';
        job.error = friendlyError(e);
        this.log('Lỗi dịch: ' + job.error);
        this.emitUpdate(job);
        return;
      }
    }
    if (job.meta.translation) this.runLoop();
  }

  missing(job) {
    const vkey = job.voiceKey;
    const done = (job.meta.audio && job.meta.audio[vkey]) || {};
    const vi = job.meta.translation ? job.meta.translation.vi : [];
    const list = [];
    for (const c of job.meta.cues) {
      const text = vi[c.i];
      if (!text || (job.failed && job.failed.has(c.i))) continue;
      const rec = done[c.i];
      if (rec && rec.h === hash(text) && fs.existsSync(this.audioPath(job.meta.videoId, vkey, c.i))) continue;
      list.push(c);
    }
    return list;
  }

  counts(job) {
    const vi = job.meta.translation ? job.meta.translation.vi : [];
    const total = vi.filter(Boolean).length;
    return { total, done: total - (job.meta.translation ? this.missing(job).length : total) };
  }

  pickNext() {
    const jobs = [...this.jobs.values()].filter((j) => j.meta.translation && j.state !== 'error')
      .sort((a, b) => b.touchedAt - a.touchedAt);
    for (const job of jobs) {
      const miss = this.missing(job);
      if (!miss.length) {
        if (job.state !== 'ready') { job.state = 'ready'; this.emitUpdate(job); }
        continue;
      }
      // ưu tiên câu sắp tới tính từ vị trí đang xem
      const cur = job.cursor || 0;
      miss.sort((a, b) => {
        const ka = a.end < cur ? 1e7 + a.start : Math.abs(a.start - cur);
        const kb = b.end < cur ? 1e7 + b.start : Math.abs(b.start - cur);
        return ka - kb;
      });
      return { job, cue: miss[0] };
    }
    return null;
  }

  async runLoop() {
    if (this.loopRunning) return;
    this.loopRunning = true;
    try {
      for (;;) {
        const next = this.pickNext();
        if (!next) break;
        const { job, cue } = next;
        const s = this.settings.get();
        const vkey = job.voiceKey;
        const voice = vkey.split('@')[0];
        const text = job.meta.translation.vi[cue.i];
        job.state = 'synthesizing';
        try {
          const r = await this.tts.synth({
            text, voice, speed: s.speed || 1, maxSpeed: s.maxSpeed || 1.35,
            slot: slotOf(job.meta.cues, cue.i), out: this.audioPath(job.meta.videoId, vkey, cue.i),
          });
          job.meta.audio = job.meta.audio || {};
          job.meta.audio[vkey] = job.meta.audio[vkey] || {};
          job.meta.audio[vkey][cue.i] = { dur: +r.dur.toFixed(3), speed: +r.speed.toFixed(3), h: hash(text) };
          job.dirty = (job.dirty || 0) + 1;
          if (job.dirty >= 8) { this.writeMeta(job.meta); job.dirty = 0; }
        } catch (e) {
          job.failed = job.failed || new Set();
          job.failed.add(cue.i);
          this.log(`Lỗi tạo giọng câu ${cue.i}: ${friendlyError(e)}`);
          if (job.failed.size >= 5) {
            job.state = 'error';
            job.error = 'Lỗi tạo giọng: ' + friendlyError(e);
          }
        }
        this.emitUpdate(job);
      }
    } finally {
      for (const job of this.jobs.values()) if (job.dirty) { this.writeMeta(job.meta); job.dirty = 0; }
      this.loopRunning = false;
    }
  }

  status(videoId) {
    const job = this.jobs.get(safeId(videoId));
    if (!job) {
      const meta = this.readMeta(videoId);
      return meta ? { state: 'cached', title: meta.title } : { state: 'none' };
    }
    const m = job.meta;
    const vkey = job.voiceKey;
    const audio = (m.audio && m.audio[vkey]) || {};
    const vi = m.translation ? m.translation.vi : [];
    return {
      videoId: m.videoId,
      title: m.title,
      source: m.source || 'translate',
      state: job.state,
      error: job.error,
      voiceKey: vkey,
      asr: m.asr,
      model: m.translation && m.translation.model,
      translateProgress: m.translation ? 1 : job.translateProgress,
      tts: this.counts(job),
      cues: m.cues.map((c) => ({
        i: c.i, start: c.start, end: c.end, vi: vi[c.i] || '',
        has: !!(audio[c.i] && audio[c.i].h === hash(vi[c.i] || '')), dur: audio[c.i] ? audio[c.i].dur : 0,
      })),
    };
  }

  // Dữ liệu đầy đủ cho giao diện app
  detail(videoId) {
    const st = this.status(videoId);
    const meta = this.jobs.get(safeId(videoId))?.meta || this.readMeta(videoId);
    if (!meta) return null;
    return { ...st, channel: meta.channel, en: meta.cues.map((c) => c.en), slots: meta.cues.map((c) => +slotOf(meta.cues, c.i).toFixed(2)) };
  }

  audioFile(videoId, i, vkey) {
    const job = this.jobs.get(safeId(videoId));
    const key = vkey || (job && job.voiceKey) || this.voiceKey();
    const p = this.audioPath(videoId, key, Number(i));
    return fs.existsSync(p) ? p : null;
  }

  editLine(videoId, i, text) {
    const job = this.jobs.get(safeId(videoId));
    const meta = job ? job.meta : this.readMeta(videoId);
    if (!meta || !meta.translation) return;
    meta.translation.vi[i] = String(text || '').trim();
    this.writeMeta(meta);
    if (job) { job.state = 'idle'; this.runLoop(); this.emitUpdate(job); }
  }

  retranslate(videoId) {
    const job = this.jobs.get(safeId(videoId));
    const meta = job ? job.meta : this.readMeta(videoId);
    if (!meta) return;
    meta.translation = meta.source === 'vi' ? { model: 'subtitle', vi: meta.cues.map((c) => c.en), at: new Date().toISOString() } : null;
    meta.audio = {};
    fs.rmSync(path.join(this.videoDir(videoId), 'audio'), { recursive: true, force: true });
    this.writeMeta(meta);
    if (job) { job.state = 'idle'; job.translateProgress = 0; this.kick(job); }
  }

  cancel(videoId) {
    const job = this.jobs.get(safeId(videoId));
    if (job) { if (job.dirty) this.writeMeta(job.meta); this.jobs.delete(safeId(videoId)); }
    this.emit('update', { videoId, removed: true });
  }

  summary(job) {
    const m = job.meta;
    return {
      videoId: m.videoId, title: m.title, channel: m.channel, url: m.url, site: m.site || 'youtube', source: m.source || 'translate',
      state: job.state, error: job.error, translateProgress: m.translation ? 1 : job.translateProgress, tts: this.counts(job),
      cues: m.cues.length, voiceKey: job.voiceKey, model: m.translation && m.translation.model,
    };
  }

  emitUpdate(job) { this.emit('update', this.summary(job)); }

  activeJobs() {
    return [...this.jobs.values()].sort((a, b) => b.touchedAt - a.touchedAt).map((job) => this.summary(job));
  }

  // Thư viện: các video đã lưu
  library() {
    const out = [];
    for (const name of fs.readdirSync(this.dir)) {
      const meta = this.readMeta(name);
      if (!meta) continue;
      out.push({
        videoId: meta.videoId, title: meta.title, channel: meta.channel, cues: meta.cues.length, url: meta.url, site: meta.site || 'youtube',
        source: meta.source || 'translate', translated: !!meta.translation, voices: Object.keys(meta.audio || {}).map((k) => k.split('@')[0]),
        updatedAt: meta.updatedAt, size: dirSize(this.videoDir(name)),
      });
    }
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  totalSize() { return dirSize(this.dir); }

  remove(videoId) {
    this.jobs.delete(safeId(videoId));
    fs.rmSync(this.videoDir(videoId), { recursive: true, force: true });
  }

  clearAll() {
    this.jobs.clear();
    for (const name of fs.readdirSync(this.dir)) fs.rmSync(path.join(this.dir, name), { recursive: true, force: true });
  }
}

function dirSize(p) {
  let n = 0;
  try {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      n += e.isDirectory() ? dirSize(f) : fs.statSync(f).size;
    }
  } catch { /* ignore */ }
  return n;
}

module.exports = { JobManager, friendlyError };
