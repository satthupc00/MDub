// Chạy trong trang YouTube (MAIN world): đọc danh sách phụ đề của player và tải phụ đề json3.
(() => {
  if (window.__mdubHook) return;
  window.__mdubHook = true;
  const captured = [];
  const note = (u) => {
    try {
      const url = new URL(String(u), location.href);
      if (!url.pathname.includes('/api/timedtext')) return;
      captured.push({ u: url.href, t: Date.now() });
      if (captured.length > 30) captured.shift();
    } catch { /* ignore */ }
  };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { note(u); return origOpen.apply(this, arguments); };
  const origFetch = window.fetch;
  window.fetch = function (i, init) { try { note(typeof i === 'string' ? i : i && i.url); } catch { /* ignore */ } return origFetch.apply(this, arguments); };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const player = () => document.getElementById('movie_player');
  function playerResponse() {
    const p = player();
    try { const r = p && p.getPlayerResponse && p.getPlayerResponse(); if (r && r.videoDetails) return r; } catch { /* ignore */ }
    return window.ytInitialPlayerResponse || null;
  }

  async function fetchJson3(u) {
    const url = new URL(u, location.href);
    url.searchParams.set('fmt', 'json3');
    url.searchParams.delete('tlang');
    const r = await origFetch.call(window, url.href, { credentials: 'include' });
    const t = await r.text();
    if (!t) return null;
    try { const j = JSON.parse(t); return j && j.events ? j : null; } catch { return null; }
  }

  const handlers = {
    info() {
      const r = playerResponse();
      const vd = (r && r.videoDetails) || {};
      const list = (r && r.captions && r.captions.playerCaptionsTracklistRenderer && r.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
      return {
        videoId: vd.videoId || null,
        title: vd.title || document.title.replace(/ - YouTube$/, ''),
        channel: vd.author || '',
        lengthSeconds: Number(vd.lengthSeconds) || 0,
        tracks: list.map((t) => ({
          baseUrl: t.baseUrl, lang: t.languageCode, kind: t.kind || '', vssId: t.vssId || '',
          name: (t.name && (t.name.simpleText || (t.name.runs || []).map((x) => x.text).join(''))) || '',
        })),
      };
    },
    async track({ baseUrl, lang, kind }) {
      // 1) tải trực tiếp
      let j = await fetchJson3(baseUrl).catch(() => null);
      if (j) return j;
      const match = (c) => { const sp = new URL(c.u).searchParams; return sp.get('lang') === lang && (!kind || (sp.get('kind') || '') === kind) && !sp.get('tlang'); };
      // 2) dùng link mà player đã tải (có mã xác thực)
      for (const c of [...captured].reverse()) if (match(c)) { j = await fetchJson3(c.u).catch(() => null); if (j) return j; }
      // 3) bật phụ đề tạm thời để player tự tải, rồi trả lại như cũ
      const p = player();
      if (!p || !p.setOption) return null;
      let prev = null;
      try { prev = p.getOption('captions', 'track'); } catch { /* ignore */ }
      const since = Date.now();
      try { p.loadModule && p.loadModule('captions'); p.setOption('captions', 'track', { languageCode: lang, kind: kind || undefined }); } catch { /* ignore */ }
      for (let k = 0; k < 50 && !j; k++) {
        await sleep(150);
        for (const c of [...captured].reverse()) {
          if (c.t >= since - 300 && match(c)) { j = await fetchJson3(c.u).catch(() => null); if (j) break; }
        }
      }
      try {
        if (prev && prev.languageCode) p.setOption('captions', 'track', prev);
        else { p.setOption('captions', 'track', {}); p.unloadModule && p.unloadModule('captions'); }
      } catch { /* ignore */ }
      return j;
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
