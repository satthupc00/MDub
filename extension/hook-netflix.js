// Chạy trong trang Netflix (MAIN world): ghi lại danh sách phụ đề từ manifest của trình phát.
(() => {
  if (window.__mdubHookNf) return;
  window.__mdubHookNf = true;
  const PROFILES = ['webvtt-lssdh-ios8', 'dfxp-ls-sdh', 'simplesdh'];
  const movies = new Map(); // movieId -> tracks

  // Xin thêm định dạng phụ đề dễ đọc (WebVTT/DFXP) khi trình phát hỏi manifest
  const origStringify = JSON.stringify;
  JSON.stringify = function (value) {
    try {
      const prof = value && value.params && value.params.profiles;
      if (Array.isArray(prof)) for (const p of PROFILES) if (!prof.includes(p)) prof.push(p);
    } catch { /* ignore */ }
    return origStringify.apply(this, arguments);
  };

  function pickUrl(dl) {
    if (!dl) return null;
    if (dl.downloadUrls) { const v = Object.values(dl.downloadUrls); if (v.length) return v[0]; }
    if (Array.isArray(dl.urls) && dl.urls.length) return dl.urls[0].url || dl.urls[0];
    return null;
  }

  function capture(res) {
    if (!res || !Array.isArray(res.timedtexttracks)) return;
    const id = String(res.movieId || res.viewableId || '');
    if (!id) return;
    const tracks = [];
    res.timedtexttracks.forEach((t, k) => {
      if (!t || t.isNoneTrack) return;
      const dl = t.ttDownloadables || {};
      let url = null, format = null;
      for (const [prof, fmt] of [['webvtt-lssdh-ios8', 'vtt'], ['dfxp-ls-sdh', 'ttml'], ['simplesdh', 'ttml']]) {
        url = pickUrl(dl[prof]);
        if (url) { format = fmt; break; }
      }
      if (!url) return;
      tracks.push({
        id: `${id}:${k}`, url, format, lang: String(t.language || '').toLowerCase(),
        name: t.languageDescription || t.language || '', forced: !!t.isForcedNarrative,
        kind: t.rawTrackType === 'closedcaptions' ? 'cc' : 'sub',
      });
    });
    if (tracks.length) movies.set(id, tracks);
  }

  const origParse = JSON.parse;
  JSON.parse = function () {
    const r = origParse.apply(this, arguments);
    try {
      if (r && typeof r === 'object') {
        if (r.result) capture(r.result);
        else capture(r);
      }
    } catch { /* ignore */ }
    return r;
  };

  const currentId = () => ((location.pathname.match(/\/watch\/(\d+)/) || [])[1] || null);
  function title() {
    const el = document.querySelector('[data-uia="video-title"]');
    if (el) return el.innerText.replace(/\s+/g, ' ').trim();
    const t = document.title.replace(/\s*[-|]\s*Netflix\s*$/i, '').trim();
    return t && t.toLowerCase() !== 'netflix' ? t : '';
  }

  const handlers = {
    info() {
      const id = currentId();
      const tracks = (id && movies.get(id)) || [];
      return { videoId: id, title: title() || (id ? `Netflix ${id}` : ''), channel: 'Netflix', tracks: tracks.map(({ url, ...t }) => t) };
    },
    async track({ id }) {
      for (const list of movies.values()) {
        const t = list.find((x) => x.id === id);
        if (!t) continue;
        const r = await fetch(t.url, { credentials: 'omit' });
        if (!r.ok) return null;
        return { format: t.format, data: await r.text() };
      }
      return null;
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
