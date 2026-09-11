import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, statSync, statfsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { configFromEnv } from '../scripts/scenario-job.ts';

const DAY = 86_400_000;
const PROJECT = fileURLToPath(new URL('../', import.meta.url));
export class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function scenarioRequest(body) {
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new RequestError(400, 'Choose a scenario.');
  const fields = ['start', 'end', 'radar', 'winds', 'fieldmills', 'merlin', 'windHeight', 'trail', 'allowPartial'];
  if (Object.keys(body).some(k => !fields.includes(k))) throw new RequestError(400, 'Unknown scenario setting.');
  for (const k of ['start', 'end', 'radar', 'windHeight']) if (typeof body[k] !== 'string' || body[k].length > 32) throw new RequestError(400, `Invalid ${k}.`);
  for (const k of ['start', 'end']) if (!/^\d{4}-\d\d-\d\dT\d\d:\d\dZ?$/.test(body[k])) throw new RequestError(400, 'Use a date and 24-hour UTC time, to the minute.');
  if (!body.radar.trim()) throw new RequestError(400, 'Enter a radar identifier.');
  for (const k of ['winds', 'fieldmills', 'merlin', 'allowPartial']) if (typeof body[k] !== 'boolean') throw new RequestError(400, `Invalid ${k}.`);
  if (typeof body.trail !== 'number') throw new RequestError(400, 'Invalid lightning trail.');
  const env = {
    SCENARIO_START: body.start, SCENARIO_END: body.end, SCENARIO_RADAR: body.radar,
    SCENARIO_WINDS: String(body.winds), SCENARIO_FIELDMILLS: String(body.fieldmills), SCENARIO_MERLIN: String(body.merlin),
    SCENARIO_WIND_HEIGHT: body.windHeight, SCENARIO_TRAIL: String(body.trail), SCENARIO_ALLOW_PARTIAL: String(body.allowPartial),
  };
  try {
    const c = configFromEnv(env);
    if (c.layers.length && Date.parse(c.start) < Date.UTC(2000, 0, 1)) throw Error('Automatic KSC requests support dates from 2000. For earlier dates, select radar only.');
    return { ...env, SCENARIO_START: c.start, SCENARIO_END: c.end, SCENARIO_RADAR: c.radar };
  } catch (e) { throw new RequestError(400, e.message); }
}

// The builder runs in a separate process; it cannot block health checks or downloads.
export function runChild(job, directory, progress, signal) {
  return new Promise((resolveJob, reject) => {
    const temp = join(directory, 'work'); mkdirSync(temp, { recursive: true });
    const child = spawn(process.execPath, ['--max-old-space-size=1400', '--import', 'tsx', 'scripts/scenario-job.ts'], {
      cwd: PROJECT, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
        NODE_USE_SYSTEM_CA: '1', ...job.env, TMPDIR: temp,
        SCENARIO_OUTPUT: join(directory, 'output'), SCENARIO_RESULT_PATH: join(directory, 'result.json') },
    });
    let lastError = '', pending = '';
    const stop = () => { try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    child.stdout.on('data', chunk => {
      pending = (pending + chunk.toString()).slice(-8000);
      const lines = pending.split(/[\r\n]+/); pending = lines.pop();
      for (const line of lines) if (line.trim()) progress(line.slice(0, 500));
    });
    child.stderr.on('data', chunk => { lastError = (lastError + chunk.toString()).slice(-2000); });
    child.on('error', reject);
    child.on('close', code => {
      signal.removeEventListener('abort', stop);
      if (signal.aborted) return reject(Error('Build interrupted or exceeded two hours. Try a shorter window.'));
      if (code !== 0) return reject(Error(lastError.trim() || 'The build stopped before a complete ZIP was ready. Try a shorter window.'));
      try { resolveJob(JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'))); } catch (e) { reject(e); }
    });
  });
}

// One service owns this disk. Atomic metadata writes keep queue state across restarts.
export class JobQueue {
  constructor({ dataDir, runner = runChild, maxPending = 5, dailyLimit = 20, retentionHours = 24,
    reserveBytes = 4_200_000_000, timeoutMs = 2 * 60 * 60_000 } = {}) {
    this.root = resolve(dataDir); mkdirSync(this.root, { recursive: true });
    this.runner = runner; this.maxPending = maxPending; this.dailyLimit = dailyLimit;
    this.retentionMs = retentionHours * 3_600_000; this.reserveBytes = reserveBytes; this.timeoutMs = timeoutMs;
    this.jobs = new Map(); this.active = null; this.closed = false;
    for (const id of readdirSync(this.root).filter(n => /^[a-f0-9]{48}$/.test(n))) {
      const path = join(this.root, id, 'job.json');
      // An interrupted initial admission may leave only an empty directory.
      let job; try { job = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') { rmSync(join(this.root, id), { recursive: true, force: true }); continue; } throw e; }
      if (job.id !== id) throw Error('Invalid saved job metadata.');
      this.jobs.set(id, job);
      if (job.state === 'running') {
        job.state = 'failed'; job.message = 'The service restarted during this build. Submit the scenario again.';
        job.finishedAt = Date.now(); this.save(job);
      }
      rmSync(join(this.root, id, 'work'), { recursive: true, force: true });
      if (job.state !== 'complete') rmSync(join(this.root, id, 'output'), { recursive: true, force: true });
    }
    this.cleanup();
    this.timer = setInterval(() => { try { this.cleanup(); this.kick(); } catch (e) { console.error('Queue maintenance:', e.message); } }, 60_000);
    this.timer.unref(); this.kick();
  }
  save(job) {
    const dir = join(this.root, job.id); mkdirSync(dir, { recursive: true });
    const path = join(dir, 'job.json'); writeFileSync(path + '.tmp', JSON.stringify(job)); renameSync(path + '.tmp', path);
  }
  create(body) {
    if (this.closed) throw new RequestError(503, 'The service is restarting. Please try again shortly.');
    const env = scenarioRequest(body);
    const jobs = [...this.jobs.values()], now = Date.now();
    if (jobs.filter(j => ['queued', 'running'].includes(j.state)).length >= this.maxPending) throw new RequestError(429, 'The build queue is full. Please try again later.');
    if (jobs.filter(j => j.createdAt > now - DAY).length >= this.dailyLimit) throw new RequestError(429, 'Today’s build limit has been reached. Please try again tomorrow.');
    if (!this.hasSpace()) throw new RequestError(503, 'Download storage is full. Space becomes available as older downloads expire. Please try again later.');
    const job = { id: randomBytes(24).toString('hex'), env, state: 'queued', message: 'Waiting to build.', createdAt: now };
    this.save(job); this.jobs.set(job.id, job); this.kick(); return this.get(job.id);
  }
  get(id) {
    const j = this.jobs.get(id); if (!j) throw new RequestError(404, 'This build was not found or has expired.');
    const queue = [...this.jobs.values()].filter(x => x.state === 'queued').sort((a, b) => a.createdAt - b.createdAt);
    return { id: j.id, state: j.state, message: j.message, createdAt: j.createdAt,
      start: j.env.SCENARIO_START, end: j.env.SCENARIO_END, radar: j.env.SCENARIO_RADAR,
      position: j.state === 'queued' ? queue.findIndex(x => x.id === id) + 1 : null,
      filename: j.filename, size: j.size, missing: j.missing, radarVolumes: j.radarVolumes, expiresAt: j.expiresAt };
  }
  download(id) {
    const j = this.jobs.get(id);
    if (!j || j.state === 'expired' || j.expiresAt <= Date.now()) throw new RequestError(410, 'This download has expired. Build the scenario again.');
    if (j.state !== 'complete') throw new RequestError(409, 'The ZIP is not ready. Wait for the build to finish.');
    return { path: join(this.root, id, 'output', j.filename), filename: j.filename };
  }
  hasSpace() { const s = statfsSync(this.root); return s.bavail * s.bsize >= this.reserveBytes; }
  cleanup() {
    const now = Date.now();
    for (const j of this.jobs.values()) {
      if (j.state === 'complete' && j.expiresAt <= now) {
        rmSync(join(this.root, j.id, 'output'), { recursive: true, force: true });
        j.state = 'expired'; j.message = 'The download has expired. Build the scenario again.'; this.save(j);
      }
      if (!['queued', 'running', 'complete'].includes(j.state) && now - j.createdAt > Math.max(2 * DAY, this.retentionMs)) {
        rmSync(join(this.root, j.id), { recursive: true, force: true }); this.jobs.delete(j.id);
      }
    }
  }
  kick() {
    if (this.active || this.closed) return;
    this.active = Promise.resolve().then(() => this.drain()).catch(e => console.error('Queue error:', e.message)).finally(() => { this.active = null; });
  }
  async drain() {
    for (;;) {
      if (this.closed) return;
      const job = [...this.jobs.values()].filter(j => j.state === 'queued').sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!job) return;
      if (!this.hasSpace()) { job.message = 'Waiting for older downloads to expire and free storage.'; this.save(job); return; }
      job.state = 'running'; job.message = 'Retrieving archived observations.'; this.save(job);
      const directory = join(this.root, job.id);
      const abort = new AbortController(); this.abort = abort;
      const timer = setTimeout(() => abort.abort(), this.timeoutMs);
      try {
        const result = await this.runner(job, directory, message => { job.message = message; }, abort.signal);
        if (abort.signal.aborted) throw Error('Build interrupted. Please try again.');
        if (!/^[A-Za-z0-9-]+\.zip$/.test(result.filename)) throw Error('Invalid output filename.');
        const s = statSync(join(directory, 'output', result.filename));
        if (!s.isFile() || s.size !== result.size || s.size < 22 || s.size > 2_000_000_000) throw Error('The completed ZIP failed its size check.');
        Object.assign(job, { filename: result.filename, size: result.size, missing: result.missing, radarVolumes: result.radarVolumes,
          state: 'complete', message: result.missing.length ? 'Partial ZIP ready. Review the missing sources below.' : 'ZIP ready. All archive entries passed integrity checks.', expiresAt: Date.now() + this.retentionMs });
      } catch (e) {
        job.state = 'failed'; job.message = e.message.slice(-2000);
        rmSync(join(directory, 'output'), { recursive: true, force: true });
      } finally {
        clearTimeout(timer); this.abort = null;
        rmSync(join(directory, 'work'), { recursive: true, force: true });
        rmSync(join(directory, 'result.json'), { force: true });
        job.finishedAt = Date.now(); this.save(job);
      }
    }
  }
  async close() { this.closed = true; clearInterval(this.timer); this.abort?.abort(); await this.active; }
}
