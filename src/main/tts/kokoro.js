'use strict';
// Chạy Kokoro-Vietnamese ONNX bằng onnxruntime-node (DirectML trên Windows, dự phòng CPU).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ort = require('onnxruntime-node');
const { VietnameseG2P } = require('../g2p/g2p');

const SAMPLE_RATE = 24000;
const VOCAB = JSON.parse(fs.readFileSync(path.join(__dirname, 'vocab.json'), 'utf8'));
const STYLE_DIM = 256;
const MAX_PHONEMES = 510;

// ---------- đọc file giọng (.bin / .npy / .pt / .json) ----------
function readNpy(buf) {
  const hlen = buf.readUInt16LE(8);
  const header = buf.slice(10, 10 + hlen).toString('latin1');
  if (!/'descr':\s*'<f4'/.test(header)) throw new Error('npy không phải float32');
  const off = 10 + hlen;
  return new Float32Array(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + buf.length));
}

// Đọc tensor float32 lưu bằng torch.save (file zip, tensor nằm ở <archive>/data/0)
function readTorchZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 70000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('File .pt không hợp lệ');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  let best = null;
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), comLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (/\/data\/\d+$/.test(name) && (!best || csize > best.csize)) best = { method, csize, local };
    p += 46 + nameLen + extraLen + comLen;
  }
  if (!best) throw new Error('Không thấy dữ liệu trong file .pt');
  const lnl = buf.readUInt16LE(best.local + 26), lel = buf.readUInt16LE(best.local + 28);
  const start = best.local + 30 + lnl + lel;
  let raw = buf.slice(start, start + best.csize);
  if (best.method === 8) raw = zlib.inflateRawSync(raw);
  const copy = Buffer.from(raw);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.length / 4);
}

function loadVoice(file) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  let data;
  if (ext === '.npy') data = readNpy(buf);
  else if (ext === '.pt') data = readTorchZip(buf);
  else if (ext === '.json') data = Float32Array.from(JSON.parse(buf.toString('utf8')).flat(Infinity));
  else {
    const copy = Buffer.from(buf);
    data = new Float32Array(copy.buffer, copy.byteOffset, copy.length / 4);
  }
  if (data.length % STYLE_DIM !== 0) throw new Error(`File giọng sai kích thước: ${path.basename(file)}`);
  return data; // [rows, 256]
}

function styleFor(voice, nPhonemes) {
  const rows = voice.length / STYLE_DIM;
  const idx = Math.max(0, Math.min(nPhonemes, rows) - 1);
  return voice.slice(idx * STYLE_DIM, (idx + 1) * STYLE_DIM);
}

// ---------- tách câu dài theo dấu câu để không vượt 510 ký hiệu ----------
function splitForTTS(text, g2p) {
  const parts = [];
  const pushPiece = (t) => {
    t = t.trim();
    if (!t) return;
    const ph = g2p.convert(t);
    if (!ph) return;
    if (ph.length <= MAX_PHONEMES) { parts.push(ph); return; }
    const sub = t.split(/(?<=[,;:])\s+/);
    if (sub.length > 1) { sub.forEach(pushPiece); return; }
    const words = t.split(/\s+/), half = Math.ceil(words.length / 2);
    if (words.length < 2) { parts.push(ph.slice(0, MAX_PHONEMES)); return; }
    pushPiece(words.slice(0, half).join(' '));
    pushPiece(words.slice(half).join(' '));
  };
  text.split(/(?<=[.!?…])\s+/).forEach(pushPiece);
  return parts;
}

function trimSilence(a, threshold = 0.004, padMs = 40) {
  let s = 0, e = a.length - 1;
  while (s < a.length && Math.abs(a[s]) < threshold) s++;
  while (e > s && Math.abs(a[e]) < threshold) e--;
  const pad = Math.round((SAMPLE_RATE * padMs) / 1000);
  return a.slice(Math.max(0, s - pad), Math.min(a.length, e + pad));
}

function concat(chunks, gapMs = 120) {
  const gap = Math.round((SAMPLE_RATE * gapMs) / 1000);
  const len = chunks.reduce((n, c) => n + c.length, 0) + gap * Math.max(0, chunks.length - 1);
  const out = new Float32Array(len);
  let o = 0;
  chunks.forEach((c, i) => { out.set(c, o); o += c.length + (i < chunks.length - 1 ? gap : 0); });
  return out;
}

function toWav(samples, volume = 1) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24); buf.writeUInt32LE(SAMPLE_RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const gain = peak > 0.98 ? 0.98 / peak : 1;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * gain * volume));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

class Kokoro {
  constructor({ modelPath, voicePathFor, useGpu = true }) {
    this.modelPath = modelPath;
    this.voicePathFor = voicePathFor;
    this.useGpu = useGpu;
    this.g2p = new VietnameseG2P();
    this.voices = new Map();
    this.session = null;
    this.provider = null;
    this.speedShape = null;
  }

  async init() {
    const tries = [];
    if (this.useGpu && process.platform === 'win32') tries.push(['dml', 'cpu']);
    tries.push(['cpu']);
    let lastErr;
    for (const eps of tries) {
      try {
        this.session = await ort.InferenceSession.create(this.modelPath, {
          executionProviders: eps,
          graphOptimizationLevel: 'all',
        });
        this.provider = eps[0];
        break;
      } catch (e) { lastErr = e; }
    }
    if (!this.session) throw lastErr;
    const names = this.session.inputNames;
    this.inIds = names.find((n) => /input|token|ids/i.test(n)) || names[0];
    this.inStyle = names.find((n) => /ref|style/i.test(n)) || names[1];
    this.inSpeed = names.find((n) => /speed/i.test(n)) || names[2];
    this.out = this.session.outputNames.find((n) => /wav|audio|output/i.test(n)) || this.session.outputNames[0];
    return { provider: this.provider };
  }

  voice(id) {
    if (!this.voices.has(id)) {
      const file = this.voicePathFor(id);
      if (!file) throw new Error(`Chưa có giọng ${id}`);
      this.voices.set(id, loadVoice(file));
    }
    return this.voices.get(id);
  }

  async runOnce(phonemes, voiceId, speed) {
    const ids = [0];
    for (const ch of phonemes) if (VOCAB[ch] !== undefined) ids.push(VOCAB[ch]);
    ids.push(0);
    const style = styleFor(this.voice(voiceId), ids.length - 2);
    const feeds = {
      [this.inIds]: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      [this.inStyle]: new ort.Tensor('float32', style, [1, STYLE_DIM]),
    };
    const shapes = this.speedShape ? [this.speedShape] : [[], [1]];
    let lastErr;
    for (const shape of shapes) {
      try {
        feeds[this.inSpeed] = new ort.Tensor('float32', new Float32Array([speed]), shape);
        const res = await this.session.run(feeds);
        this.speedShape = shape;
        return Float32Array.from(res[this.out].data);
      } catch (e) {
        lastErr = e;
        if (this.provider === 'dml' && !/speed|rank|shape|dimension/i.test(String(e))) {
          // DirectML không chạy được model này → chuyển sang CPU
          this.useGpu = false; this.session = null; await this.init();
          return this.runOnce(phonemes, voiceId, speed);
        }
      }
    }
    throw lastErr;
  }

  // Tạo audio cho 1 câu. Trả về Float32Array 24 kHz.
  async synth(text, voiceId, speed = 1) {
    const parts = splitForTTS(text, this.g2p);
    const chunks = [];
    for (const ph of parts) chunks.push(trimSilence(await this.runOnce(ph, voiceId, speed)));
    return concat(chunks);
  }
}

module.exports = { Kokoro, toWav, loadVoice, readTorchZip, splitForTTS, SAMPLE_RATE };
