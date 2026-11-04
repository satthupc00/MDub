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
