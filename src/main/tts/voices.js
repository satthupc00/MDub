'use strict';

const VOICES = [
  { id: 'diem_trinh', name: 'Diễm Trinh' },
  { id: 'duc_an', name: 'Đức An' },
  { id: 'duc_duy', name: 'Đức Duy' },
  { id: 'hung_thinh', name: 'Hưng Thịnh' },
  { id: 'mai_linh', name: 'Mai Linh' },
  { id: 'mai_loan', name: 'Mai Loan' },
  { id: 'manh_dung', name: 'Mạnh Dũng' },
  { id: 'my_yen', name: 'Mỹ Yến' },
  { id: 'ngoc_huyen', name: 'Ngọc Huyền' },
  { id: 'phat_tai', name: 'Phát Tài' },
  { id: 'storyvert', name: 'Storyvert' },
  { id: 'thanh_dat', name: 'Thành Đạt' },
  { id: 'thuc_trinh', name: 'Thục Trinh' },
  { id: 'tuan_ngoc', name: 'Tuấn Ngọc' },
];

const DEFAULT_VOICE = 'ngoc_huyen';

module.exports = { VOICES, DEFAULT_VOICE, VOICE_IDS: VOICES.map((v) => v.id) };
