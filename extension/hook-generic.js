// Chạy trong trang web người dùng đã bật MDub (MAIN world):
// bắt các file phụ đề (WebVTT, SRT, TTML) mà trình phát tải về, và đọc phụ đề <track> của thẻ video.
(() => {
  if (window.__mdubHookWeb) return;
  window.__mdubHookWeb = true;
  const found = new Map(); // id -> {id,url,lang,name,format,data}
  let seq = 0;

  const LANG_RE = /(?:^|[\/_.\-=?&])(en|eng|english|en-us|en-gb|vi|vie|vietnamese|vi-vn|tieng-viet)(?=$|[\/_.\-&?])/i;
  function guessLang(...hints) {
    for (const h of hints) {
      if (!h) continue;
      const m = String(h).match(LANG_RE);
      if (m) return /^(vi|vie|vietnamese|vi-vn|tieng-viet)$/i.test(m[1]) ? 'vi' : 'en';
      if (/^vi/i.test(h)) return 'vi';
      if (/^en/i.test(h)) return 'en';
      if (/việt|vietnam/i.test(h)) return 'vi';
      if (/english|tiếng anh/i.test(h)) return 'en';
    }
    return '';
  }

  function detectFormat(url, type, text) {
    const s = String(text || '').trimStart().slice(0, 400);
    if (/^WEBVTT/.test(s)) return 'vtt';
    if (/^<\?xml|^<tt[\s>]/i.test(s) && /<p\b/i.test(text)) return 'ttml';
    if (/^\d+\s*\r?\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(s)) return 'srt';
    if (/text\/vtt/i.test(type) || /\.vtt(\?|$)/i.test(url)) return /-->/.test(s) ? 'vtt' : null;
    if (/\.srt(\?|$)/i.test(url) && /-->/.test(s)) return 'srt';
    return null;
  }

  function looksLikeSub(url, type) {
    return /\.(vtt|srt|ttml|dfxp)(\?|$)/i.test(url) || /text\/vtt|ttml|x-subrip/i.test(type || '') || /subtit|caption|timedtext|\/subs?\//i.test(url);
  }

  function store(url, type, text, extra = {}) {
    const format = detectFormat(url, type, text);
    if (!format) return;
    // bỏ mảnh phụ đề quá ngắn (HLS chia nhỏ) — cần cả file
    const cues = (String(text).match(/-->|<p\b/gi) || []).length;
    if (cues < 3) return;
    for (const v of found.values()) if (v.url === url) return;
    const id = 'w' + ++seq;
    let name = extra.name || '';
    try { if (!name) name = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop()); } catch { /* ignore */ }
    found.set(id, { id, url, format, data: text, lang: extra.lang || guessLang(url, name), name, kind: 'file', cues });
  }

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const res = await origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      const type = res.headers.get('content-type') || '';
      if (url && looksLikeSub(url, type)) res.clone().text().then((t) => store(url, type, t)).catch(() => {});
    } catch { /* ignore */ }
    return res;
  };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) {
    try {
      const url = String(u);
      this.addEventListener('load', () => {
        try {
          const type = this.getResponseHeader('content-type') || '';
          if (!looksLikeSub(url, type)) return;
          if (this.responseType === '' || this.responseType === 'text') store(url, type, this.responseText);
        } catch { /* ignore */ }
      });
    } catch { /* ignore */ }
    return origOpen.apply(this, arguments);
  };

  // Phụ đề gắn sẵn trong thẻ <track> hoặc đã nạp vào video.textTracks
  async function scanTracks() {
    for (const v of document.querySelectorAll('video')) {
      for (const el of v.querySelectorAll('track[src]')) {
        const url = new URL(el.getAttribute('src'), location.href).href;
        if ([...found.values()].some((x) => x.url === url)) continue;
        try { const r = await origFetch.call(window, url); store(url, r.headers.get('content-type') || 'text/vtt', await r.text(), { lang: guessLang(el.srclang, el.label), name: el.label }); } catch { /* ignore */ }
      }
      const tts = v.textTracks || [];
      for (let k = 0; k < tts.length; k++) {
        const tt = tts[k];
        if (!/subtitles|captions/.test(tt.kind)) continue;
        if (tt.mode === 'disabled') { try { tt.mode = 'hidden'; } catch { /* ignore */ } }
        const cues = tt.cues ? [...tt.cues] : [];
        if (cues.length < 3) continue;
        const key = `texttrack:${k}:${tt.label}:${tt.language}`;
        const vtt = 'WEBVTT\n\n' + cues.map((c) => `${fmt(c.startTime)} --> ${fmt(c.endTime)}\n${c.text}`).join('\n\n');
        const old = [...found.values()].find((x) => x.url === key);
        if (old) { if (cues.length > old.cues) { old.data = vtt; old.cues = cues.length; } continue; }
        found.set('w' + ++seq, { id: 'w' + seq, url: key, format: 'vtt', data: vtt, lang: guessLang(tt.language, tt.label), name: tt.label || tt.language || 'Phụ đề', kind: 'track', cues: cues.length });
      }
    }
  }
  const fmt = (t) => {
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = (t % 60).toFixed(3).padStart(6, '0');
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s}`;
  };

  const handlers = {
    async info() {
      await scanTracks();
      return {
        videoId: null,
        title: document.title,
        channel: location.hostname.replace(/^www\./, ''),
        tracks: [...found.values()].map(({ data, url, ...t }) => t),
      };
    },
    track({ id }) {
      const t = found.get(id);
      return t ? { format: t.format, data: t.data } : null;
    },
  };

  window.addEventListener('message', async (e) => {
    if (e.source !== window || !e.data || e.data.__mdub !== 'req') return;
    const { id, cmd, arg } = e.data;
    let res = null, err = null;
    try { res = await handlers[cmd](arg); } catch (x) { err = String((x && x.message) || x); }
    window.postMessage({ __mdub: 'res', id, res, err }, '*');
  });
})();
