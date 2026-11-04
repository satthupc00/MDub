const test = require('node:test');
const assert = require('node:assert');
const { buildCues, slotOf } = require('../src/main/captions');

test('phụ đề thủ công: gộp thành câu', () => {
  const json = { events: [
    { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: 'First, let\'s create' }] },
    { tStartMs: 1500, dDurationMs: 1500, segs: [{ utf8: 'a mesh for the arm.' }] },
    { tStartMs: 3200, dDurationMs: 800, segs: [{ utf8: '[Music]' }] },
    { tStartMs: 4200, dDurationMs: 2000, segs: [{ utf8: 'Then bind it.' }] },
  ] };
  const { cues, asr } = buildCues(json);
  assert.strictEqual(asr, false);
  assert.strictEqual(cues.length, 2);
  assert.strictEqual(cues[0].en, "First, let's create a mesh for the arm.");
  assert.strictEqual(cues[1].start, 4.2);
  assert.ok(slotOf(cues, 0) >= 3);
});

test('phụ đề tự động: tách theo khoảng lặng', () => {
  const json = { events: [
    { tStartMs: 0, dDurationMs: 4000, wWinId: 1, segs: [{ utf8: 'so', tOffsetMs: 0 }, { utf8: ' today', tOffsetMs: 300 }, { utf8: ' we', tOffsetMs: 600 }, { utf8: ' rig', tOffsetMs: 900 }] },
    { tStartMs: 1500, dDurationMs: 10, aAppend: 1, segs: [{ utf8: '\n' }] },
    { tStartMs: 3000, dDurationMs: 2000, wWinId: 1, segs: [{ utf8: 'next', tOffsetMs: 0 }, { utf8: ' part', tOffsetMs: 400 }] },
  ] };
  const { cues, asr } = buildCues(json);
  assert.strictEqual(asr, true);
  assert.strictEqual(cues.length, 2);
  assert.strictEqual(cues[0].en, 'so today we rig');
  assert.strictEqual(cues[1].en, 'next part');
});

test('WebVTT phim: bỏ thẻ, ghi chú âm thanh, tên người nói', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.500 align:start\n<i>- Anh không định đi đâu cả.</i>\n\n00:00:04.000 --> 00:00:06.000\n[TIẾNG CỬA]\n\n00:00:06.500 --> 00:00:08.000\nJOHN: Thật sao?\n- Ừ, thật.';
  const { cues } = buildCues({ format: 'vtt', data: vtt });
  assert.deepStrictEqual(cues.map((c) => c.en), ['Anh không định đi đâu cả.', 'Thật sao? Ừ, thật.']);
});

test('TTML Netflix (tick) và SRT', () => {
  const ttml = '<tt ttp:tickRate="10000000"><body><div><p begin="10000000t" end="35000000t">Hello<br/>there friend.</p><p begin="00:00:05.000" end="00:00:07.000"><span>I&apos;m <span>here</span> now!</span></p></div></body></tt>';
  const a = buildCues({ format: 'ttml', data: ttml }).cues;
  assert.strictEqual(a[0].start, 1); assert.strictEqual(a[0].end, 3.5);
  assert.strictEqual(a[1].en, "I'm here now!");
  const srt = '1\n00:00:01,000 --> 00:00:02,000\nHi there you.\n\n2\n00:00:05,500 --> 00:00:07,000\nHow are you?';
  const b = buildCues({ format: 'srt', data: srt }).cues;
  assert.strictEqual(b.length, 2); assert.strictEqual(b[1].start, 5.5);
});
