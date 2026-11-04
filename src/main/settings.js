'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DEFAULT_VOICE } = require('./tts/voices');
const { DEFAULT_MODEL } = require('./translate');

const DEFAULTS = {
  model: DEFAULT_MODEL,
  glossary: ['mesh', 'bone', 'rig', 'weight', 'keyframe', 'skin', 'slot', 'IK', 'timeline', 'constraint', 'shader', 'render', 'texture', 'UV', 'vertex'],
  shorten: true,
  syllablesPerSecond: 4.6,
  voice: DEFAULT_VOICE,
  speed: 1.0,
  maxSpeed: 1.35,
  duckLevel: 0.2,
  ttsVolume: 1.0,
  fadeMs: 300,
  showSubs: true,
  enabled: true,
  autoStart: true,
  useGpu: true,
  apiKeyEnc: '',
  token: '',
  bounds: null,
};

// Các khoá extension được phép đổi
const EXT_KEYS = ['voice', 'duckLevel', 'ttsVolume', 'showSubs', 'enabled', 'fadeMs'];

class Settings {
  constructor(dir, safeStorage) {
    this.file = path.join(dir, 'settings.json');
    this.safe = safeStorage;
    this.listeners = [];
    try { this.data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch { this.data = { ...DEFAULTS }; }
    if (!this.data.token) { this.data.token = crypto.randomBytes(24).toString('hex'); this.save(); }
  }

  get() { return this.data; }

  // Bản an toàn để gửi cho giao diện/extension (không có key)
  public() {
    const { apiKeyEnc, token, bounds, ...rest } = this.data;
    return { ...rest, hasApiKey: !!apiKeyEnc };
  }

  set(patch, { fromExtension = false } = {}) {
    const p = { ...patch };
    delete p.apiKeyEnc; delete p.token;
    if (fromExtension) for (const k of Object.keys(p)) if (!EXT_KEYS.includes(k)) delete p[k];
    Object.assign(this.data, p);
    this.save();
    this.listeners.forEach((fn) => fn(this.public(), p));
    return this.public();
  }

  onChange(fn) { this.listeners.push(fn); }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  setApiKey(key) {
    key = String(key || '').trim();
    if (!key) this.data.apiKeyEnc = '';
    else if (this.safe && this.safe.isEncryptionAvailable()) this.data.apiKeyEnc = 'enc:' + this.safe.encryptString(key).toString('base64');
    else this.data.apiKeyEnc = 'raw:' + Buffer.from(key).toString('base64');
    this.save();
    this.listeners.forEach((fn) => fn(this.public(), { hasApiKey: !!key }));
  }

  getApiKey() {
    const v = this.data.apiKeyEnc || '';
    try {
      if (v.startsWith('enc:')) return this.safe.decryptString(Buffer.from(v.slice(4), 'base64'));
      if (v.startsWith('raw:')) return Buffer.from(v.slice(4), 'base64').toString('utf8');
    } catch { return ''; }
    return process.env.ANTHROPIC_API_KEY || '';
  }
}

module.exports = { Settings, DEFAULTS };
