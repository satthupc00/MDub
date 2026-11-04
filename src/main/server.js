'use strict';
// Cổng nội bộ 127.0.0.1 cho extension Chrome nói chuyện với app.
// Chỉ nhận yêu cầu có header X-MDub-Token đúng (token ghi sẵn vào thư mục extension).

const http = require('http');
const fs = require('fs');

const PORTS = [47821, 47822, 47823, 47824, 47825];

function send(res, code, body, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function createServer({ token, handlers }) {
  const server = http.createServer(async (req, res) => {
    // Không có header CORS → trang web lạ không gọi được. Extension có quyền host nên gọi bình thường.
    if (req.headers['x-mdub-token'] !== token()) return send(res, 401, { error: 'unauthorized' });
    const url = new URL(req.url, 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (req.method === 'GET' && url.pathname === '/status') return send(res, 200, await handlers.status());
      if (req.method === 'POST' && url.pathname === '/open') return send(res, 200, await handlers.open(await readBody(req)));
      if (req.method === 'GET' && parts[0] === 'job' && parts[1]) return send(res, 200, handlers.job(parts[1]));
      if (req.method === 'POST' && url.pathname === '/cursor') { const b = await readBody(req); handlers.cursor(b.videoId, b.t); return send(res, 200, { ok: true }); }
      if (req.method === 'GET' && parts[0] === 'audio' && parts[1] && parts[2] !== undefined) {
        const file = handlers.audio(parts[1], parts[2], url.searchParams.get('v'));
        if (!file) return send(res, 404, { error: 'not ready' });
        return send(res, 200, fs.readFileSync(file), 'audio/wav');
      }
      if (req.method === 'POST' && url.pathname === '/settings') return send(res, 200, handlers.settings(await readBody(req)));
      if (req.method === 'POST' && url.pathname === '/update/check') return send(res, 200, await handlers.checkUpdate());
      if (req.method === 'POST' && url.pathname === '/show') { handlers.show(); return send(res, 200, { ok: true }); }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: String((e && e.message) || e) });
    }
  });

  return new Promise((resolve, reject) => {
    let k = 0;
    const tryNext = () => {
      if (k >= PORTS.length) return reject(new Error('Không mở được cổng nội bộ cho extension'));
      const port = PORTS[k++];
      server.once('error', tryNext);
      server.listen(port, '127.0.0.1', () => { server.removeAllListeners('error'); resolve({ server, port }); });
    };
    tryNext();
  });
}

module.exports = { createServer, PORTS };
