import { JobQueue } from './jobs.mjs';
import { createReplayServer } from './http.mjs';

function setting(key, fallback, min, max) {
  const n = Number(process.env[key] || fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw Error(`Invalid ${key}`);
  return n;
}
const port = setting('PORT', 10000, 1, 65535);
const queue = new JobQueue({ dataDir: process.env.REPLAY_DATA_DIR || './outputs/render',
  maxPending: setting('REPLAY_MAX_PENDING', 5, 1, 50), dailyLimit: setting('REPLAY_DAILY_LIMIT', 20, 1, 200),
  retentionHours: setting('REPLAY_RETENTION_HOURS', 24, 1, 168) });
const allowedOrigins = (process.env.REPLAY_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
if (process.env.RENDER_EXTERNAL_URL) allowedOrigins.push(new URL(process.env.RENDER_EXTERNAL_URL).origin);
if (!process.env.RENDER) allowedOrigins.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`);
const server = createReplayServer(queue, { allowedOrigins });
server.listen(port, '0.0.0.0', () => console.log(`Launch Weather Replay listening on ${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => {
  server.close(); await queue.close(); server.closeAllConnections(); process.exit(0);
});
