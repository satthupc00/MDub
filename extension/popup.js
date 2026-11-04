'use strict';
const $ = (s) => document.querySelector(s);
const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, (x) => r(x || { ok: false })));
const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  kids.forEach((c) => c && e.append(c));
  return e;
};
$('#ver').textContent = 'Extension v' + chrome.runtime.getManifest().version;
function showUpdate(u) { $('#latest').style.display = u && u.status === 'latest' ? 'inline-block' : 'none'; }

let tab = null, host = '', builtin = [], sites = [];

async function loadTab() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { const u = new URL(tab.url); host = /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase() : ''; } catch { host = ''; }
}

function renderSites() {
  const box = $('#sites');
  box.replaceChildren(...sites.map((s) => el('div', { class: 'site' + (s.enabled ? '' : ' off') }, [
    el('span', { text: s.host, title: s.host }),
    el('button', { class: 'x', text: '×', title: 'Gỡ', 'aria-label': 'Gỡ ' + s.host, onclick: async () => { const r = await send({ type: 'site', action: 'remove', host: s.host }); if (r.ok) { sites = r.data.sites; render(); } } }),
  ])));
  $('#sitesBox').classList.toggle('hide', !sites.length);
}

function render() {
  const here = $('#here');
  here.replaceChildren();
  here.classList.remove('hide');
  const site = sites.find((s) => s.host === host);
  if (!host) {
    here.append(el('div', { class: 'm', text: 'Mở một trang có video để dùng MDub.' }));
  } else if (builtin.includes(host)) {
    const name = host.includes('netflix') ? 'netflix.com' : 'youtube.com';
    here.append(el('div', { class: 'm', text: `${name} có sẵn trong MDub. Mở video và bấm nút VI.` }));
  } else if (site) {
    const sw = el('input', { type: 'checkbox', class: 'sw', 'aria-label': 'Bật MDub cho ' + host, title: 'Bật/tắt MDub cho trang này' });
    sw.checked = !!site.enabled;
    sw.addEventListener('change', async () => {
      if (sw.checked && !(await chrome.permissions.request({ origins: [`https://${host}/*`, `http://${host}/*`] }))) { sw.checked = false; return; }
      const r = await send({ type: 'site', action: sw.checked ? 'enable' : 'disable', host, tabId: tab.id });
      if (r.ok) { sites = r.data.sites; render(); }
    });
    here.append(el('div', { class: 'row', style: 'justify-content:space-between' }, [el('span', {}, [document.createTextNode('MDub trên '), el('b', { text: host })]), sw]));
  } else {
    here.append(
      el('div', { class: 'card' }, [el('b', { text: host }), el('div', { class: 'm', text: 'Trang này chưa bật MDub. Sau khi bật, MDub tự tìm video và phụ đề có sẵn trên trang.' })]),
      el('button', {
        class: 'red', text: 'Bật MDub cho trang này',
        onclick: async (e) => {
          e.target.disabled = true;
          // Chrome hỏi quyền đọc trang (phải gọi ngay khi bấm)
          const ok = await chrome.permissions.request({ origins: [`https://${host}/*`, `http://${host}/*`] }).catch(() => false);
          if (!ok) { e.target.disabled = false; return; }
          const r = await send({ type: 'site', action: 'enable', host, tabId: tab.id });
          if (r.ok) { sites = r.data.sites; render(); }
          else e.target.disabled = false;
        },
      }),
      el('div', { class: 'm', style: 'font-size:11px', text: 'Chrome sẽ hỏi quyền đọc trang này. Trang được tải lại 1 lần.' }),
    );
  }
  renderSites();
}

(async () => {
  await loadTab();
  const s = await send({ type: 'site', action: 'list' });
  if (s.ok) { sites = s.data.sites; builtin = s.data.builtin; }
  render();
  const r = await send({ type: 'status' });
  if (!r.ok) {
    $('#dot').className = 'dot err';
    $('#st').textContent = 'Chưa kết nối app MDub';
    $('#info').textContent = 'Mở app MDub trên máy tính rồi thử lại.';
    $('#show').disabled = true;
    return;
  }
  const st = r.data;
  $('#dot').className = 'dot on';
  $('#st').textContent = 'Đã kết nối app MDub v' + st.version;
  $('#info').textContent = !st.ready ? 'Chưa tải giọng đọc — mở app MDub để tải.' : !st.hasApiKey ? 'Chưa nhập API key Claude (cần khi dịch từ tiếng Anh).' : '';
  $('#info').classList.toggle('hide', !$('#info').textContent);
  showUpdate(st.update);
})();
$('#show').addEventListener('click', () => send({ type: 'showApp' }));
$('#upd').addEventListener('click', async () => {
  $('#upd').textContent = 'Đang kiểm tra…';
  const r = await send({ type: 'checkUpdate' });
  const u = r.ok ? r.data : null;
  showUpdate(u);
  $('#upd').textContent = !u ? 'Lỗi kết nối' : u.status === 'latest' ? 'Đã là bản mới nhất' : u.status === 'available' ? 'Có bản mới v' + u.latest : 'Kiểm tra cập nhật';
});
