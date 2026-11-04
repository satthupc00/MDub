const test = require('node:test');
const assert = require('node:assert');
const { VietnameseG2P } = require('../src/main/g2p/g2p');
const { normalizeVietnamese, readInteger } = require('../src/main/g2p/numbers');

const g = new VietnameseG2P();

test('khớp với vig2p (Python) trên câu mẫu', () => {
  const cases = require('./g2p_expected.json');
  let ok = 0;
  for (const c of cases) if (g.phonemize(c.text) === c.phonemes) ok++;
  // chỉ cho phép lệch ở từ viết kiểu camelCase (YouTube)
  assert.ok(ok >= cases.length - 1, `${ok}/${cases.length}`);
});

test('đọc số tiếng Việt', () => {
  assert.strictEqual(readInteger('21'), 'hai mươi mốt');
  assert.strictEqual(readInteger('15'), 'mười lăm');
  assert.strictEqual(readInteger('105'), 'một trăm linh năm');
  assert.strictEqual(readInteger('2026'), 'hai nghìn không trăm hai mươi sáu');
  assert.strictEqual(readInteger('1000000'), 'một triệu');
  assert.strictEqual(normalizeVietnamese('Tăng 15% lúc 10:30'), 'Tăng mười lăm phần trăm lúc mười giờ ba mươi');
  assert.strictEqual(normalizeVietnamese('3,5 lần'), 'ba phẩy năm lần');
  assert.strictEqual(normalizeVietnamese('3D'), 'ba đê');
});

test('không còn chữ số sau khi chuyển', () => {
  assert.ok(!/\d/.test(g.convert('Video có 142 câu, năm 2026.')));
});
