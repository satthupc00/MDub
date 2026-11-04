'use strict';
// Dịch phụ đề Anh → Việt bằng Claude API, theo ngữ cảnh, rút gọn cho vừa thời lượng.

const Anthropic = require('@anthropic-ai/sdk');
const { slotOf } = require('./captions');

const MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 — chất lượng cao nhất (mặc định)' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 — nhanh, rẻ hơn' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5 — nhanh nhất, rẻ nhất' },
];
const DEFAULT_MODEL = 'claude-opus-5-5';
// Model có hỗ trợ tự chuyển sang model dự phòng khi bị từ chối
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, vi: { type: 'string' } },
        required: ['id', 'vi'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

function systemPrompt({ glossary, shorten }) {
  const terms = glossary && glossary.length ? glossary.join(', ') : '';
  return [
    'Bạn là biên dịch viên thuyết minh video (lồng tiếng đọc đè) từ tiếng Anh sang tiếng Việt.',
    'Bản dịch sẽ được máy đọc thành tiếng, phát cùng lúc với video, nên phải nghe tự nhiên như người Việt nói.',
    'Quy tắc:',
    '- Dịch theo ngữ cảnh của cả đoạn, không dịch word-by-word. Phụ đề tự động có thể thiếu dấu câu hoặc nghe nhầm: hãy hiểu đúng ý người nói.',
    terms
      ? `- Giữ nguyên tiếng Anh các thuật ngữ chuyên ngành sau, không dịch: ${terms}. Các thuật ngữ kỹ thuật tương tự (tên phần mềm, tên công cụ, tên nút trong phần mềm) cũng giữ nguyên.`
      : '- Giữ nguyên tiếng Anh tên phần mềm, tên công cụ và thuật ngữ chuyên ngành phổ biến.',
    shorten
      ? '- Mỗi câu có giới hạn "max_syllables" (số tiếng tiếng Việt tối đa để đọc kịp). Rút gọn, bỏ từ đệm, bỏ ý lặp để không vượt giới hạn, nhưng giữ đủ ý chính.'
      : '- Dịch đầy đủ ý, câu gọn gàng.',
    '- Viết như văn nói, xưng hô tự nhiên (mình/các bạn). Không thêm chú thích, không ngoặc giải thích, không ký hiệu lạ.',
    '- Mỗi "id" đầu vào phải có đúng một bản dịch cùng "id". Nếu câu chỉ là tiếng ồn hoặc từ đệm vô nghĩa, trả "vi" là chuỗi rỗng.',
  ].join('\n');
}

class Translator {
  constructor({ getApiKey, getSettings, log }) {
    this.getApiKey = getApiKey;
    this.getSettings = getSettings;
    this.log = log || (() => {});
  }

  client() {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error('Chưa nhập API key Claude (vào Cài đặt).');
    return new Anthropic({ apiKey, maxRetries: 3 });
  }

  async testKey() {
    const r = await this.client().messages.create({
      model: 'claude-haiku-5-5', max_tokens: 16, messages: [{ role: 'user', content: 'Trả lời: OK' }],
    });
    return r.stop_reason !== 'refusal';
  }

  async translateBatch(client, model, sys, payload) {
    const params = {
      model,
      max_tokens: 16000,
      system: sys,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    };
    let res;
    if (FALLBACK_MODELS.has(model)) {
      res = await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    } else {
      res = await client.messages.create(params);
    }
    if (res.stop_reason === 'refusal') throw new Error('Claude từ chối dịch đoạn này.');
    if (res.stop_reason === 'max_tokens') { const e = new Error('Quá dài'); e.tooLong = true; throw e; }
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const json = JSON.parse(text);
    return { items: json.items || [], usage: res.usage };
  }

  // cues: [{i,start,end,en}] → mảng chuỗi tiếng Việt cùng độ dài
  async translate(cues, { title, onProgress } = {}) {
    const s = this.getSettings();
    const model = s.model || DEFAULT_MODEL;
    const sps = s.syllablesPerSecond || 4.6;
    const sys = systemPrompt({ glossary: s.glossary, shorten: s.shorten !== false });
    const client = this.client();
    const out = new Array(cues.length).fill(null);
    const BATCH = 60, CONTEXT = 4;
    const batches = [];
    for (let k = 0; k < cues.length; k += BATCH) batches.push([k, Math.min(cues.length, k + BATCH)]);
    let done = 0;
    const usage = { input: 0, output: 0 };

    const runRange = async (a, b) => {
      const payload = {
        video_title: title || '',
        context_before: cues.slice(Math.max(0, a - CONTEXT), a).map((c) => c.en),
        lines: cues.slice(a, b).map((c) => ({
          id: c.i, en: c.en, seconds: +slotOf(cues, c.i).toFixed(1),
          max_syllables: Math.max(3, Math.floor(slotOf(cues, c.i) * sps)),
        })),
        context_after: cues.slice(b, b + CONTEXT).map((c) => c.en),
      };
      try {
        const { items, usage: u } = await this.translateBatch(client, model, sys, payload);
        usage.input += u.input_tokens || 0; usage.output += u.output_tokens || 0;
        for (const it of items) if (it.id >= a && it.id < b) out[it.id] = String(it.vi || '').trim();
      } catch (e) {
        if ((e.tooLong || e instanceof SyntaxError) && b - a > 8) {
          const mid = a + Math.floor((b - a) / 2);
          await runRange(a, mid); await runRange(mid, b); return;
        }
        throw e;
      }
      // câu nào bị sót thì dịch lại riêng
      const missing = [];
      for (let k = a; k < b; k++) if (out[k] === null) missing.push(k);
      if (missing.length && missing.length < b - a && b - a > 1) {
        for (const k of missing) await runRange(k, k + 1);
      } else if (missing.length) {
        for (const k of missing) out[k] = '';
      }
    };

    // chạy song song tối đa 3 lô
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const [a, b] = batches[next++];
        await runRange(a, b);
        done += b - a;
        onProgress && onProgress(done / cues.length);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    this.log(`Dịch xong ${cues.length} câu bằng ${model} (${usage.input} in / ${usage.output} out tokens)`);
    return { vi: out.map((v) => v || ''), model, usage };
  }
}

module.exports = { Translator, MODELS, DEFAULT_MODEL, systemPrompt };
