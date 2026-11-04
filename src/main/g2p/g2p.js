'use strict';
// Chuyển văn bản tiếng Việt (có lẫn thuật ngữ tiếng Anh) sang ký hiệu phát âm cho Kokoro-Vietnamese.
// Port JavaScript của vig2p 0.1.2 (github.com/iamdinhthuan/Kokoro-Vietnamese dùng thư viện này).
// Phần tra từ dùng bảng lexicon.json sinh sẵn từ vig2p + sea-g2p (xem scripts/gen_lexicon.py),
// nên kết quả trùng khớp với bản Python cho mọi âm tiết tiếng Việt và ~39k từ tiếng Anh thông dụng.

const path = require('path');
const fs = require('fs');
const { normalizeVietnamese } = require('./numbers');

const VI_FIXUPS = [
  ['tʃ', 'ʧ'], ['t̪', ''], ['', 't'], ['e-', 'æ'],
  ['1', '→'], ['7', '→'], ['2', '↘'], ['ɜ', '↗'], ['3', '↗'], ['4', '↓'], ['5', 'ʔ↗'], ['6', 'ʔ↓'],
  ['ɗ', 'd'], ['ʐ', 'ʒ'], ['̪', ''], ['-', ''], ['–', '—'], ['*', ''], ['/', ' '], ['&', ' '],
  ["'", ''], ['’', ''], ['‘', ''], ['đ', 'd'], ['̩', ''],
];

const L = 'A-Za-zÀ-ỹĐđ';
const TEXT_TOKEN_RE = new RegExp(`[${L}]+(?:[-'][${L}]+)*|\\s+|.`, 'gsu');
const WORD_RE = new RegExp(`^[${L}]+(?:[-'][${L}]+)*$`, 'u');

function fixPhonemes(p) {
  for (const [a, b] of VI_FIXUPS) p = p.split(a).join(b);
  return p;
}

// Tên chữ cái tiếng Anh, dùng để đánh vần từ viết tắt (GPU, PNG…)
const EN_LETTERS = {
  a: 'eɪ', b: 'biː', c: 'siː', d: 'diː', e: 'iː', f: 'ɛf', g: 'dʒiː', h: 'eɪtʃ', i: 'aɪ', j: 'dʒeɪ',
  k: 'keɪ', l: 'ɛl', m: 'ɛm', n: 'ɛn', o: 'oʊ', p: 'piː', q: 'kjuː', r: 'ɑːɹ', s: 'ɛs', t: 'tiː',
  u: 'juː', v: 'viː', w: 'dʌbəljuː', x: 'ɛks', y: 'waɪ', z: 'ziː',
};

// Đọc thô một từ lạ theo kiểu tiếng Anh (khi không có trong từ điển).
const ROUGH = [
  ['tion', 'ʃən'], ['sh', 'ʃ'], ['ch', 'ʧ'], ['th', 'θ'], ['ph', 'f'], ['ck', 'k'], ['ng', 'ŋ'],
  ['ee', 'iː'], ['ea', 'iː'], ['oo', 'uː'], ['ou', 'aʊ'], ['ow', 'oʊ'], ['ai', 'eɪ'], ['ay', 'eɪ'],
  ['oa', 'oʊ'], ['qu', 'kw'], ['a', 'æ'], ['e', 'ɛ'], ['i', 'ɪ'], ['o', 'ɒ'], ['u', 'ʌ'], ['y', 'i'],
  ['c', 'k'], ['j', 'ʤ'], ['q', 'k'], ['x', 'ks'], ['r', 'ɹ'], ['g', 'ɡ'],
];
function roughEnglish(word) {
  let w = word.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  let out = '';
  while (w.length) {
    const hit = ROUGH.find(([g]) => w.startsWith(g));
    if (hit) { out += hit[1]; w = w.slice(hit[0].length); } else { out += w[0]; w = w.slice(1); }
  }
  return 'ˈ' + out;
}

function spellAcronym(word) {
  const parts = word.toLowerCase().split('').map((c) => EN_LETTERS[c] || c);
  return parts.map((p, i) => (i === parts.length - 1 ? 'ˈ' : 'ˌ') + p).join('');
}

class VietnameseG2P {
  constructor(lexiconPath) {
    const file = lexiconPath || path.join(__dirname, 'lexicon.json');
    this.words = JSON.parse(fs.readFileSync(file, 'utf8')).words;
  }

  lookup(token) {
    // camelCase: YouTube, iPhone → tách ra (giống sea-g2p)
    const camel = token.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2');
    if (camel !== token) return camel.split(' ').map((p) => this.lookup(p)).join(' ');
    const hit = this.words[token.toLowerCase()];
    if (hit !== undefined) return hit;
    // Từ viết tắt viết hoa: GPU, PNG, FBX
    if (/^[A-Z]{2,6}$/.test(token)) return spellAcronym(token);
    // Từ ghép bằng gạch nối hoặc dấu nháy: tra từng phần
    if (/[-']/.test(token)) {
      const parts = token.split(/[-']/).filter(Boolean);
      return parts.map((p) => this.lookup(p)).join(' ');
    }
    if (/^[A-Z]$/.test(token)) return spellAcronym(token);
    return roughEnglish(token);
  }

  phonemize(text) {
    const pieces = [];
    text = String(text).normalize('NFC').replace(/[’‘]/g, "'");
    for (const token of text.match(TEXT_TOKEN_RE) || []) {
      if (/^\s+$/u.test(token)) pieces.push(' ');
      else if (WORD_RE.test(token)) pieces.push(this.lookup(token));
      else pieces.push(fixPhonemes(token));
    }
    return pieces.join('').trim();
  }

  // Văn bản thô → chuẩn hoá số/ký hiệu → phát âm
  convert(text) {
    return this.phonemize(normalizeVietnamese(text));
  }
}

module.exports = { VietnameseG2P, fixPhonemes, normalizeVietnamese };
