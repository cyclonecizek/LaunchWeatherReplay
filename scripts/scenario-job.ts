import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile, appendFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { BUCKET, radarFiles, kscURL, readLimited } from '../lib/archive';
import { validate, csv, parse, generate, probe, type Config, type Observation, type RadarFile } from '../lib/replay';
import { merlinRequests, fetchMerlin, cgHeader, cgParts, ccParts, DensityWindow } from '../lib/merlin';
import sprite from '../lib/barb-data.json';

const MAX_BYTES = 2_000_000_000;
const MIN = 60_000;
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: string; message?: string } | undefined;
  return error.message + (cause ? ` (${cause.code || 'cause'}: ${cause.message || String(cause)})` : '');
}
const bool = (s: string | undefined, fallback: boolean) => s === undefined ? fallback : s === 'true';
export function configFromEnv(env: Record<string, string | undefined>): Config {
  const normalize = (s: string) => s.trim().replace(' ', 'T').replace(/Z?$/, 'Z');
  const c: Config = {
    name: 'Cape weather scenario',
    start: normalize(env.SCENARIO_START || '2024-06-25T21:00'),
    end: normalize(env.SCENARIO_END || '2024-06-25T21:30'),
    radar: (env.SCENARIO_RADAR || 'KMLB').trim().toUpperCase(),
    layers: [], windHeight: env.SCENARIO_WIND_HEIGHT || '54',
    lightningMinutes: Number(env.SCENARIO_TRAIL || '60'), profilerHeight: 1000,
  };
  if (bool(env.SCENARIO_WINDS, true)) c.layers.push('winds');
  if (bool(env.SCENARIO_FIELDMILLS, true)) c.layers.push('fieldmills');
  if (bool(env.SCENARIO_MERLIN, true)) c.layers.push('lightning');
  const { a, b } = validate(c);
  if (a % MIN || b % MIN) throw Error('Use whole UTC minutes in YYYY-MM-DDTHH:MM format.');
  return c;
}

export function instructions(c: Config, missing: string[]) {
  return `LAUNCH WEATHER REPLAY\r\n${c.start} to ${c.end} (UTC, end exclusive)\r\nRadar: ${c.radar}\r\n\r\n${missing.length ? 'PARTIAL SCENARIO: ' + missing.join('; ') : 'Selected archive requests completed. Check coverage below and in manifest.json.'}\r\n\r\nOPEN IN GR2ANALYST\r\n1. Extract this ZIP completely to a permanent folder.\r\n2. For wind icons, run FIX_ICON_PATHS.cmd after extraction or moving the folder. If scripts are unavailable, open placefiles/winds.txt in a text editor and replace wind_barb.png in the IconFile line with its full Windows path, inside the quotes.\r\n3. Stop live polling in GR, then use File > Open to load radar/${c.radar}/. Set the loop frame count to cover the volumes.\r\n4. In Placefile Manager add placefiles/replay_clock_check.txt first. Step forward, backward and pause; confirm the displayed clock follows the archived radar time.\r\n5. Add the other placefiles. Times are UTC; no running website is needed during replay.\r\n\r\nGR2Analyst 3.0, 3.2 and 3.4 require verification on the installed application. TimeRange-based playback is implemented but has not been tested in GR here. A valid ZIP does not establish GR compatibility.\r\n\r\nTIME RULES\r\nTowers expire after 7 minutes and field mills after 2 minutes, or earlier when replaced. No future observations or interpolation. MERLIN CG detections persist for ${c.lightningMinutes} minutes; CC uses approximately 1 km cells with counts from [frame time minus trail, frame time), refreshed each minute. Counts are detections, not independently identified flashes. Field colors and lightning colors are display categories, not launch criteria.\r\n\r\nRaw CSVs are used temporarily to create the placefiles and are not included. Radar Level II bytes are retained unchanged. manifest.json records source URLs, hashes and coverage notes. Successful requests do not prove complete sensor-network coverage. Profilers are not included.\r\n`;
}

export const iconFix = '@echo off\r\nset "REPLAY_ROOT=%~dp0"\r\npowershell -NoProfile -Command "$dir=Join-Path $env:REPLAY_ROOT \'placefiles\'; $icon=Join-Path $dir \'wind_barb.png\'; Get-ChildItem -LiteralPath $dir -Filter \'*.txt\' | ForEach-Object { $s=[IO.File]::ReadAllText($_.FullName); $s=[regex]::Replace($s, \'(?m)^IconFile: 1, 96, 96, 48, 48, .*$\', (\'IconFile: 1, 96, 96, 48, 48, \'+[char]34+$icon+[char]34)); [IO.File]::WriteAllText($_.FullName,$s,(New-Object Text.UTF8Encoding($false))) }; Write-Host \'Icon paths updated.\'"\r\npause\r\n';

// Stream both generated text and radar to disk. The entire archive is never a JS string or buffer.
export async function writeParts(path: string, parts: Iterable<string> | AsyncIterable<string>, charge: (n: number) => void) {
  async function* buffers() {
    let buffer = '';
    for await (const part of parts) {
      buffer += part;
      if (buffer.length >= 64_000) { const bytes = Buffer.from(buffer); charge(bytes.length); yield bytes; buffer = ''; }
    }
    if (buffer) { const bytes = Buffer.from(buffer); charge(bytes.length); yield bytes; }
  }
  await pipeline(Readable.from(buffers()), createWriteStream(path, { flags: 'wx' }));
}

export async function downloadRadar(file: RadarFile, path: string, charge: (n: number) => void) {
  const response = await fetch(BUCKET + file.key, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw Error(`Radar transfer returned HTTP ${response.status}: ${file.key}`);
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) !== file.size) { await response.body.cancel(); throw Error('Radar size changed since listing.'); }
  let count = 0; const hash = createHash('sha256');
  const check = new Transform({
    transform(chunk, _encoding, callback) {
      try { count += chunk.length; if (count > file.size) throw Error('Radar exceeds its listed size.'); charge(chunk.length); hash.update(chunk); callback(null, chunk); }
      catch (e) { callback(e as Error); }
    },
    flush(callback) { callback(count === file.size ? undefined : Error('Incomplete radar transfer.')); },
  });
  await pipeline(Readable.fromWeb(response.body as never), check, createWriteStream(path, { flags: 'wx' }));
  return hash.digest('hex');
}

export async function buildScenario(c: Config, root: string, allowPartial = false) {
  const { a, b } = validate(c);
  const reports: unknown[] = [], sources: unknown[] = [], missing: string[] = [];
  let bytes = 0;
  const charge = (n: number) => { bytes += n; if (bytes > MAX_BYTES) throw Error('The GR package exceeds 2 GB. Split this scenario into smaller windows.'); };
  await mkdir(join(root, 'placefiles'), { recursive: true });
  await mkdir(join(root, 'radar', c.radar), { recursive: true });
  const save = async (name: string, text: string) => writeParts(join(root, name), [text], charge);
  console.log('Listing archived radar volumes...');
  const radar = await radarFiles(c);
  if (!radar.length) throw Error('No radar volumes were found in this window.');
  if (radar.reduce((sum, f) => sum + f.size, 0) > MAX_BYTES) throw Error('Radar alone exceeds 2 GB. Split the scenario.');
  // No 45-volume or 20 MB observation limit on this disk-based job.
  for (const kind of c.layers) {
    if (kind === 'profilers') throw Error('Profilers are deferred.');
    try {
      if (kind === 'lightning') {
        const window = new DensityWindow(), requests = merlinRequests(c);
        const stats = { CG: { records: 0, rejected: 0 }, CC: { records: 0, rejected: 0 } };
        async function* cg() {
          yield cgHeader(c);
          for (const [i, request] of requests.entries()) {
            console.log(`MERLIN ${request.type}: interval ${i + 1}/${requests.length}`);
            const chunk = await fetchMerlin(request);
            sources.push(chunk.source);
            stats[request.type].records += chunk.source.records;
            stats[request.type].rejected += chunk.source.rejected;
            if (request.type === 'CG') yield* cgParts(c, chunk.events);
            else window.add(chunk.events);
            // The raw CSV and individual CC events fall out of scope after this interval.
          }
        }
        await writeParts(join(root, 'placefiles/merlin_cg.txt'), cg(), charge);
        await writeParts(join(root, 'placefiles/merlin_cc_density.txt'), ccParts(c, window), charge);
        reports.push({ kind, ...stats, trail_minutes: c.lightningMinutes, notes: ['Counts include the pre-start lookback.', 'An empty response is not proof of sensor uptime.', 'CC cells refresh each minute with an end-exclusive count window.'] });
      } else {
        const obs: Observation[] = [], notes: string[] = [];
        const begin = Math.max(a - (kind === 'winds' ? 7 : 2) * MIN, Date.UTC(2000, 0, 1));
        for (let t = begin; t < b; t += 60 * MIN) {
          for (let group = 0; group < (kind === 'winds' ? 4 : 1); group++) {
            console.log(`${kind}: ${new Date(t).toISOString()}, group ${group + 1}`);
            const url = kscURL(kind, group, new Date(t).toISOString(), new Date(Math.min(b, t + 60 * MIN)).toISOString());
            const response = await fetch(url, { redirect: 'manual', headers: { Accept: 'text/csv,text/plain,*/*' }, signal: AbortSignal.timeout(60_000) });
            if (!response.ok) { await response.body?.cancel(); throw Error(`KSC returned HTTP ${response.status}.`); }
            const text = await readLimited(response);
            if (/^\s*</.test(text)) throw Error('KSC returned HTML instead of CSV.');
            const required = kind === 'winds' ? ['Date', 'Time', 'SiteName', 'Height', 'Average Wind Direction', 'Average Wind Speed'] : ['Date', 'Time', 'MillNo', 'OneMinuteMean'];
            const empty = csv(text).length === 0;
            if (empty && !required.every(h => text.split(/\r?\n/, 1)[0].includes(h))) throw Error('KSC returned unexpected CSV columns.');
            const parsed = empty ? { obs: [], notes: [`No observations returned for group ${group + 1}, ${new Date(t).toISOString()}.`], total: 0 } : parse(kind, text);
            for (const o of parsed.obs) obs.push(o);
            notes.push(...parsed.notes);
            sources.push({ kind, url, sha256: createHash('sha256').update(text).digest('hex'), records: parsed.total });
          }
        }
        const seen = new Set<string>();
        const unique = obs.filter(o => { const key = JSON.stringify(o); if (seen.has(key)) return false; seen.add(key); return true; });
        const result = generate(kind, unique, c, [...new Set(notes)]);
        reports.push(result.report);
        if (!result.report.plotted) throw Error('No plottable observations for the chosen height and window.');
        await save(result.entry.name, result.entry.text);
      }
    } catch (e) {
      if (bytes > MAX_BYTES) throw e;
      console.log(`Unavailable ${kind}: ${describeError(e)}`);
      missing.push(`${kind}: ${describeError(e)}`);
      const names = kind === 'lightning' ? ['merlin_cg', 'merlin_cc_density'] : [kind];
      for (const name of names) await rm(join(root, 'placefiles', `${name}.txt`), { force: true });
    }
  }
  if (missing.length && !allowPartial) throw Error('Selected layers unavailable: ' + missing.join('; ') + '. Enable Allow partial only if you want the remaining data.');
  if (c.layers.includes('winds') && !missing.some(s => s.startsWith('winds:'))) {
    const icon = Buffer.from(sprite, 'base64'); charge(icon.length);
    await writeFile(join(root, 'placefiles/wind_barb.png'), icon);
    await save('FIX_ICON_PATHS.cmd', iconFix);
  }
  await save('placefiles/replay_clock_check.txt', probe(radar, c).text);
  for (const [i, file] of radar.entries()) {
    console.log(`Radar volume ${i + 1}/${radar.length}: ${file.key.split('/').pop()}`);
    const sha256 = await downloadRadar(file, join(root, 'radar', c.radar, file.key.split('/').pop()!), charge);
    sources.push({ kind: 'radar', url: BUCKET + file.key, size: file.size, sha256 });
  }
  await save('README.txt', instructions(c, missing));
  // Written only after every required transfer has succeeded. No raw data directory is created.
  await save('manifest.json', JSON.stringify({ config: c, raw_csvs_included: false, package_scope: missing.length ? 'partial' : 'selected_sources', missing, reports, sources, radar, gr_compatibility: 'UNVERIFIED: run replay_clock_check.txt in the installed GR build' }, null, 2));
  return { missing, radarVolumes: radar.length, bytes };
}

export async function run(env: Record<string, string | undefined> = process.env) {
  const output = resolve(env.SCENARIO_OUTPUT || 'outputs');
  const work = await mkdtemp(join(tmpdir(), 'launch-weather-'));
  await mkdir(output, { recursive: true });
  try {
    const networkTest = env.SCENARIO_MODE === 'Network test';
    const c = networkTest ? undefined : configFromEnv(env);
    const name = networkTest ? 'GitHub-download-test' : `${c!.radar}-${c!.start.replace(/[^0-9]/g, '').slice(0, 12)}-${c!.end.replace(/[^0-9]/g, '').slice(0, 12)}`;
    const root = join(work, name); await mkdir(root);
    let result: Awaited<ReturnType<typeof buildScenario>> | undefined;
    if (networkTest) {
      await writeFile(join(root, 'README.txt'), 'GITHUB DOWNLOAD TEST\r\n\r\nIf you can download this ZIP and open this file at your office, this GitHub artifact download path works for this test.\r\nThis is not weather data and is not a GR replay. Larger downloads and GR compatibility still require testing.\r\n');
    } else result = await buildScenario(c!, root, bool(env.SCENARIO_ALLOW_PARTIAL, false));
    const filename = `${name}${result?.missing.length ? '-PARTIAL' : ''}.zip`;
    const destination = join(output, filename);
    execFileSync('python3', [fileURLToPath(new URL('./package-scenario.py', import.meta.url)), root, destination], { stdio: 'inherit' });
    const size = (await stat(destination)).size;
    // The public server publishes a download only after packaging and CRC checks finish.
    if (env.SCENARIO_RESULT_PATH) await writeFile(env.SCENARIO_RESULT_PATH, JSON.stringify({ filename, size, missing: result?.missing || [], radarVolumes: result?.radarVolumes || 0 }));
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `archive=${destination}\nfilename=${filename}\n`);
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `## ${networkTest ? 'Office download test' : 'GR scenario ready'}\n\nZIP built and every entry checked for CRC integrity. Download **${filename}** under Artifacts on this run. Extract once.\n\n${(size / 1e6).toFixed(2)} MB. ${result ? `${result.radarVolumes} radar volumes. Raw CSVs excluded. ${result.missing.length ? 'PARTIAL: check README.txt for missing sources.' : 'Selected archive requests completed.'}` : 'No weather data is included in this network test.'}\n`);
    return destination;
  } finally { await rm(work, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch(e => { console.error(describeError(e)); process.exitCode = 1; });
}
