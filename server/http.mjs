import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { RequestError } from './jobs.mjs';

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/config.js': ['config.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'], '/network-test.zip': ['network-test.zip', 'application/zip'] };

async function jsonBody(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new RequestError(415, 'Send the scenario as JSON.');
  if (Number(req.headers['content-length']) > 4096) throw new RequestError(413, 'The request is too large.');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 4096) throw new RequestError(413, 'The request is too large.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new RequestError(400, 'Invalid scenario request.'); }
}
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };

// Known, completed files only. Content-Length and byte ranges support interrupted downloads.
export async function sendFile(req, res, path, type, filename) {
  const info = await stat(path); let start = 0, end = info.size - 1, status = 200;
  res.setHeader('Accept-Ranges', 'bytes');
  if (filename) res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  if (req.headers.range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!m || (!m[1] && !m[2])) { res.setHeader('Content-Range', `bytes */${info.size}`); res.writeHead(416); res.end(); return; }
    if (!m[1]) start = Math.max(0, info.size - Number(m[2]));
    else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) { res.setHeader('Content-Range', `bytes */${info.size}`); res.writeHead(416); res.end(); return; }
    status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
  }
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': end - start + 1 });
  if (req.method === 'HEAD') { res.end(); return; }
  await pipeline(createReadStream(path, { start, end }), res);
}

export function createReplayServer(queue, { allowedOrigins = [] } = {}) {
  const origins = new Set(allowedOrigins);
  return createServer({ requestTimeout: 15_000, headersTimeout: 10_000, maxHeaderSize: 8192 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      const origin = req.headers.origin;
      if (origin) {
        if (!origins.has(origin)) throw new RequestError(403, 'This website is not allowed to request builds.');
        res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (req.method === 'GET' && path === '/api/health') return json(res, 200, { status: 'ok' });
      if (req.method === 'POST' && path === '/api/jobs') return json(res, 202, queue.create(await jsonBody(req)));
      const match = /^\/api\/jobs\/([a-f0-9]{48})(\/download)?$/.exec(path);
      if (match && ['GET', 'HEAD'].includes(req.method)) {
        if (!match[2]) return json(res, 200, queue.get(match[1]));
        const file = queue.download(match[1]); return await sendFile(req, res, file.path, 'application/zip', file.filename);
      }
      if (['GET', 'HEAD'].includes(req.method) && STATIC[path]) {
        const [file, type] = STATIC[path];
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        return await sendFile(req, res, join(PUBLIC, file), type, path.endsWith('.zip') ? file : undefined);
      }
      throw new RequestError(404, 'Page not found.');
    } catch (e) {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      if (!(e instanceof RequestError)) console.error('Request failed:', e.message);
      json(res, e.status || 500, { error: e.status ? e.message : 'The server could not complete this request. Please try again.' });
    }
  });
}
