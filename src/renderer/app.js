'use strict';
/* global mdub */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const api = window.mdub;
  if (api && api.isElectron) document.documentElement.classList.add('electron');

  let S = null; // appState
  let current = null; // videoId đang xem chi tiết
  let detail = null;
  const jobsMap = new Map();

  const fmtMB = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2).replace('.', ',') + ' GB' : Math.round(b / 1e6) + ' MB');
  const fmtT = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60), x = (s % 60).toFixed(0).padStart(2, '0'); return `${String(m).padStart(2, '0')}:${x}`; };
  const num = (v, d = 1) => Number(v).toFixed(d).replace('.', ',');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const SITE_NAMES = { youtube: 'YouTube', netflix: 'Netflix' };
  const siteName = (v) => SITE_NAMES[v.site] || (v.url ? (() => { try { return new URL(v.url).hostname.replace(/^www\./, ''); } catch { return 'Web'; } })() : 'YouTube');
  const thumbCss = (v) => (!v.site || v.site === 'youtube') && /^[A-Za-z0-9_-]{11}$/.test(v.videoId)
    ? `background-image:url(https://i.ytimg.com/vi/${encodeURIComponent(v.videoId)}/mqdefault.jpg)` : '';
  const thumbLabel = (v) => (thumbCss(v) ? '' : `<span class="thumb-site">${esc(siteName(v))}</span>`);

  let toastT = null;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200);
  }
  function status(msg) { $('#status').textContent = msg; }

  // ---------- điều hướng ----------
  function go(page) {
    $$('.nav').forEach((n) => n.classList.toggle('sel', n.dataset.page === page));
    $$('.page').forEach((p) => p.classList.toggle('on', p.id === 'page-' + page));
    if (page === 'library') loadLibrary();
  }
  $$('.nav').forEach((n) => n.addEventListener('click', () => go(n.dataset.page)));
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && /^[1-4]$/.test(e.key)) { go(['jobs', 'library', 'voices', 'settings'][+e.key - 1]); e.preventDefault(); }
    if (e.key === 'Escape') $$('.modal.on').forEach(closeModal);
  });
  function closeModal(m) {
    if (!m.classList.contains('on') || m.classList.contains('closing')) return;
    m.classList.add('closing');
    setTimeout(() => m.classList.remove('on', 'closing'), 180);
  }
  $$('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModal(m); });
  });

  // ---------- slider tô màu ----------
  function paintRange(r) {
    const p = ((r.value - (r.min || 0)) / ((r.max || 100) - (r.min || 0))) * 100;
    r.style.setProperty('--fill', p + '%');
  }
  (function tick() { $$('input[type=range]').forEach(paintRange); requestAnimationFrame(tick); })();

  // ---------- cập nhật ----------
  function renderUpdate(u) {
    if (!u) return;
    const b = $('#updBtn');
    b.classList.remove('checking', 'latest', 'available');
    const latest = u.status === 'latest';
    $('#latest').classList.toggle('hide', !latest);
    let tip = 'Kiểm tra cập nhật';
    let vs = '';
    if (u.status === 'checking') { b.classList.add('checking'); tip += ' · Đang kiểm tra…'; vs = 'Đang kiểm tra…'; }
    else if (latest) { b.classList.add('latest'); tip += ' · Đã là bản mới nhất'; vs = '<span style="color:var(--ok);font-weight:700">· Đã là bản mới nhất</span>'; }
    else if (u.status === 'available') { b.classList.add('available'); tip += ` · Có bản mới v${u.latest}`; vs = `<span style="color:var(--ok);font-weight:700">· Có bản mới v${esc(u.latest)}</span>`; }
    else if (u.status === 'downloading') { b.classList.add('checking'); tip += ` · Đang tải ${u.percent || 0}%`; vs = `Đang tải bản mới ${u.percent || 0}%`; }
    else if (u.status === 'downloaded') { vs = 'Đang cài bản mới…'; }
    else if (u.status === 'error') { tip += ' · ' + (u.error || 'Lỗi'); vs = '<span style="color:var(--warn)">· Không kiểm tra được</span>'; }
    else if (u.status === 'dev') { tip += ' · Bản chạy thử'; vs = '· chạy thử'; }
    b.title = tip; b.setAttribute('aria-label', tip);
    $('#verState').innerHTML = vs;
    if (u.status === 'available' && !renderUpdate.shown) { renderUpdate.shown = true; openUpdate(u); }
    if (u.status === 'downloading') { $('#updBar').classList.remove('hide'); $('#updBar div').style.width = (u.percent || 0) + '%'; $('#updGo').disabled = true; }
  }
  function openUpdate(u) {
    $('#updTitle').textContent = `Có bản mới v${u.latest}`;
    const notes = typeof u.notes === 'string' ? u.notes.replace(/<[^>]+>/g, ' ').trim() : '';
    $('#updBody').textContent = (notes ? notes.slice(0, 600) + '\n\n' : '') + 'Bấm "Cập nhật ngay": MDub tự tải, cài và mở lại. Extension Chrome cũng được cập nhật theo.';
    $('#updBody').style.whiteSpace = 'pre-line';
    $('#upd').classList.add('on');
  }
  async function checkUpdate() {
    renderUpdate({ status: 'checking' });
    const u = await api.checkUpdate();
    renderUpdate(u);
    if (u.status === 'available') openUpdate(u);
    else if (u.status === 'latest') toast('Bạn đang dùng bản mới nhất');
  }
  $('#updBtn').addEventListener('click', checkUpdate);
  $('#updBtn2').addEventListener('click', checkUpdate);
  $('#updGo').addEventListener('click', () => { $('#updGo').disabled = true; api.installUpdate(); });

  // ---------- what's new ----------
  $('#wnBtn').addEventListener('click', () => {
    const w = S.whatsnew;
    let h = '';
    if (w) {
      const d = w.date ? w.date.split('-').reverse().join('/') : '';
      h += `<div class="small">v${esc(w.version)}${d ? ' · ' + d : ''}</div>`;
      for (const [k, label] of [['new', 'Mới'], ['improved', 'Cải thiện'], ['fixed', 'Sửa lỗi']]) {
        if (w[k] && w[k].length) h += `<div class="wn-g" style="margin-top:10px">${label}</div><ul>${w[k].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
      }
    }
    if (S.update && S.update.status === 'available') h += `<div class="row2" style="margin-top:12px"><span class="small" style="flex:1">Có bản mới v${esc(S.update.latest)}</span><button class="btn green" id="wnUpd">Cập nhật</button></div>`;
    $('#wnBody').innerHTML = h || '<div class="small">Chưa có thông tin.</div>';
    const u = $('#wnUpd'); if (u) u.addEventListener('click', () => { closeModal($('#wn')); openUpdate(S.update); });
    $('#wn').classList.add('on');
  });

  // ---------- trạng thái chung ----------
  function renderState() {
    const s = S.settings;
    $('#ver').textContent = S.version;
    $('#cacheSize').textContent = fmtMB(S.cacheSize || 0);
    $('#cacheBar').style.width = Math.min(100, ((S.cacheSize || 0) / 5e9) * 100) + '%';
    $('#cacheInfo').textContent = `${fmtMB(S.cacheSize || 0)} đã dùng`;
    $('#cacheInfo').title = '%APPDATA%\\MDub\\cache';
    const ready = S.modelState.status === 'ready';
    $('#engineInfo').textContent = ready ? `Kokoro sẵn sàng${S.provider ? ' · ' + (S.provider === 'dml' ? 'card đồ hoạ' : 'CPU') : ''}` : 'Giọng đọc chưa tải';
    $('#modelInfo').textContent = ready ? `Đã tải · ${S.availableVoices.length} giọng` : 'Chưa tải';
    const seen = S.extension && S.extension.lastSeen && Date.now() - S.extension.lastSeen < 90000;
    $('#extPill').classList.toggle('on', !!seen);
    $('#extPill span').textContent = seen ? 'Chrome đã kết nối' : 'Chưa thấy Chrome';
    $('#extInfo').textContent = S.extension ? `v${S.extension.version} · cổng ${S.extension.port}` : '';
    // onboarding
    const keyOk = s.hasApiKey;
    $('#ob1').classList.toggle('done', ready);
    $('#ob2').classList.toggle('done', keyOk);
    $('#ob3').classList.toggle('done', !!(S.extension && S.extension.lastSeen));
    $('#dlBtn').textContent = ready ? '✓ Đã tải' : S.modelState.status === 'downloading' ? 'Đang tải…' : 'Tải giọng đọc';
    $('#dlBtn').disabled = ready || S.modelState.status === 'downloading';
    $('#dlBtn').classList.toggle('red', !ready); $('#dlBtn').classList.toggle('done', ready);
    $('#obKey').placeholder = keyOk ? 'Đã lưu key ✓' : 'sk-ant-…';
    const needOnb = (!ready || !keyOk || !(S.extension && S.extension.lastSeen)) && !(S.jobs && S.jobs.length) && !jobsMap.size;
    $('#onboard').classList.toggle('hide', !needOnb);
    // form
    $('#model').innerHTML = S.models.map((m) => `<option value="${m.id}"${m.id === s.model ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
    $('#keyState').textContent = keyOk ? 'Đã lưu ✓' : 'Chưa có';
    $('#apiKey').placeholder = keyOk ? '•••••••••••• (đã lưu, nhập để thay)' : 'sk-ant-…';
    setVal('#shorten', s.shorten, 'checked'); setVal('#showSubs', s.showSubs, 'checked'); setVal('#autoStart', s.autoStart, 'checked'); setVal('#useGpu', s.useGpu, 'checked');
    setVal('#sps', s.syllablesPerSecond); setVal('#duck', s.duckLevel); setVal('#ttsVol', s.ttsVolume); setVal('#fade', s.fadeMs);
    setVal('#spd', s.speed); setVal('#mspd', s.maxSpeed);
    labels();
    renderTerms();
    renderVoices();
    renderUpdate(S.update);
    renderModel(S.modelState);
  }
  function setVal(sel, v, prop = 'value') { const el = $(sel); if (document.activeElement !== el) el[prop] = v; }
  function labels() {
    $('#spsV').textContent = num($('#sps').value);
    $('#duckV').textContent = Math.round($('#duck').value * 100) + '%';
    $('#ttsVolV').textContent = Math.round($('#ttsVol').value * 100) + '%';
    $('#fadeV').textContent = num($('#fade').value / 1000, 2) + ' giây';
    $('#spdV').textContent = num($('#spd').value, 2) + '×';
    $('#mspdV').textContent = num($('#mspd').value, 2) + '×';
  }

  async function save(patch) { S.settings = await api.setSettings(patch); }
  const bind = (sel, key, conv = Number, prop = 'value', ev = 'change') => $(sel).addEventListener(ev, () => { labels(); save({ [key]: conv($(sel)[prop]) }); });
  ['#sps', '#duck', '#ttsVol', '#fade', '#spd', '#mspd'].forEach((s) => $(s).addEventListener('input', labels));
  bind('#sps', 'syllablesPerSecond'); bind('#duck', 'duckLevel'); bind('#ttsVol', 'ttsVolume'); bind('#fade', 'fadeMs');
  bind('#spd', 'speed'); bind('#mspd', 'maxSpeed');
  bind('#shorten', 'shorten', Boolean, 'checked'); bind('#showSubs', 'showSubs', Boolean, 'checked');
  bind('#autoStart', 'autoStart', Boolean, 'checked'); bind('#useGpu', 'useGpu', Boolean, 'checked');
  $('#model').addEventListener('change', () => save({ model: $('#model').value }));

  async function saveKey(input) {
    const v = input.value.trim();
    if (!v) { toast('Dán API key vào ô trước'); return; }
    status('Đang kiểm tra API key…');
    const r = await api.setApiKey(v);
    input.value = '';
    S = await api.state(); renderState();
    toast(r.ok ? 'Đã lưu API key ✓' : 'Key đã lưu nhưng kiểm tra lỗi: ' + r.error);
    status(r.ok ? 'API key hợp lệ' : r.error);
  }
  $('#keyBtn').addEventListener('click', () => saveKey($('#apiKey')));
  $('#obKeyBtn').addEventListener('click', () => saveKey($('#obKey')));
  $('#apiKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveKey($('#apiKey')); });
  $('#obKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveKey($('#obKey')); });

  // thuật ngữ
  function renderTerms() {
    const g = S.settings.glossary || [];
    const box = $('#terms');
    if (box.contains(document.activeElement)) return;
    box.innerHTML = g.map((t, i) => `<span class="chip">${esc(t)}<button data-i="${i}" aria-label="Xoá ${esc(t)}" title="Xoá">×</button></span>`).join('') +
      '<span class="chip add"><input id="termIn" placeholder="+ Thêm" aria-label="Thêm thuật ngữ"></span>';
    $$('button', box).forEach((b) => b.addEventListener('click', () => { const n = g.slice(); n.splice(+b.dataset.i, 1); save({ glossary: n }).then(renderTerms); }));
    $('#termIn').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.value.trim()) {
        const add = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
        save({ glossary: [...new Set([...g, ...add])] }).then(() => { renderTerms(); $('#termIn').focus(); });
      }
    });
  }

  // ---------- model ----------
  function renderModel(m) {
    if (!m) return;
    const bar = $('#dlBar'), txt = $('#dlText');
    const show = m.status === 'downloading' || m.status === 'error';
    bar.classList.toggle('hide', m.status !== 'downloading');
    txt.classList.toggle('hide', !show);
    if (m.status === 'downloading') {
      const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
      bar.firstElementChild.style.width = pct + '%';
      txt.textContent = `Đang tải ${pct}% · ${fmtMB(m.done || 0)}${m.total ? ' / ' + fmtMB(m.total) : ''}`;
      status(txt.textContent);
    } else if (m.status === 'error') { txt.textContent = 'Lỗi: ' + m.error; $('#dlBtn').disabled = false; $('#dlBtn').textContent = 'Thử lại'; }
  }
  $('#dlBtn').addEventListener('click', () => { $('#dlBtn').disabled = true; api.downloadModel(); });
  $('#redownload').addEventListener('click', () => { api.downloadModel(); toast('Đang tải lại model…'); go('jobs'); });

  // ---------- extension ----------
  const openChrome = async () => { const ok = await api.openChromeExt(); toast(ok ? 'Đã mở trang extension trên Chrome' : 'Không thấy Chrome. Gõ chrome://extensions vào Chrome'); };
  const copyExt = async () => { const p = await api.copyExtPath(); toast('Đã copy: ' + p); };
  $('#openChromeBtn').addEventListener('click', openChrome); $('#openChromeBtn2').addEventListener('click', openChrome);
  $('#copyExtBtn').addEventListener('click', copyExt); $('#copyExtBtn2').addEventListener('click', copyExt);
  $('#openExtBtn').addEventListener('click', () => api.openExtFolder());

  // ---------- giọng ----------
  let previewing = null;
  function renderVoices() {
    const box = $('#voices');
    const sel = S.settings.voice;
    box.innerHTML = S.voices.map((v) => `<div class="vc${v.id === sel ? ' sel' : ''}" data-id="${v.id}" role="button" tabindex="0" title="Chọn giọng ${esc(v.name)}">
      <span class="nm"><b>${esc(v.name)}</b><small>${v.id}${v.id === sel ? ' · mặc định' : ''}</small></span>
      <button class="play${previewing === v.id ? ' busy' : ''}" data-play="${v.id}" aria-label="Nghe thử ${esc(v.name)}" title="Nghe thử"><svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button></div>`).join('');
    $$('.vc', box).forEach((el) => {
      const pick = () => { save({ voice: el.dataset.id }).then(renderVoices); toast('Giọng mặc định: ' + el.dataset.id); };
      el.addEventListener('click', (e) => { if (!e.target.closest('.play')) pick(); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    $$('.play', box).forEach((b) => b.addEventListener('click', () => preview(b.dataset.play)));
  }
  let audioEl = null;
  async function preview(id) {
    if (S.modelState.status !== 'ready') { toast('Tải giọng đọc trước (trang Đang xử lý)'); return; }
    previewing = id; renderVoices();
    try {
      const b64 = await api.previewVoice(id, $('#pvText').value);
      if (audioEl) audioEl.pause();
      audioEl = new Audio('data:audio/wav;base64,' + b64);
      audioEl.play();
    } catch (e) { toast('Lỗi nghe thử: ' + e.message); }
    previewing = null; renderVoices();
  }

  // ---------- việc đang xử lý ----------
  function renderJobs() {
    const list = [...jobsMap.values()];
    $('#jobBadge').textContent = list.length;
    $('#jobBadge').classList.toggle('hide', !list.length);
    if (!current || !jobsMap.has(current)) current = list[0] ? list[0].videoId : null;
    $('#jobEmpty').classList.toggle('hide', !!current);
    $('#jobView').classList.toggle('hide', !current);
    $('#otherJobs').innerHTML = list.length > 1 ? list.filter((j) => j.videoId !== current).map((j) => `<button class="btn" data-v="${j.videoId}">${esc((j.title || j.videoId).slice(0, 40))}</button>`).join('') : '';
    $$('#otherJobs .btn').forEach((b) => b.addEventListener('click', () => { current = b.dataset.v; loadDetail(); }));
    if (!current) return;
    const j = jobsMap.get(current);
    $('#jTitle').textContent = j.title || j.videoId;
    $('#jThumb').setAttribute('style', thumbCss(j));
    $('#jThumb').innerHTML = thumbLabel(j);
    $('#jSub').textContent = `${siteName(j)} · ${j.channel ? j.channel + ' · ' : ''}${j.cues} câu`;
    const voice = (j.voiceKey || '').split('@')[0];
    const model = (S.models.find((m) => m.id === j.model) || {}).name || j.model || '';
    const isVi = j.source === 'vi';
    const srcTag = isVi ? '<span class="tag ok">Phụ đề Việt có sẵn · miễn phí</span>' : model ? `<span class="tag">Dịch: ${esc(model.split(' —')[0])}</span>` : '';
    $('#jTags').innerHTML = `<span class="tag">Giọng: ${esc(voice)}</span>${srcTag}${j.error ? `<span class="tag err">${esc(j.error)}</span>` : ''}`;
    $('#jRetrans').textContent = isVi ? 'Tạo lại giọng' : 'Dịch lại';
    $('#jRetrans').title = isVi ? 'Tạo lại toàn bộ giọng đọc' : 'Dịch lại toàn bộ và tạo lại giọng';
    $('#jOpen').lastChild.textContent = `Mở video trên ${siteName(j)}`;
    $('.thead span:nth-child(2)').textContent = isVi ? 'Phụ đề gốc' : 'Gốc (English)';
    $('.thead span:nth-child(3)').textContent = isVi ? 'Câu đọc (Việt) — bấm để sửa' : 'Thuyết minh (Việt) — bấm để sửa';
    const tp = j.translateProgress || 0, tt = j.tts || { done: 0, total: 0 };
    const ttsP = tt.total ? tt.done / tt.total : 0;
    const steps = [
      { name: 'Lấy phụ đề', p: 1, info: `${j.cues} câu` },
      isVi ? { name: 'Phụ đề Việt có sẵn', p: 1, info: 'Không cần dịch · miễn phí' }
        : { name: 'Dịch bằng Claude', p: tp, info: tp >= 1 ? 'Xong' : j.state === 'translating' ? `Đang dịch ${Math.round(tp * 100)}%` : j.error ? 'Lỗi' : 'Chờ' },
      { name: 'Tạo giọng đọc', p: ttsP, info: `${tt.done} / ${tt.total} câu` },
      { name: 'Sẵn sàng phát', p: j.state === 'ready' ? 1 : 0, info: j.state === 'ready' ? 'Đã lưu cache, xem lại không tốn API' : tt.done ? 'Phát được ngay từ các câu đã có' : 'Chờ' },
    ];
    $('#steps').innerHTML = steps.map((s, k) => `<div class="step ${s.p >= 1 ? 'done' : s.p > 0 || (k === 1 && j.state === 'translating') ? 'act' : ''}">
      <div class="step-h"><span>${k + 1}</span>${s.name}</div><div class="bar"><div style="width:${Math.round(s.p * 100)}%"></div></div>
      <div class="small" style="font-variant-numeric:tabular-nums">${esc(s.info)}</div></div>`).join('');
    status(j.state === 'synthesizing' ? `Đang tạo giọng ${tt.done}/${tt.total} câu` : j.state === 'translating' ? 'Đang dịch…' : j.state === 'ready' ? 'Xong · ' + (j.title || '') : j.error || 'Sẵn sàng');
  }

  let detailT = null;
  async function loadDetail() {
    if (!current) return;
    detail = await api.jobDetail(current);
    renderJobs();
    renderRows();
  }
  function scheduleDetail() { clearTimeout(detailT); detailT = setTimeout(loadDetail, 700); }

  function renderRows() {
    const box = $('#rows');
    if (!detail || !detail.cues) { box.innerHTML = ''; return; }
    if (box.contains(document.activeElement) && document.activeElement.isContentEditable) return;
    const top = box.scrollTop;
    box.innerHTML = detail.cues.map((c) => {
      const slot = detail.slots[c.i];
      let fit = '—', col = 'var(--muted)';
      if (c.has) { fit = `${num(c.dur)}s / ${num(slot)}s`; col = c.dur <= slot * 1.02 ? 'var(--ok)' : 'var(--warn)'; }
      else if (c.vi) fit = 'Đang chờ…';
      return `<div class="row" data-i="${c.i}">
        <span class="t">${fmtT(c.start)} → ${fmtT(c.end)}</span>
        <span class="en">${esc(detail.en[c.i])}</span>
        <span class="vi" contenteditable="${c.vi ? 'true' : 'false'}" spellcheck="false" title="Bấm để sửa, Enter để lưu">${esc(c.vi || (detail.translateProgress < 1 ? 'Đang dịch…' : ''))}</span>
        <span class="fit" style="color:${col}">${fit}</span>
        <span class="acts"><button class="ib2" data-play="${c.i}" ${c.has ? '' : 'disabled'} aria-label="Nghe thử câu này" title="Nghe thử câu này"><svg viewBox="0 0 24 24" fill="#E8E9EC" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button></span>
      </div>`;
    }).join('');
    box.scrollTop = top;
    $$('.vi[contenteditable=true]', box).forEach((el) => {
      const orig = el.textContent;
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } if (e.key === 'Escape') { el.textContent = orig; el.blur(); } });
      el.addEventListener('blur', () => {
        const t = el.textContent.trim();
        if (t !== orig) { api.editLine(current, +el.closest('.row').dataset.i, t); toast('Đã sửa · đang tạo lại giọng câu này'); scheduleDetail(); }
      });
    });
    $$('[data-play]', box).forEach((b) => b.addEventListener('click', async () => {
      $$('.row.sel', box).forEach((r) => r.classList.remove('sel'));
      b.closest('.row').classList.add('sel');
      const b64 = await api.lineAudio(current, +b.dataset.play);
      if (!b64) return;
      if (audioEl) audioEl.pause();
      audioEl = new Audio('data:audio/wav;base64,' + b64); audioEl.play();
    }));
  }

  $('#jOpen').addEventListener('click', () => { const j = current && jobsMap.get(current); if (j) api.openVideo(j.videoId, j.url); });
  $('#jRetrans').addEventListener('click', async () => { if (!current) return; await api.retranslate(current); toast('Đang dịch lại…'); scheduleDetail(); });
  $('#jCancel').addEventListener('click', async () => { if (!current) return; await api.cancelJob(current); jobsMap.delete(current); current = null; renderJobs(); });

  // ---------- thư viện ----------
  async function loadLibrary() {
    const list = await api.library();
    $('#libCount').textContent = list.length || '';
    $('#libEmpty').classList.toggle('hide', !!list.length);
    const byId = new Map(list.map((v) => [v.videoId, v]));
    $('#lib').innerHTML = list.map((v) => `<div class="li" data-v="${esc(v.videoId)}">
      <div class="thumb" style="${thumbCss(v)}">${thumbLabel(v)}</div>
      <div class="li-b"><div class="li-t">${esc(v.title || v.videoId)}</div>
      <div class="small">${esc(siteName(v))} · ${v.channel ? esc(v.channel) + ' · ' : ''}${v.cues} câu · ${fmtMB(v.size)}</div>
      <div class="tags">${v.source === 'vi' ? '<span class="tag ok">Phụ đề Việt</span>' : ''}${v.voices.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}${v.translated ? '' : '<span class="tag">chưa dịch</span>'}</div>
      <div class="btns"><button class="btn red" data-open>Mở video</button><button class="btn" data-del>Xoá</button></div></div></div>`).join('');
    $$('#lib .li').forEach((el) => {
      el.querySelector('[data-open]').addEventListener('click', () => { const v = byId.get(el.dataset.v); api.openVideo(v.videoId, v.url); });
      el.querySelector('[data-del]').addEventListener('click', async () => { await api.removeVideo(el.dataset.v); toast('Đã xoá khỏi cache'); loadLibrary(); refresh(); });
    });
  }
  $('#libOpen').addEventListener('click', () => api.openCache());
  $('#cacheOpen').addEventListener('click', () => api.openCache());
  $('#cacheClear').addEventListener('click', async () => {
    if (!confirm('Xoá toàn bộ bản dịch và giọng đọc đã lưu?')) return;
    await api.clearCache(); toast('Đã xoá cache'); refresh(); loadLibrary();
  });

  async function refresh() {
    S = await api.state();
    jobsMap.clear();
    (S.jobs || []).forEach((j) => jobsMap.set(j.videoId, j));
    renderState(); renderJobs();
    if (current) loadDetail();
  }

  // ---------- sự kiện từ app ----------
  api.onJob((j) => {
    if (j.removed) jobsMap.delete(j.videoId); else jobsMap.set(j.videoId, j);
    if (!current) current = j.videoId;
    renderJobs();
    if (j.videoId === current) scheduleDetail();
  });
  api.onModel((m) => { S.modelState = m; renderModel(m); if (m.status !== 'downloading') refresh(); });
  api.onUpdate((u) => { S.update = u; renderUpdate(u); });
  api.onSettings((s) => { S.settings = s; renderState(); });
  api.onState((st) => { S = st; renderState(); });
  setInterval(async () => { const st = await api.state(); S.extension = st.extension; S.cacheSize = st.cacheSize; S.provider = st.provider; renderState(); }, 15000);

  refresh().then(() => api.library().then((l) => { $('#libCount').textContent = l.length || ''; }));
})();
