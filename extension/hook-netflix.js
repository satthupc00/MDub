// Chạy trong trang Netflix (MAIN world): ghi lại danh sách phụ đề từ manifest của trình phát.
// Bắt manifest ở nhiều chỗ (JSON.parse, Response.json) và tìm "timedtexttracks" ở mọi độ sâu,
// vì Netflix hay đổi cấu trúc dữ liệu.
(() => {
  if (window.__mdubHookNf) return;
  window.__mdubHookNf = true;
  const WANT = ['webvtt-lssdh-ios8', 'dfxp-ls-sdh', 'simplesdh', 'imsc1.1'];
  const movies = new Map(); // movieId -> tracks
  let lastId = null;
  const diag = { hook: true, parseObjects: 0, ttFound: 0, injected: 0, profilesSeen: [], ttKeys: [], movieIds: [], dlProfiles: [], errors: [], via: [] };
  const note = (arr, v, max = 12) => { if (v && !arr.includes(v)) { arr.push(v); if (arr.length > max) arr.shift(); } };

  // Xin thêm định dạng phụ đề dễ đọc khi trình phát hỏi manifest
  function inject(v, depth = 0) {
    if (!v || typeof v !== 'object' || depth > 4) return;
    if (Array.isArray(v.profiles) && v.profiles.some((p) => typeof p === 'string' && /h264|vp9|av1|heaac|ddplus|xheaac|webvtt|dfxp|imsc/i.test(p))) {
      for (const p of WANT) if (!v.profiles.includes(p)) { v.profiles.push(p); diag.injected++; }
      v.profiles.forEach((p) => /webvtt|dfxp|sdh|imsc|cmisc|ttml/i.test(p) && note(diag.profilesSeen, p));
    }
    for (const k of Object.keys(v)) if (v[k] && typeof v[k] === 'object') inject(v[k], depth + 1);
  }
  const origStringify = JSON.stringify;
  JSON.stringify = function (value) {
    try { inject(value); } catch { /* ignore */ }
    return origStringify.apply(this, arguments);
  };

  function pickUrl(dl) {
    if (!dl) return null;
    if (typeof dl === 'string') return dl;
    if (dl.downloadUrls) { const v = Object.values(dl.downloadUrls); if (v.length) return typeof v[0] === 'string' ? v[0] : v[0].url; }
    if (Array.isArray(dl.urls) && dl.urls.length) return dl.urls[0].url || dl.urls[0];
    if (dl.url) return dl.url;
    return null;
  }
  function formatOf(profile) {
    if (/webvtt/i.test(profile)) return 'vtt';
    if (/dfxp|simplesdh|imsc|ttml|sdh/i.test(profile)) return 'ttml';
    return null; // nflx-cmisc = phụ đề dạng ảnh, bỏ qua
  }
  const RANK = (p) => (/webvtt/i.test(p) ? 0 : /dfxp/i.test(p) ? 1 : /simplesdh/i.test(p) ? 2 : /imsc/i.test(p) ? 3 : 9);

  function captureList(list, holder) {
    diag.ttFound++;
    note(diag.ttKeys, Object.keys(holder || {}).slice(0, 15).join(','));
    const raw = holder && (holder.movieId ?? holder.viewableId ?? holder.videoId ?? (holder.video_tracks && holder.video_tracks[0] && holder.video_tracks[0].movieId));
    const id = raw != null ? String(raw) : (currentId() || 'unknown');
    note(diag.movieIds, id);
    const tracks = [];
    list.forEach((t, k) => {
      if (!t || t.isNoneTrack) return;
      const dl = t.ttDownloadables || t.downloadables || {};
      const profs = Object.keys(dl).sort((a, b) => RANK(a) - RANK(b));
      profs.forEach((p) => note(diag.dlProfiles, p));
      let url = null, format = null;
      for (const p of profs) {
        const f = formatOf(p);
        if (!f) continue;
        url = pickUrl(dl[p]);
        if (url) { format = f; break; }
      }
      if (!url) return;
      tracks.push({
        id: `${id}:${k}`, url, format, lang: String(t.language || t.bcp47 || '').toLowerCase(),
        name: t.languageDescription || t.language || '', forced: !!t.isForcedNarrative,
        kind: t.rawTrackType === 'closedcaptions' ? 'cc' : 'sub',
      });
    });
    if (tracks.length) { movies.set(id, tracks); lastId = id; }
  }

  function scan(o, depth = 0, seen = new Set()) {
    if (!o || typeof o !== 'object' || depth > 6 || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o.timedtexttracks)) { captureList(o.timedtexttracks, o); return; }
    if (Array.isArray(o)) { for (const x of o.slice(0, 50)) scan(x, depth + 1, seen); return; }
    for (const k of Object.keys(o).slice(0, 80)) {
      const v = o[k];
      if (v && typeof v === 'object') scan(v, depth + 1, seen);
    }
  }
  function inspect(r, via) {
    try {
      if (!r || typeof r !== 'object') return;
      diag.parseObjects++;
      const before = diag.ttFound;
      scan(r);
      if (diag.ttFound > before) note(diag.via, via);
    } catch (e) { note(diag.errors, String(e && e.message)); }
  }

  const origParse = JSON.parse;
  JSON.parse = function () {
    const r = origParse.apply(this, arguments);
    inspect(r, 'JSON.parse');
    return r;
  };
  const origJson = Response.prototype.json;
  Response.prototype.json = function () {
    return origJson.apply(this, arguments).then((r) => { inspect(r, 'Response.json'); return r; });
  };

  const currentId = () => ((location.pathname.match(/\/watch\/(\d+)/) || [])[1] || null);
  function title() {
    const el = document.querySelector('[data-uia="video-title"]');
    if (el) return el.innerText.replace(/\s+/g, ' ').trim();
    const t = document.title.replace(/\s*[-|]\s*Netflix\s*$/i, '').trim();
    return t && t.toLowerCase() !== 'netflix' ? t : '';
  }
  function tracksFor(id) {
    if (id && movies.has(id)) return movies.get(id);
    // mã trong manifest có thể khác mã trên địa chỉ trang → dùng manifest mới nhất
    if (lastId && movies.has(lastId)) return movies.get(lastId);
    return [];
  }

  const handlers = {
    info() {
      const id = currentId();
      return { videoId: id, title: title() || (id ? `Netflix ${id}` : ''), channel: 'Netflix', tracks: tracksFor(id).map(({ url, ...t }) => t) };
    },
    async track({ id }) {
      for (const list of movies.values()) {
        const t = list.find((x) => x.id === id);
        if (!t) continue;
        let r;
        try { r = await fetch(t.url, { credentials: 'omit' }); } catch { r = null; }
        if (!r || !r.ok) {
          // thử lại bằng XHR giống trình phát
          const text = await new Promise((resolve) => {
            const x = new XMLHttpRequest();
            x.open('GET', t.url); x.onload = () => resolve(x.status < 400 ? x.responseText : null); x.onerror = () => resolve(null); x.send();
          });
          if (!text) { note(diag.errors, 'download failed ' + (r ? r.status : 'network')); return null; }
          return { format: t.format, data: text };
        }
        return { format: t.format, data: await r.text() };
      }
      return null;
    },
    diag() {
      return { ...diag, url: location.pathname, currentId: currentId(), captured: [...movies.keys()], tracks: tracksFor(currentId()).map((t) => `${t.lang}/${t.format}${t.forced ? '/forced' : ''}`), ua: navigator.userAgent.slice(-40) };
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
