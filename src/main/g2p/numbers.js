'use strict';
// Đọc số và ký hiệu thành chữ tiếng Việt trước khi chuyển sang phát âm.

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

// Đọc một nhóm 3 chữ số (0..999). `full` = nhóm không đứng đầu → luôn đọc "không trăm".
function readTriple(n, full) {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  const out = [];
  if (h > 0 || full) out.push(DIGITS[h], 'trăm');
  if (t === 0) {
    if (u > 0 && (h > 0 || full)) out.push('linh');
    if (u > 0) out.push(DIGITS[u]);
  } else if (t === 1) {
    out.push('mười');
    if (u === 5) out.push('lăm');
    else if (u > 0) out.push(DIGITS[u]);
  } else {
    out.push(DIGITS[t], 'mươi');
    if (u === 1) out.push('mốt');
    else if (u === 4) out.push('tư');
    else if (u === 5) out.push('lăm');
    else if (u > 0) out.push(DIGITS[u]);
  }
  return out.join(' ');
}

const SCALES = ['', 'nghìn', 'triệu', 'tỷ'];

function readInteger(str) {
  str = String(str).replace(/^0+(?=\d)/, '');
  if (str.length > 12) return str.split('').map((d) => DIGITS[+d]).join(' ');
  const n = Number(str);
  if (n === 0) return 'không';
  const groups = [];
  for (let s = str; s.length; s = s.slice(0, -3)) groups.unshift(Number(s.slice(-3)));
  const out = [];
  groups.forEach((g, i) => {
    const scale = SCALES[groups.length - 1 - i];
    if (g === 0) return;
    out.push(readTriple(g, i > 0));
    if (scale) out.push(scale);
  });
  return out.join(' ');
}

function readDigits(str) {
  return str.split('').map((d) => DIGITS[+d]).join(' ');
}

function readDecimal(intPart, frac) {
  const f = frac.length <= 2 ? readInteger(frac) : readDigits(frac);
  return `${readInteger(intPart)} phẩy ${frac.startsWith('0') && frac.length <= 2 ? readDigits(frac) : f}`;
}

const SYMBOLS = [
  [/&/g, ' và '],
  [/\+/g, ' cộng '],
  [/=/g, ' bằng '],
  [/@/g, ' a còng '],
  [/#(\d)/g, 'số $1'],
  [/\$\s?(\d[\d.,]*)/g, '$1 đô la'],
  [/(\d)\s?€/g, '$1 ơ rô'],
  [/(\d)\s?°C/g, '$1 độ xê'],
];

function normalizeVietnamese(text) {
  let s = String(text || '').normalize('NFC');
  for (const [re, rep] of SYMBOLS) s = s.replace(re, rep);
  // 2D / 3D
  s = s.replace(/\b(\d)\s?D\b/g, (_, d) => `${DIGITS[+d]} đê`);
  // giờ:phút
  s = s.replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h, m) => `${readInteger(h)} giờ${m === '00' ? '' : ' ' + readInteger(m)}`);
  // phần trăm
  s = s.replace(/(\d+(?:[.,]\d+)?)\s?%/g, '$1 phần trăm');
  // số có dấu phân cách hàng nghìn: 1.000.000 hoặc 1,000,000
  s = s.replace(/\b\d{1,3}(?:([.,])\d{3})(?:\1\d{3})*\b(?![.,]\d)/g, (m) => readInteger(m.replace(/[.,]/g, '')));
  // số thập phân
  s = s.replace(/\b(\d+)[.,](\d+)\b/g, (_, a, b) => readDecimal(a, b));
  // số nguyên còn lại
  s = s.replace(/\d+/g, (m) => ` ${readInteger(m)} `);
  return s.replace(/[ \t]+/g, ' ').replace(/ ([,.!?;:])/g, '$1').trim();
}

module.exports = { normalizeVietnamese, readInteger };
