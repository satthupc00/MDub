'use strict';
const $ = (s) => document.querySelector(s);
const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, (x) => r(x || { ok: false })));
$('#ver').textContent = 'Extension v' + chrome.runtime.getManifest().version;
function showUpdate(u) { $('#latest').style.display = u && u.status === 'latest' ? 'inline-block' : 'none'; }
(async () => {
  const r = await send({ type: 'status' });
  if (!r.ok) {
    $('#dot').className = 'dot err';
    $('#st').textContent = 'Chưa kết nối app MDub';
    $('#info').textContent = 'Mở app MDub trên máy tính rồi thử lại. Nếu vừa cài, tải lại trang YouTube.';
    $('#show').disabled = true;
    return;
  }
  const s = r.data;
  $('#dot').className = 'dot on';
  $('#st').textContent = 'Đã kết nối app MDub v' + s.version;
  $('#info').textContent = !s.ready ? 'Chưa tải giọng đọc — mở app MDub để tải.' : !s.hasApiKey ? 'Chưa nhập API key Claude — mở app MDub → Cài đặt.' :
    `Giọng: ${s.settings.voice} · Thuyết minh ${s.settings.enabled === false ? 'đang tắt' : 'đang bật'}. Mở video YouTube và bấm nút VI.`;
  showUpdate(s.update);
})();
$('#show').addEventListener('click', () => send({ type: 'showApp' }));
$('#upd').addEventListener('click', async () => {
  $('#upd').textContent = 'Đang kiểm tra…';
  const r = await send({ type: 'checkUpdate' });
  const u = r.ok ? r.data : null;
  showUpdate(u);
  $('#upd').textContent = !u ? 'Lỗi kết nối' : u.status === 'latest' ? 'Đã là bản mới nhất' : u.status === 'available' ? 'Có bản mới v' + u.latest : 'Kiểm tra cập nhật';
});
