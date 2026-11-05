'use strict';
// MDub trên YouTube, Netflix và các trang người dùng đã bật:
// nút VI, bảng điều khiển, phát giọng thuyết minh khớp thời gian video.
(() => {
  if (window.__mdubContent) return;
  window.__mdubContent = true;
  const HOST = location.hostname;
  const SITE = /(^|\.)youtube\.com$/.test(HOST) ? 'youtube' : /(^|\.)netflix\.com$/.test(HOST) ? 'netflix' : 'web';

  // ---------- tiện ích ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const send = (msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: 'extension_reloaded' });
        else resolve(r || { ok: false, error: 'no_reply' });
      });
    } catch { resolve({ ok: false, error: 'extension_reloaded' }); }
  });
  let reqId = 0;
  const hook = (cmd, arg) => new Promise((resolve) => {
    const id = ++reqId;
    const on = (e) => {
      if (e.source !== window || !e.data || e.data.__mdub !== 'res' || e.data.id !== id) return;
      window.removeEventListener('message', on);
      resolve(e.data.err ? null : e.data.res);
    };
    window.addEventListener('message', on);
    window.postMessage({ __mdub: 'req', id, cmd, arg }, '*');
    setTimeout(() => { window.removeEventListener('message', on); resolve(null); }, 15000);
  });
  function h(tag, attrs = {}, kids = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(kids)) if (c) el.append(c);
    return el;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function icon(paths, { fill = 'none', stroke = 'currentColor', w = 2 } = {}) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', fill); s.setAttribute('aria-hidden', 'true');
    if (stroke) { s.setAttribute('stroke', stroke); s.setAttribute('stroke-width', w); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); }
    for (const d of paths) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
    return s;
  }
  const ICON_SPEAKER = ['M11 5L6 9H2v6h4l5 4V5z', 'M15.5 8.5a5 5 0 0 1 0 7'];
  const ICON_REFRESH = ['M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16', 'M16 16h5v5'];
  const ICON_X = ['M18 6L6 18M6 6l12 12'];

  // ---------- trạng thái ----------
  const st = {
    connected: false, appStatus: null, settings: null,
    videoId: null, job: null, cues: [], error: null, info: '',
    buffers: new Map(), fetching: new Set(), playing: null, lastCursor: -1, pollT: null, session: 0,
  };

  // ---------- âm thanh ----------
  const audio = { ctx: null, ttsGain: null, videoGain: null, mode: null, video: null, baseVolume: null, ducked: false };
  function ensureCtx() {
    if (!audio.ctx) {
      audio.ctx = new AudioContext();
      audio.ttsGain = audio.ctx.createGain();
      audio.ttsGain.connect(audio.ctx.destination);
    }
    return audio.ctx;
  }
  const unlock = () => { const c = ensureCtx(); if (c.state !== 'running') c.resume().then(setupGraph).catch(() => {}); else setupGraph(); };
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);

  // Đưa tiếng video qua Web Audio để giảm âm mượt mà, không đụng vào thanh âm lượng YouTube.
  const graphs = new WeakMap();
  function setupGraph() {
    const v = getVideo();
    if (!v || !audio.ctx || audio.ctx.state !== 'running') return;
    if (audio.video === v && audio.mode) return;
    audio.video = v;
    // Netflix/trang khác: video thường có bảo vệ hoặc khác nguồn → chỉnh âm lượng trực tiếp
    if (SITE !== 'youtube') { audio.mode = 'volume'; return; }
    if (graphs.has(v)) { audio.videoGain = graphs.get(v); audio.mode = 'graph'; return; }
    try {
      const src = audio.ctx.createMediaElementSource(v);
      const g = audio.ctx.createGain();
      src.connect(g).connect(audio.ctx.destination);
      graphs.set(v, g);
      audio.videoGain = g; audio.mode = 'graph';
    } catch { audio.mode = 'volume'; }
  }
  function duck(on) {
    const s = st.settings || {};
    const level = s.duckLevel ?? 0.2;
    const fade = Math.max(0.01, (s.fadeMs ?? 300) / 1000);
    if (audio.mode === 'graph' && audio.videoGain) {
      const g = audio.videoGain.gain, now = audio.ctx.currentTime;
      g.cancelScheduledValues(now); g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(on ? level : 1, now + fade);
    } else {
      const v = getVideo(); if (!v) return;
      if (on && !audio.ducked) { audio.baseVolume = v.volume; fadeVolume(v, v.volume * level, fade); }
      else if (!on && audio.ducked && audio.baseVolume != null) fadeVolume(v, audio.baseVolume, fade);
    }
    audio.ducked = on;
  }
  let fadeT = null;
  function fadeVolume(v, to, sec) {
    clearInterval(fadeT);
    const from = v.volume, steps = Math.max(1, Math.round((sec * 1000) / 30));
    let k = 0;
    fadeT = setInterval(() => {
      k++;
      try { v.volume = Math.max(0, Math.min(1, from + ((to - from) * k) / steps)); } catch { /* ignore */ }
      if (k >= steps) clearInterval(fadeT);
    }, 30);
  }
  function stopPlaying() {
    if (ui.btn) delete ui.btn.dataset.playing;
    if (st.playing) { try { st.playing.src.onended = null; st.playing.src.stop(); } catch { /* ignore */ } st.playing = null; }
    if (audio.ducked) duck(false);
  }
  function play(i, offset) {
    const buf = st.buffers.get(i);
    if (!buf || !audio.ctx || audio.ctx.state !== 'running') return;
    stopPlaying();
    const v = getVideo();
    const src = audio.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = v ? v.playbackRate : 1;
    src.connect(audio.ttsGain);
    audio.ttsGain.gain.value = (st.settings && st.settings.ttsVolume) ?? 1;
    const p = { i, src };
    src.onended = () => { if (st.playing === p) { st.playing = null; duck(false); if (ui.btn) delete ui.btn.dataset.playing; } };
    st.playing = p;
    if (ui.btn) ui.btn.dataset.playing = String(i);
    src.start(0, Math.max(0, Math.min(offset, buf.duration - 0.05)));
    duck(true);
  }

  // ---------- giao diện ----------
  const ui = {};
  function largestVideo() {
    let best = null, area = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const a = r.width * r.height;
      if (a > area && r.width > 160 && r.height > 90) { best = v; area = a; }
    }
    return best;
  }
  const getVideo = () => (SITE === 'youtube'
    ? document.querySelector('#movie_player video.html5-main-video') || document.querySelector('video')
    : largestVideo());
  const getPlayer = () => document.getElementById('movie_player');

  // Mã của video đang xem (dùng làm khoá cache)
  function hashStr(t) { let x = 5381; for (let i = 0; i < t.length; i++) x = ((x << 5) + x + t.charCodeAt(i)) >>> 0; return x.toString(36); }
  function pageKey() {
    if (SITE === 'youtube') return location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null;
    if (SITE === 'netflix') return (location.pathname.match(/\/watch\/(\d+)/) || [])[1] || null;
    if (!getVideo()) return null;
    const q = new URLSearchParams(location.search);
    const extra = q.get('v') || q.get('id') || q.get('video') || q.get('episode') || '';
    return hashStr(HOST + location.pathname + extra);
  }


  // Trang không phải YouTube: lớp nổi phủ đúng vị trí video, chứa nút VI + phụ đề + bảng
  function buildLayer() {
    const v = getVideo();
    if (!v) return false;
    if (!ui.layer) {
      ui.layer = h('div', { class: 'mdub-layer' });
      ui.btn = h('button', { class: 'mdub-fab', title: 'MDub thuyết minh (Alt+M bật/tắt)', 'aria-label': 'MDub thuyết minh', onclick: (e) => { e.stopPropagation(); e.preventDefault(); togglePanel(); } },
        [icon(ICON_SPEAKER, { w: 2.4 }), document.createTextNode('VI'), h('i', { class: 'mdub-dot' })]);
      ui.sub = h('div', { class: 'mdub-sub' });
      ui.pill = h('div', { class: 'mdub-pill' }, [h('i'), h('span')]);
      ui.panel = buildPanel();
      ui.layer.append(ui.sub, ui.pill, ui.btn, ui.panel);
      for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick']) ui.layer.addEventListener(ev, (e) => { if (e.target !== ui.layer) e.stopPropagation(); });
    }
    const fs = document.fullscreenElement;
    const host = fs && fs !== v && fs.tagName !== 'VIDEO' ? fs : document.body || document.documentElement;
    if (ui.layer.parentNode !== host) host.append(ui.layer);
    renderAll();
    return true;
  }
  let lastMove = Date.now();
  for (const ev of ['mousemove', 'pointermove', 'pointerdown']) window.addEventListener(ev, () => { lastMove = Date.now(); }, true);
  function placeLayer() {
    if (!ui.layer) return;
    const v = getVideo();
    if (!v) { ui.layer.style.display = 'none'; return; }
    const r = v.getBoundingClientRect();
    if (r.width < 160 || r.height < 90) { ui.layer.style.display = 'none'; return; }
    const fs = document.fullscreenElement;
    const host = fs && fs !== v && fs.tagName !== 'VIDEO' ? fs : document.body || document.documentElement;
    if (ui.layer.parentNode !== host) host.append(ui.layer);
    Object.assign(ui.layer.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    const open = ui.panel && ui.panel.classList.contains('open');
    // nút luôn hiện (mờ khi không rê chuột) để không bị lạc mất
    ui.btn.classList.add('show');
    ui.btn.classList.toggle('idle', !(open || Date.now() - lastMove < 2500 || (ui.pill && ui.pill.classList.contains('show')) || st.noSubs || st.waitingSubs));
  }

  function buildUI() {
    if (SITE !== 'youtube') return buildLayer();
    const player = getPlayer();
    const controls = player && player.querySelector('.ytp-right-controls');
    if (!player || !controls) return false;
    if (!ui.btn || !controls.contains(ui.btn)) {
      ui.btn = h('button', { class: 'ytp-button mdub-btn', title: 'MDub thuyết minh (Alt+M bật/tắt)', 'aria-label': 'MDub thuyết minh', onclick: (e) => { e.stopPropagation(); togglePanel(); } },
        [h('span', {}, [icon(ICON_SPEAKER, { w: 2.4 }), document.createTextNode('VI'), h('i', { class: 'mdub-dot' })])]);
      controls.prepend(ui.btn);
    }
    if (!ui.sub || !player.contains(ui.sub)) { ui.sub = h('div', { class: 'mdub-sub' }); player.append(ui.sub); }
    if (!ui.pill || !player.contains(ui.pill)) { ui.pill = h('div', { class: 'mdub-pill' }, [h('i'), h('span')]); player.append(ui.pill); }
    if (!ui.panel || !player.contains(ui.panel)) { ui.panel = buildPanel(); player.append(ui.panel); }
    renderAll();
    return true;
  }

  function buildPanel() {
    const panel = h('div', { class: 'mdub-panel', role: 'dialog', 'aria-label': 'MDub', onclick: (e) => e.stopPropagation(), onkeydown: (e) => e.stopPropagation() });
    ui.enable = h('input', { type: 'checkbox', class: 'mdub-sw', title: 'Bật/tắt thuyết minh (Alt+M)', 'aria-label': 'Bật/tắt thuyết minh', onchange: () => setEnabled(ui.enable.checked) });
    ui.latest = h('span', { class: 'mdub-latest', text: 'latest' });
    ui.upd = h('button', { class: 'mdub-ib', title: 'Kiểm tra cập nhật', 'aria-label': 'Kiểm tra cập nhật', onclick: checkUpdate }, [icon(ICON_REFRESH)]);
    const head = h('div', { class: 'mdub-h' }, [
      h('img', { src: chrome.runtime.getURL('icons/48.png'), alt: '' }),
      h('span', { class: 'mdub-name' }, [h('b', { text: 'M' }), document.createTextNode('Dub')]),
      ui.latest, h('span', { class: 'mdub-sp' }), ui.upd, ui.enable,
      h('button', { class: 'mdub-ib', title: 'Đóng', 'aria-label': 'Đóng', onclick: () => togglePanel(false) }, [icon(ICON_X)]),
    ]);
    ui.stTitle = h('span'); ui.stRight = h('span');
    ui.stBar = h('div', { style: 'width:0%' });
    ui.stInfo = h('div', { class: 'mdub-small' });
    ui.stAction = h('div', { style: 'display:none;gap:6px' });
    const card = h('div', { class: 'mdub-card' }, [h('div', { class: 'mdub-row t' }, [ui.stTitle, ui.stRight]), h('div', { class: 'mdub-bar' }, [ui.stBar]), ui.stInfo, ui.stAction]);
    ui.srcVi = h('button', { class: 'mdub-seg', onclick: () => setSource('vi') }, [document.createTextNode('Phụ đề Việt có sẵn'), h('small', { class: 'mdub-ok', text: 'Miễn phí' })]);
    ui.srcEn = h('button', { class: 'mdub-seg', onclick: () => setSource('en') }, [document.createTextNode('Dịch từ tiếng Anh'), h('small', { text: 'Claude · tốn API' })]);
    ui.srcBox = h('div', { class: 'mdub-f', style: 'display:none' }, [
      h('span', { class: 'mdub-lab', text: 'Nguồn phụ đề' }),
      h('div', { class: 'mdub-segs' }, [ui.srcVi, ui.srcEn]),
      h('span', { class: 'mdub-small', text: 'Có phụ đề Việt thì mặc định đọc thẳng. Chỉ có tiếng Anh thì tự dịch.' }),
    ]);
    ui.voice = h('select', { class: 'mdub-sel', 'aria-label': 'Giọng đọc', onchange: () => saveSetting({ voice: ui.voice.value }) });
    const range = (key, min, max, step, label, fmt) => {
      const val = h('b');
      const r = h('input', { type: 'range', class: 'mdub-range', min, max, step, 'aria-label': label });
      const paint = () => { r.style.setProperty('--fill', ((r.value - min) / (max - min)) * 100 + '%'); val.textContent = fmt(r.value); };
      r.addEventListener('input', () => { paint(); if (st.settings) st.settings[key] = Number(r.value); if (key === 'ttsVolume' && audio.ttsGain) audio.ttsGain.gain.value = Number(r.value); });
      r.addEventListener('change', () => saveSetting({ [key]: Number(r.value) }));
      ui[key] = { r, paint };
      return h('div', { class: 'mdub-f' }, [h('div', { class: 'mdub-lab' }, [h('span', { text: label }), val]), r]);
    };
    ui.subs = h('input', { type: 'checkbox', class: 'mdub-sw', 'aria-label': 'Hiện phụ đề tiếng Việt', onchange: () => saveSetting({ showSubs: ui.subs.checked }) });
    const body = h('div', { class: 'mdub-b' }, [
      ui.srcBox,
      card,
      h('label', { class: 'mdub-f' }, [h('span', { class: 'mdub-lab', text: 'Giọng đọc' }), ui.voice]),
      range('duckLevel', 0, 1, 0.05, 'Âm lượng gốc khi đang đọc', (v) => Math.round(v * 100) + '%'),
      range('ttsVolume', 0.2, 1, 0.05, 'Âm lượng giọng đọc', (v) => Math.round(v * 100) + '%'),
      h('div', { class: 'mdub-row' }, [h('span', { text: 'Hiện phụ đề tiếng Việt' }), ui.subs]),
    ]);
    const foot = h('div', { class: 'mdub-foot' }, [h('span', { class: 'mdub-small', text: 'Alt+M bật/tắt' }), h('span', { class: 'mdub-credit', text: 'Created by Mondiro' })]);
    panel.append(head, body, foot);
    return panel;
  }

  function togglePanel(force) {
    if (!ui.panel) return;
    const open = force ?? !ui.panel.classList.contains('open');
    ui.panel.classList.toggle('open', open);
    if (open) refreshStatus();
  }
  document.addEventListener('click', (e) => { if (ui.panel && ui.panel.classList.contains('open') && !ui.panel.contains(e.target) && !(ui.btn && ui.btn.contains(e.target))) togglePanel(false); }, true);

  let pillT = null;
  function pill(text, warn = false, ms = 4000) {
    if (!ui.pill) return;
    ui.pill.lastChild.textContent = text;
    ui.pill.classList.toggle('warn', warn);
    ui.pill.classList.add('show');
    clearTimeout(pillT);
    if (ms) pillT = setTimeout(() => ui.pill.classList.remove('show'), ms);
  }

  function renderAll() {
    if (!ui.panel) return;
    const s = st.settings || {};
    const enabled = s.enabled !== false;
    ui.enable.checked = enabled;
    ui.btn.classList.toggle('on', enabled && st.connected && !st.noSubs && !st.waitingSubs);
    // nguồn phụ đề
    const both = !!(st.src && st.src.vi && st.src.en);
    ui.srcBox.style.display = both ? 'flex' : 'none';
    ui.srcVi.classList.toggle('sel', st.src && st.src.chosen === 'vi');
    ui.srcEn.classList.toggle('sel', st.src && st.src.chosen === 'en');
    const busy = enabled && st.job && (st.job.state === 'translating' || st.job.state === 'synthesizing');
    ui.btn.classList.toggle('busy', !!busy);
    // trạng thái
    let title = '', right = '', info = '', pct = 0, rightCls = '';
    ui.stAction.style.display = 'none';
    ui.stAction.replaceChildren();
    if (!st.connected) {
      title = 'Chưa kết nối app MDub'; info = 'Mở app MDub trên máy tính (biểu tượng ở khay hệ thống cạnh đồng hồ Windows).'; rightCls = 'mdub-err';
    } else if (!enabled) {
      title = 'Thuyết minh đang tắt'; info = 'Bật công tắc ở trên hoặc nhấn Alt+M.';
    } else if (st.error) {
      title = 'Không thuyết minh được'; info = st.error; rightCls = 'mdub-err';
      ui.stAction.style.display = 'flex';
      ui.stAction.append(h('button', { class: 'mdub-btn2', text: 'Thử lại', onclick: () => startVideo(true) }), h('button', { class: 'mdub-btn2', text: 'Mở app MDub', onclick: () => send({ type: 'showApp' }) }));
    } else if (st.noSubs) {
      title = SITE === 'netflix' ? 'Chưa bắt được phụ đề' : 'Video không có phụ đề'; info = st.noSubs; rightCls = 'mdub-err';
      if (SITE === 'netflix') {
        ui.stAction.style.display = 'flex';
        ui.stAction.append(
          h('button', { class: 'mdub-btn2', text: 'Thử lại', onclick: () => startVideo(true) }),
          h('button', { class: 'mdub-btn2 red', text: 'Sao chép thông tin lỗi', onclick: copyDiag }),
        );
      }
    } else if (!st.job) {
      title = st.info || 'Đang chuẩn bị…'; info = st.infoSub || '';
    } else {
      const j = st.job, tt = j.tts || { done: 0, total: 0 };
      if (j.state === 'translating') { title = 'Đang dịch bằng Claude'; pct = (j.translateProgress || 0) * 100; info = `${st.cues.length} câu · dịch trước toàn bộ video`; }
      else {
        title = j.source === 'vi' ? `Đọc ${st.cues.length} câu phụ đề Việt` : `Đã dịch ${st.cues.length} câu`; right = j.state === 'ready' ? 'Đã lưu cache' : ''; rightCls = 'mdub-ok';
        pct = tt.total ? (tt.done / tt.total) * 100 : 0;
        info = j.state === 'ready' ? 'Giọng đọc đã sẵn sàng toàn bộ video' : `Tạo giọng ${tt.done}/${tt.total} · phát ngay được`;
      }
    }
    ui.stTitle.textContent = title;
    ui.stRight.textContent = right; ui.stRight.className = rightCls;
    ui.stBar.style.width = Math.round(pct) + '%';
    ui.stBar.parentNode.classList.toggle('ok', !!(st.job && st.job.state === 'ready'));
    ui.stBar.parentNode.classList.toggle('hide', !st.job);
    ui.stInfo.textContent = info;
    // cài đặt
    const voices = (st.appStatus && st.appStatus.voices) || [];
    if (ui.voice.options.length !== voices.length) ui.voice.replaceChildren(...voices.map((v) => h('option', { value: v.id, text: `${v.name} (${v.id})` })));
    if (document.activeElement !== ui.voice && s.voice) ui.voice.value = s.voice;
    for (const k of ['duckLevel', 'ttsVolume']) if (ui[k] && document.activeElement !== ui[k].r && s[k] != null) { ui[k].r.value = s[k]; ui[k].paint(); }
    ui.subs.checked = s.showSubs !== false;
    // cập nhật
    const u = st.appStatus && st.appStatus.update;
    ui.latest.classList.toggle('show', !!(u && u.status === 'latest'));
    ui.upd.classList.toggle('latest', !!(u && u.status === 'latest'));
    ui.upd.title = u && u.status === 'latest' ? 'Kiểm tra cập nhật · Đã là bản mới nhất' : u && u.status === 'available' ? `Kiểm tra cập nhật · Có bản mới v${u.latest} (mở app MDub để cài)` : 'Kiểm tra cập nhật';
  }

  // Thông tin chẩn đoán (không có dữ liệu cá nhân): giúp sửa lỗi bắt phụ đề
  async function copyDiag(e) {
    const d = await hook('diag');
    const info = { mdub: chrome.runtime.getManifest().version, site: SITE, ...(d || { hook: false }) };
    const text = 'MDub chẩn đoán Netflix:\n' + JSON.stringify(info, null, 1);
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = h('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    if (e && e.target) e.target.textContent = 'Đã sao chép ✓';
    pill('Đã sao chép thông tin lỗi — dán gửi cho Claude', false, 4000);
  }

  async function checkUpdate() {
    ui.upd.classList.add('checking');
    const r = await send({ type: 'checkUpdate' });
    ui.upd.classList.remove('checking');
    if (r.ok) { st.appStatus = { ...(st.appStatus || {}), update: r.data }; renderAll(); pill(r.data.status === 'latest' ? 'MDub đã là bản mới nhất' : r.data.status === 'available' ? `Có bản mới v${r.data.latest} — mở app MDub để cài` : 'Không kiểm tra được bản cập nhật', r.data.status !== 'latest'); }
  }

  async function saveSetting(patch) {
    st.settings = { ...(st.settings || {}), ...patch };
    renderAll();
    const r = await send({ type: 'settings', patch });
    if (r.ok) st.settings = r.data;
    if ('voice' in patch) { st.buffers.clear(); st.fetching.clear(); stopPlaying(); startVideo(true); }
  }

  function setEnabled(on) {
    saveSetting({ enabled: on });
    if (!on) { stopPlaying(); if (ui.sub) ui.sub.style.display = 'none'; pill('Đã tắt thuyết minh', true, 2000); }
    else { pill('Đã bật thuyết minh', false, 2000); startVideo(true); }
  }

  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && e.code === 'KeyM') {
      const t = e.target;
      if (t && (t.isContentEditable || /INPUT|TEXTAREA/.test(t.tagName))) return;
      e.preventDefault(); e.stopPropagation();
      setEnabled(!(st.settings && st.settings.enabled !== false));
    }
  }, true);

  // ---------- kết nối app ----------
  async function refreshStatus() {
    const r = await send({ type: 'status' });
    st.connected = !!r.ok;
    if (r.ok) { st.appStatus = r.data; st.settings = r.data.settings; }
    renderAll();
    return r;
  }

  async function getInfo(key) {
    // YouTube/Netflix: chờ trình phát nạp xong thông tin video đúng mã
    for (let k = 0; k < 40; k++) {
      const info = await hook('info');
      if (SITE === 'web') return info;
      if (info && info.videoId === key && (SITE !== 'netflix' || info.tracks.length || k > 30)) return info;
      await sleep(SITE === 'netflix' ? 400 : 300);
    }
    return null;
  }

  // Chọn nguồn: phụ đề Việt (thủ công) nếu có và người dùng không chọn khác, không thì phụ đề Anh
  function chooseSource(tracks, key) {
    const okLang = (t) => !t.forced;
    const vi = tracks.find((t) => /^vi/i.test(t.lang) && t.kind !== 'asr' && okLang(t)) || null;
    const ens = tracks.filter((t) => /^en/i.test(t.lang) && okLang(t));
    let en = ens.find((t) => t.kind !== 'asr') || ens[0] || null;
    if (!en && SITE === 'web') en = tracks.find((t) => !t.lang) || null; // không rõ ngôn ngữ → coi là tiếng Anh
    let pref = null;
    try { pref = sessionStorage.getItem('mdub-src:' + key); } catch { /* ignore */ }
    const chosen = pref === 'en' && en ? 'en' : vi ? 'vi' : en ? 'en' : null;
    return { vi, en, chosen, track: chosen === 'vi' ? vi : en };
  }

  function cacheId(key, src) {
    if (SITE === 'youtube') return src === 'vi' ? `${key}-vi` : key;
    return `${SITE === 'netflix' ? 'nf' : 'web'}-${key}-${src}`;
  }

  function setSource(src) {
    if (!st.src || !st.src[src] || st.src.chosen === src) return;
    try { sessionStorage.setItem('mdub-src:' + st.pageKey, src); } catch { /* ignore */ }
    st.buffers.clear(); st.fetching.clear(); stopPlaying();
    startVideo(true);
  }

  async function startVideo(force = false) {
    const key = pageKey();
    if (!key) return;
    if (!force && st.pageKey === key && (st.job || st.waiting)) return;
    const session = ++st.session;
    if (st.pageKey !== key) { st.buffers.clear(); st.fetching.clear(); stopPlaying(); st.cues = []; st.job = null; st.src = null; }
    st.pageKey = key; st.error = null; st.noSubs = null; st.infoSub = ''; st.info = 'Đang kết nối app MDub…'; st.waiting = true;
    clearTimeout(st.pollT);
    renderAll();
    const sr = await refreshStatus();
    if (session !== st.session) return;
    if (!sr.ok) { st.waiting = false; pill('MDub: chưa kết nối app trên máy', true); return; }
    if (st.settings && st.settings.enabled === false) { st.waiting = false; return; }
    st.info = 'Đang tìm phụ đề…'; renderAll();
    let info = await getInfo(key);
    if (session !== st.session) return;
    let src = chooseSource((info && info.tracks) || [], key);
    // Trang khác: nhiều trình phát chỉ tải phụ đề khi người xem bật → chờ
    st.waitingSubs = false;
    while (SITE === 'web' && !src.track && session === st.session) {
      st.waitingSubs = true;
      st.info = 'Chưa thấy phụ đề trên trang';
      st.infoSub = 'Bật phụ đề tiếng Anh hoặc tiếng Việt trên trình phát 1 lần, MDub sẽ tự nhận.';
      renderAll();
      await sleep(2000);
      info = await hook('info');
      src = chooseSource((info && info.tracks) || [], key);
    }
    // Netflix: manifest có khi đến muộn (sau khi phim bắt đầu phát) → chờ thêm tối đa ~45 giây
    for (let k = 0; SITE === 'netflix' && !src.track && k < 22 && session === st.session; k++) {
      st.waitingSubs = true;
      st.info = 'Đang chờ Netflix tải phụ đề…';
      st.infoSub = 'Nếu phim chưa chạy, bấm phát. MDub tự nhận khi Netflix tải phụ đề.';
      renderAll();
      await sleep(2000);
      info = await hook('info');
      src = chooseSource((info && info.tracks) || [], key);
    }
    if (session !== st.session) return;
    st.src = src; st.infoSub = ''; st.waitingSubs = false;
    if (!src.track) {
      st.waiting = false;
      st.noSubs = SITE === 'netflix'
        ? 'MDub chưa bắt được phụ đề của phim này. Bấm "Sao chép thông tin lỗi" rồi gửi cho Claude để sửa.'
        : 'Video này không có phụ đề nên MDub chưa thuyết minh được.';
      renderAll(); pill(SITE === 'netflix' ? 'MDub: chưa bắt được phụ đề' : 'MDub: video không có phụ đề', true, 5000);
      // vẫn theo dõi: phụ đề xuất hiện thì tự chạy
      const watchLater = async () => {
        if (session !== st.session || !st.noSubs) return;
        const again = await hook('info');
        if (session !== st.session) return;
        if (chooseSource((again && again.tracks) || [], key).track) { startVideo(true); return; }
        setTimeout(watchLater, 4000);
      };
      setTimeout(watchLater, 4000);
      return;
    }
    st.videoId = cacheId(key, src.chosen);
    const base = {
      videoId: st.videoId, site: SITE, url: location.href,
      title: (info && info.title) || document.title, channel: (info && info.channel) || '',
      duration: info && info.lengthSeconds ? info.lengthSeconds : 0, voice: st.settings.voice,
    };
    // 1) app đã có sẵn (cache) → không cần tải phụ đề
    let r = await send({ type: 'open', payload: base });
    if (session !== st.session) return;
    if (r.ok && r.data.state === 'need_captions') {
      st.info = 'Đang lấy phụ đề…'; renderAll();
      const subs = await hook('track', { id: src.track.id });
      if (session !== st.session) return;
      if (!subs || !subs.data) { st.waiting = false; st.error = 'Không tải được phụ đề của video này. Thử tải lại trang.'; renderAll(); return; }
      r = await send({ type: 'open', payload: { ...base, subs: { ...subs, lang: src.chosen === 'vi' ? 'vi' : (src.track.lang || 'en') } } });
    }
    st.waiting = false;
    if (session !== st.session) return;
    if (!r.ok) { st.connected = false; renderAll(); return; }
    applyJob(r.data);
    poll(session);
  }

  function applyJob(j) {
    if (!j) return;
    if (j.state === 'error') { st.error = j.error || 'Lỗi không rõ'; st.job = null; renderAll(); return; }
    if (!j.cues) return;
    const prevState = st.job && st.job.state;
    st.job = j; st.cues = j.cues; st.error = null;
    if (j.state !== prevState) {
      if (j.state === 'translating') pill('MDub: đang dịch phụ đề…', true, 0);
      else if (j.state === 'synthesizing' && prevState !== 'synthesizing') pill(`Đang thuyết minh · ${(j.voiceKey || '').split('@')[0]}`);
      else if (j.state === 'ready' && prevState !== 'ready') pill(`Đang thuyết minh · ${(j.voiceKey || '').split('@')[0]}`);
    }
    renderAll();
  }

  async function poll(session) {
    if (session !== st.session) return;
    const r = await send({ type: 'job', videoId: st.videoId });
    if (session !== st.session) return;
    if (r.ok) applyJob(r.data);
    else { st.connected = false; renderAll(); }
    const ready = st.job && st.job.state === 'ready';
    st.pollT = setTimeout(() => poll(session), ready ? 8000 : r.ok ? 1500 : 5000);
  }

  // ---------- tải audio trước ----------
  function b64ToBuf(b64) {
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  async function fetchAudio(c) {
    const key = c.i;
    st.fetching.add(key);
    const vid = st.videoId, session = st.session;
    try {
      const r = await send({ type: 'audio', videoId: vid, i: c.i, v: st.job && st.job.voiceKey });
      if (!r.ok || session !== st.session) return;
      const buf = await ensureCtx().decodeAudioData(b64ToBuf(r.data.b64));
      st.buffers.set(key, buf);
    } catch { /* thử lại lần sau */ } finally { st.fetching.delete(key); }
  }
  function prefetch(t) {
    if (!st.cues.length) return;
    for (const c of st.cues) {
      if (st.fetching.size >= 3) break;
      if (c.has && !st.buffers.has(c.i) && !st.fetching.has(c.i) && c.end > t - 1 && c.start < t + 45) fetchAudio(c);
    }
    // giải phóng bộ nhớ các câu ở xa
    for (const i of st.buffers.keys()) { const c = st.cues[i]; if (c && (c.end < t - 90 || c.start > t + 180)) st.buffers.delete(i); }
  }

  function cueAt(t) {
    let lo = 0, hi = st.cues.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (st.cues[m].start <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  }

  // ---------- vòng đồng bộ ----------
  let lastT = 0;
  function tick() {
    const v = getVideo();
    const enabled = st.settings && st.settings.enabled !== false && st.connected;
    if (SITE !== 'youtube') placeLayer();
    if (!v || !enabled || !st.cues.length || st.pageKey !== pageKey()) {
      if (st.playing) stopPlaying();
      if (ui.sub) ui.sub.style.display = 'none';
      return;
    }
    if (audio.ctx && audio.ctx.state === 'running' && audio.video !== v) { audio.mode = null; setupGraph(); }
    const t = v.currentTime;
    if (Math.abs(t - lastT) > 1.5 && st.playing) stopPlaying(); // tua
    lastT = t;
    const idx = cueAt(t);
    const c = idx >= 0 ? st.cues[idx] : null;
    // phụ đề Việt
    if (ui.sub) {
      const showSub = c && st.settings.showSubs !== false && c.vi && t <= Math.max(c.end, c.start + (c.dur || 0));
      ui.sub.style.display = showSub ? 'block' : 'none';
      if (showSub && ui.sub.textContent !== c.vi) ui.sub.textContent = c.vi;
    }
    if (!v.paused && c && st.buffers.has(c.i) && (!st.playing || st.playing.i !== c.i)) {
      const off = t - c.start;
      const buf = st.buffers.get(c.i);
      if (off >= 0 && off < Math.min(0.6, buf.duration - 0.2)) {
        if (!audio.ctx || audio.ctx.state !== 'running') { ensureCtx(); if (!tick.warned) { tick.warned = true; pill('Bấm vào video 1 lần để MDub phát tiếng', true, 6000); } }
        else play(c.i, off);
      }
    }
    if (Math.abs(t - st.lastCursor) > 3) { st.lastCursor = t; send({ type: 'cursor', videoId: st.videoId, t }); }
    prefetch(t);
  }
  const errs = [];
  const safe = (name, fn) => (...a) => { try { return fn(...a); } catch (e) { if (errs.length < 8) errs.push(`${name}: ${e && e.message}`); return undefined; } };
  setInterval(safe('tick', tick), 50);

  // Chẩn đoán cho popup của extension (đọc qua chrome.scripting)
  window.__mdubDiag = () => {
    const v = getVideo();
    const r = v && v.getBoundingClientRect();
    return {
      site: SITE, path: location.pathname, key: pageKey(), connected: st.connected, enabled: st.settings ? st.settings.enabled !== false : null,
      videos: [...document.querySelectorAll('video')].map((x) => { const b = x.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}`; }),
      video: r ? `${Math.round(r.width)}x${Math.round(r.height)}` : null,
      layer: ui.layer ? { parent: ui.layer.parentNode ? ui.layer.parentNode.tagName : null, display: ui.layer.style.display, rect: [ui.layer.style.left, ui.layer.style.top, ui.layer.style.width, ui.layer.style.height].join(' ') } : null,
      fullscreen: document.fullscreenElement ? document.fullscreenElement.tagName + '.' + String(document.fullscreenElement.className).slice(0, 40) : null,
      info: st.info, noSubs: st.noSubs, error: st.error, job: st.job ? st.job.state : null, cues: st.cues.length,
      src: st.src ? { vi: !!st.src.vi, en: !!st.src.en, chosen: st.src.chosen } : null,
      errors: errs,
    };
  };

  function bindVideo() {
    const v = getVideo();
    if (!v || v.__mdubBound) return;
    v.__mdubBound = true;
    v.addEventListener('pause', () => { if (audio.ctx && audio.ctx.state === 'running' && st.playing) audio.ctx.suspend(); });
    v.addEventListener('play', () => { if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume().then(setupGraph); });
    v.addEventListener('seeking', stopPlaying);
    v.addEventListener('ratechange', () => { if (st.playing) st.playing.src.playbackRate.value = v.playbackRate; });
  }

  // ---------- điều hướng (trang 1 trang / SPA) ----------
  let lastKey = null;
  async function onNavigate() {
    const key = pageKey();
    if (key === lastKey) return;
    lastKey = key;
    if (!key) { stopPlaying(); st.session++; st.pageKey = null; st.videoId = null; st.cues = []; st.job = null; st.src = null; clearTimeout(st.pollT); if (ui.layer) ui.layer.style.display = 'none'; return; }
    for (let k = 0; k < 40 && !buildUI(); k++) await sleep(250);
    bindVideo();
    startVideo();
  }
  if (SITE === 'youtube') window.addEventListener('yt-navigate-finish', onNavigate);
  setInterval(safe('loop', () => { onNavigate(); if (pageKey()) { buildUI(); bindVideo(); } }), 1000);
  onNavigate();
})();
