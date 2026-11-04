'use strict';
// Chuyển phụ đề (YouTube json3, WebVTT, SRT, TTML/DFXP) thành danh sách câu có thời gian.

const SOUND_TAG = /^\s*[\[(][^\])]*[\])]\s*$/; // [Music], (Applause)

function clean(t) {
  return t.replace(/​/g, '').replace(/>>+/g, ' ').replace(/\s+/g, ' ').trim();
}

function piecesFromJson3(json) {
  const events = (json && json.events) || [];
  const pieces = [];
  let asr = false;
  for (const ev of events) {
    if (!ev.segs || ev.aAppend) continue;
    const evStart = ev.tStartMs || 0;
    const evEnd = evStart + (ev.dDurationMs || 0);
    const segs = ev.segs.filter((s) => s.utf8 && s.utf8 !== '\n');
    if (!segs.length) continue;
    if (segs.some((s) => s.tOffsetMs !== undefined)) asr = true;
    if (segs.length > 1 || segs[0].tOffsetMs !== undefined) {
      segs.forEach((s, k) => {
        const start = evStart + (s.tOffsetMs || 0);
        const next = segs[k + 1];
        const end = next ? evStart + (next.tOffsetMs || 0) : Math.min(evEnd, start + 700);
        pieces.push({ start, end, text: s.utf8 });
      });
    } else {
      pieces.push({ start: evStart, end: evEnd, text: segs[0].utf8 });
    }
  }
  pieces.sort((a, b) => a.start - b.start);
  // sửa end của từng mảnh không vượt quá mảnh kế tiếp (phụ đề tự động hay chồng lên nhau)
  for (let i = 0; i < pieces.length - 1; i++) {
    if (pieces[i].end > pieces[i + 1].start) pieces[i].end = Math.max(pieces[i].start + 100, pieces[i + 1].start);
  }
  return {
    asr,
    pieces: pieces
      .map((p) => ({ ...p, text: clean(p.text.replace(/\n/g, ' ')) }))
      .filter((p) => p.text && !SOUND_TAG.test(p.text)),
  };
}

// ---------- WebVTT / SRT / TTML ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(t) {
  return t.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}

// Bỏ thẻ, ghi chú âm thanh [tiếng cửa], gạch đầu dòng hội thoại, tên người nói "JOHN:"
function cleanSubText(t) {
  return decodeEntities(String(t).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .split('\n')
    .map((l) => l.replace(/\[[^\]]*\]|\([^)]*\)|♪[^♪]*♪?/g, ' ').replace(/^\s*[-–]\s*/, '').replace(/^[A-ZÀ-Ỹ][A-ZÀ-Ỹ .'-]{1,24}:\s*/, '').trim())
    .filter(Boolean)
    .join(' ');
}

function clockToMs(t) {
  t = String(t).trim().replace(',', '.');
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (m) return Math.round(((+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3]) * 1000);
  const s = t.match(/^(\d+(?:\.\d+)?)s$/);
  if (s) return Math.round(+s[1] * 1000);
  const ms = t.match(/^(\d+(?:\.\d+)?)ms$/);
  if (ms) return Math.round(+ms[1]);
  return NaN;
}

function piecesFromVtt(text) {
  const pieces = [];
  const blocks = String(text).replace(/\r/g, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split('\n');
    const k = lines.findIndex((l) => l.includes('-->'));
    if (k < 0) continue;
    const [a, z] = lines[k].split('-->');
    const start = clockToMs(a), end = clockToMs(z.trim().split(/\s+/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const t = cleanSubText(lines.slice(k + 1).join('\n'));
    if (t) pieces.push({ start, end, text: t });
  }
  return pieces;
}

function ttmlTime(v, tickRate, frameRate) {
  if (!v) return NaN;
  const t = v.match(/^(\d+(?:\.\d+)?)t$/);
  if (t) return Math.round((+t[1] / tickRate) * 1000);
  const f = v.match(/^(\d+):(\d{2}):(\d{2}):(\d+)$/);
  if (f) return Math.round(((+f[1]) * 3600 + +f[2] * 60 + +f[3] + +f[4] / frameRate) * 1000);
  return clockToMs(v);
}

function piecesFromTtml(xml) {
  xml = String(xml);
  const tick = +((xml.match(/tickRate="(\d+)"/) || [])[1] || 10000000);
  const fr = +((xml.match(/frameRate="(\d+)"/) || [])[1] || 30);
  const pieces = [];
  const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const begin = ttmlTime((attrs.match(/\bbegin="([^"]+)"/) || [])[1], tick, fr);
    let end = ttmlTime((attrs.match(/\bend="([^"]+)"/) || [])[1], tick, fr);
    const dur = ttmlTime((attrs.match(/\bdur="([^"]+)"/) || [])[1], tick, fr);
    if (!Number.isFinite(end) && Number.isFinite(dur)) end = begin + dur;
    if (!Number.isFinite(begin) || !Number.isFinite(end)) continue;
    const t = cleanSubText(m[2]);
    if (t) pieces.push({ start: begin, end, text: t });
  }
  return pieces;
}

// Nhận phụ đề ở bất kỳ định dạng nào → mảnh {start,end,text} (ms)
function piecesFrom(format, data) {
  switch (format) {
    case 'json3': return piecesFromJson3(typeof data === 'string' ? JSON.parse(data) : data);
    case 'vtt': case 'srt': return { asr: false, pieces: piecesFromVtt(data) };
    case 'ttml': case 'dfxp': case 'xml': return { asr: false, pieces: piecesFromTtml(data) };
    default: {
      const s = String(data || '').trimStart();
      if (s.startsWith('{')) return piecesFromJson3(JSON.parse(s));
      if (s.startsWith('<')) return { asr: false, pieces: piecesFromTtml(s) };
      return { asr: false, pieces: piecesFromVtt(s) };
    }
  }
}

function sortPieces(pieces) {
  pieces.sort((a, b) => a.start - b.start);
  // gộp các dòng trùng nhau (phụ đề cuộn lặp lại dòng cũ)
  const out = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && last.text === p.text && p.start - last.end < 300) { last.end = Math.max(last.end, p.end); continue; }
    out.push({ ...p });
  }
  return out;
}

// Gộp các mảnh thành câu hoàn chỉnh: tốt cho dịch theo ngữ cảnh và đọc tự nhiên.
// Gọi kiểu cũ buildCues(json3) hoặc buildCues({format, data})
function buildCues(input, opts = {}) {
  let res;
  if (input && input.format !== undefined && input.data !== undefined) res = piecesFrom(input.format, input.data);
  else res = piecesFromJson3(input);
  const asr = res.asr;
  const pieces = asr ? res.pieces : sortPieces(res.pieces).filter((p) => !SOUND_TAG.test(p.text));
  const maxDur = (opts.maxDur || 9) * 1000;
  const maxWords = opts.maxWords || 30;
  const gapBreak = (asr ? 0.7 : 1.2) * 1000;
  const cues = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.text.trim()) cues.push(cur);
    cur = null;
  };
  pieces.forEach((p, k) => {
    if (!cur) cur = { start: p.start, end: p.end, text: p.text };
    else {
      cur.text += ' ' + p.text;
      cur.end = Math.max(cur.end, p.end);
    }
    const next = pieces[k + 1];
    const words = cur.text.split(/\s+/).length;
    const endsSentence = /[.!?…]["”’)]*$/.test(cur.text) && words >= 3;
    const gap = next ? next.start - p.end : Infinity;
    if (!next || endsSentence || gap > gapBreak || cur.end - cur.start > maxDur || words >= maxWords) flush();
  });
  flush();
  return {
    asr,
    cues: cues.map((c, i) => ({
      i,
      start: +(c.start / 1000).toFixed(3),
      end: +(c.end / 1000).toFixed(3),
      en: c.text.replace(/\s+([,.!?;:])/g, '$1'),
    })),
  };
}

// Khoảng thời gian có thể đọc cho mỗi câu (tới khi câu sau bắt đầu).
function slotOf(cues, i) {
  const c = cues[i];
  const next = cues[i + 1];
  const limit = next ? next.start : c.end + 1.5;
  return Math.max(0.6, Math.min(limit, c.end + 1.5) - c.start);
}

module.exports = { buildCues, piecesFromJson3, piecesFrom, piecesFromVtt, piecesFromTtml, cleanSubText, slotOf };
