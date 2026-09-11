import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { JobQueue, scenarioRequest } from '../server/jobs.mjs';
import { createReplayServer } from '../server/http.mjs';

const body = { start: '2024-06-25T21:00', end: '2024-06-25T21:30', radar: 'KMLB', winds: true, fieldmills: true, merlin: true, windHeight: '54', trail: 60, allowPartial: false };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

test('public API queues serial builds, rejects bad requests, and serves exact completed ZIP bytes and ranges', async () => {
  const root = await mkdtemp(join(tmpdir(), 'public-server-'));
  const gate = deferred(), started: string[] = []; let running = 0, peak = 0;
  const runner = async (job: any, directory: string, progress: (s: string) => void) => {
    started.push(job.id); peak = Math.max(peak, ++running); progress('Building fixture'); await gate.promise;
    await mkdir(join(directory, 'output'), { recursive: true });
    const path = join(directory, 'output', 'test.zip');
    execFileSync('python3', ['-c', "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('README.txt','Complete test file'); z.close()", path]);
    running--; return { filename: 'test.zip', size: (await readFile(path)).length, missing: [], radarVolumes: 1 };
  };
  const queue = new JobQueue({ dataDir: root, runner, reserveBytes: 0, maxPending: 2, dailyLimit: 2 });
  const server = createReplayServer(queue, { allowedOrigins: ['https://cyclonecizek.github.io'] });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = (data: any, origin?: string) => fetch(base + '/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(data) });
  try {
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal((await fetch(base + '/config.js')).status, 200);
    assert.equal((await post({ ...body, end: body.start })).status, 400);
    assert.equal((await post({ ...body, SCENARIO_OUTPUT: '/tmp/escape' })).status, 400);
    assert.equal((await post({ ...body, radar: 'x'.repeat(5000) })).status, 413);
    assert.equal((await post(body, 'https://other.example')).status, 403);
    const firstResponse = await post(body, 'https://cyclonecizek.github.io');
    assert.equal(firstResponse.status, 202); assert.equal(firstResponse.headers.get('Access-Control-Allow-Origin'), 'https://cyclonecizek.github.io');
    const first = await firstResponse.json(), second = await (await post(body)).json();
    assert.notEqual(first.id, second.id);
    assert.equal((await post(body)).status, 429);
    assert.equal((await fetch(`${base}/api/jobs/${first.id}/download`)).status, 409);
    assert.equal((await fetch(`${base}/api/jobs/${second.id}`).then(r => r.json())).position, 1);
    gate.resolve(); await queue.active;
    assert.equal(peak, 1); assert.equal(started.length, 2);
    const saved = queue.download(first.id), expected = await readFile(saved.path);
    const response = await fetch(`${base}/api/jobs/${first.id}/download`);
    assert.equal(Number(response.headers.get('Content-Length')), expected.length);
    assert.equal(response.headers.get('Content-Type'), 'application/zip');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
    const range = await fetch(`${base}/api/jobs/${first.id}/download`, { headers: { Range: 'bytes=3-20' } });
    assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), expected.subarray(3, 21));
    const suffix = await fetch(`${base}/api/jobs/${first.id}/download`, { headers: { Range: 'bytes=-22' } });
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), expected.subarray(-22));
    assert.equal((await fetch(`${base}/api/jobs/${first.id}/download`, { headers: { Range: 'bytes=999999-' } })).status, 416);
    assert.equal((await post(body)).status, 429); // Daily budget holds after jobs complete.
    await queue.close();
    const restored = new JobQueue({ dataDir: root, runner, reserveBytes: 0 });
    assert.equal(restored.get(first.id).state, 'complete');
    const record = restored.jobs.get(first.id)!; record.expiresAt = Date.now() - 1;
    restored.cleanup(); assert.equal(restored.get(first.id).state, 'expired');
    assert.throws(() => restored.download(first.id), /expired/);
    await restored.close();
  } finally { gate.resolve(); await queue.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true }); }
});

test('restart recovery and failed workers never publish incomplete files; storage budgets reject admission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'public-recovery-'));
  const id = 'a'.repeat(48), dir = join(root, id);
  await mkdir(join(dir, 'output'), { recursive: true }); await writeFile(join(dir, 'output', 'incomplete.zip'), 'broken');
  await writeFile(join(dir, 'job.json'), JSON.stringify({ id, env: scenarioRequest(body), state: 'running', createdAt: Date.now() }));
  const queue = new JobQueue({ dataDir: root, reserveBytes: 0, runner: async () => { throw Error('Archive source unavailable'); } });
  try {
    assert.equal(queue.get(id).state, 'failed'); assert.throws(() => queue.download(id), /not ready/);
    await assert.rejects(() => readFile(join(dir, 'output', 'incomplete.zip')));
    const job = queue.create(body); await queue.active;
    assert.equal(queue.get(job.id).state, 'failed'); assert.throws(() => queue.download(job.id), /not ready/);
    queue.reserveBytes = Number.MAX_SAFE_INTEGER;
    assert.throws(() => queue.create(body), /storage is full/);
  } finally { await queue.close(); await rm(root, { recursive: true, force: true }); }
});
