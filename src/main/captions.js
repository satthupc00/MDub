'use strict';
// Chuyển phụ đề YouTube (định dạng json3) thành danh sách câu có thời gian.

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

// Gộp các mảnh thành câu hoàn chỉnh: tốt cho dịch theo ngữ cảnh và đọc tự nhiên.
function buildCues(json, opts = {}) {
  const { pieces, asr } = piecesFromJson3(json);
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

module.exports = { buildCues, piecesFromJson3, slotOf };
