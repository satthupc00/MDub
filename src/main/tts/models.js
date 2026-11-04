'use strict';
// Tải model Kokoro-Vietnamese (ONNX) + 14 giọng đọc từ Hugging Face về máy, một lần duy nhất.

const fs = require('fs');
const path = require('path');
const { VOICE_IDS } = require('./voices');

// Ưu tiên bản web nhẹ (int8, ~83 MB), dự phòng repo gốc.
const SOURCES = ['relingo/kokoro-vi-web', 'contextboxai/Kokoro-Vietnamese'];
const HF = 'https://huggingface.co';
const VOICE_EXT_ORDER = ['.bin', '.npy', '.f32', '.pt', '.json'];

function scoreOnnx(name) {
  const n = name.toLowerCase();
  let s = 0;
  if (/int8|q8|quant|uint8/.test(n)) s += 10;
  if (/fp16|f16/.test(n)) s += 5;
  if (/kokoro/.test(n)) s += 2;
  if (/vi/.test(n)) s += 1;
  return s;
}

async function listFiles(fetchFn, repo) {
  const res = await fetchFn(`${HF}/api/models/${repo}`);
  if (!res.ok) throw new Error(`Không đọc được danh sách file của ${repo} (${res.status})`);
  const json = await res.json();
  return (json.siblings || []).map((s) => s.rfilename);
}

// Tìm file model + file giọng trên các repo.
async function resolvePlan(fetchFn) {
  const plan = { model: null, extra: [], voices: {} };
  const errors = [];
  for (const repo of SOURCES) {
    let files;
    try { files = await listFiles(fetchFn, repo); } catch (e) { errors.push(e.message); continue; }
    if (!plan.model) {
      const onnx = files.filter((f) => f.endsWith('.onnx')).sort((a, b) => scoreOnnx(b) - scoreOnnx(a));
      if (onnx.length) {
        plan.model = { repo, file: onnx[0] };
        plan.extra = files.filter((f) => f.startsWith(onnx[0] + '.data') || f.startsWith(onnx[0] + '_data'))
          .map((file) => ({ repo, file }));
      }
    }
    for (const id of VOICE_IDS) {
      if (plan.voices[id]) continue;
      const cands = files.filter((f) => {
        const ext = path.extname(f).toLowerCase();
        return VOICE_EXT_ORDER.includes(ext) && path.basename(f, path.extname(f)) === id;
      }).sort((a, b) => VOICE_EXT_ORDER.indexOf(path.extname(a)) - VOICE_EXT_ORDER.indexOf(path.extname(b)));
      if (cands.length) plan.voices[id] = { repo, file: cands[0] };
    }
  }
  if (!plan.model) throw new Error('Không tìm thấy model Kokoro trên Hugging Face. ' + errors.join(' · '));
  return plan;
}

async function download(fetchFn, { repo, file }, dest, onBytes) {
  const url = `${HF}/${repo}/resolve/main/${file.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetchFn(url);
  if (!res.ok || !res.body) throw new Error(`Tải ${file} lỗi (${res.status})`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
      onBytes(value.byteLength);
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  fs.renameSync(tmp, dest);
}

class ModelStore {
  constructor(dir) {
    this.dir = dir;
    this.manifestPath = path.join(dir, 'manifest.json');
  }

  manifest() {
    try { return JSON.parse(fs.readFileSync(this.manifestPath, 'utf8')); } catch { return null; }
  }

  isReady() {
    const m = this.manifest();
    return !!(m && m.model && fs.existsSync(path.join(this.dir, m.model)) && Object.keys(m.voices || {}).length);
  }

  modelPath() { const m = this.manifest(); return m ? path.join(this.dir, m.model) : null; }

  voicePath(id) {
    const m = this.manifest();
    return m && m.voices && m.voices[id] ? path.join(this.dir, m.voices[id]) : null;
  }

  availableVoices() { const m = this.manifest(); return m ? Object.keys(m.voices || {}) : []; }

  // Tải toàn bộ. onProgress({done,total,file})
  async downloadAll(fetchFn, onProgress) {
    const plan = await resolvePlan(fetchFn);
    const jobs = [];
    const modelName = path.basename(plan.model.file);
    jobs.push({ src: plan.model, dest: modelName });
    for (const ex of plan.extra) jobs.push({ src: ex, dest: path.basename(ex.file) });
    const voices = {};
    for (const [id, src] of Object.entries(plan.voices)) {
      const name = `voices/${id}${path.extname(src.file).toLowerCase()}`;
      voices[id] = name;
      jobs.push({ src, dest: name });
    }
    // ước lượng tổng dung lượng bằng HEAD
    let total = 0;
    for (const j of jobs) {
      try {
        const url = `${HF}/${j.src.repo}/resolve/main/${j.src.file}`;
        const r = await fetchFn(url, { method: 'HEAD' });
        j.size = Number(r.headers.get('x-linked-size') || r.headers.get('content-length') || 0);
      } catch { j.size = 0; }
      total += j.size;
    }
    let done = 0;
    for (const j of jobs) {
      const dest = path.join(this.dir, j.dest);
      if (fs.existsSync(dest) && j.size && fs.statSync(dest).size === j.size) { done += j.size; continue; }
      await download(fetchFn, j.src, dest, (n) => { done += n; onProgress && onProgress({ done, total, file: j.dest }); });
    }
    const manifest = {
      model: modelName,
      source: plan.model,
      voices,
      voiceSources: plan.voices,
      downloadedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2));
    onProgress && onProgress({ done: total, total, file: '' });
    return manifest;
  }
}

module.exports = { ModelStore, resolvePlan, SOURCES };
