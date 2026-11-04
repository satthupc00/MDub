'use strict';
// Chạy trong Electron utilityProcess (tách khỏi tiến trình chính để giao diện không bị đứng).

const fs = require('fs');
const path = require('path');
const { Kokoro, toWav, SAMPLE_RATE } = require('./kokoro');

let tts = null;
const port = process.parentPort;

async function handle(msg) {
  switch (msg.type) {
    case 'init': {
      tts = new Kokoro({
        modelPath: msg.modelPath,
        voicePathFor: (id) => msg.voices[id] || null,
        useGpu: msg.useGpu,
      });
      return tts.init();
    }
    case 'synth': {
      if (!tts) throw new Error('Kokoro chưa sẵn sàng');
      const base = msg.speed || 1;
      let speed = base;
      let audio = await tts.synth(msg.text, msg.voice, speed);
      let dur = audio.length / SAMPLE_RATE;
      // Nếu câu đọc dài hơn khoảng trống trong video → đọc nhanh hơn (giữ nguyên cao độ)
      if (msg.slot && dur > msg.slot * 1.03 && msg.maxSpeed > base) {
        speed = Math.min(msg.maxSpeed, base * (dur / msg.slot) * 1.02);
        audio = await tts.synth(msg.text, msg.voice, speed);
        dur = audio.length / SAMPLE_RATE;
      }
      const wav = toWav(audio, msg.volume || 1);
      if (msg.out) {
        fs.mkdirSync(path.dirname(msg.out), { recursive: true });
        fs.writeFileSync(msg.out + '.tmp', wav);
        fs.renameSync(msg.out + '.tmp', msg.out);
        return { dur, speed };
      }
      return { dur, speed, wav: wav.toString('base64') };
    }
    default:
      throw new Error('Lệnh không hợp lệ: ' + msg.type);
  }
}

let chain = Promise.resolve();
port.on('message', (e) => {
  const msg = e.data;
  chain = chain.then(async () => {
    try {
      port.postMessage({ id: msg.id, ok: true, result: await handle(msg) });
    } catch (err) {
      port.postMessage({ id: msg.id, ok: false, error: String((err && err.message) || err) });
    }
  });
});
