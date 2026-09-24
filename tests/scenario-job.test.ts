import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { configFromEnv, run, writeParts } from '../scripts/scenario-job';
import { BUCKET, kscURL } from '../lib/archive';

// Stand-ins for the siphon helper, called the way the build calls python3.
async function fakeSoundingPython(dir: string, name: string, script: string) {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return path;
}
const SOUNDING_JSON = JSON.stringify({
  time: Date.UTC(2024, 5, 25, 21), url: 'http://weather.uwyo.edu/wsgi/sounding?type=TEXT%3ACSV&datetime=2024-06-25%2021:00:00&id=74794',
  levels: [[1013, 0, 25], [900, 1000, 15], [800, 2000, 5], [700, 3000, -5], [600, 4000, -15], [500, 5000, -25]].map(([presHpa, hghtM, tempC]) => ({ presHpa, hghtM, tempC })),
});

test('UTC validation rejects reversed dates and retains 24-hour UTC values', () => {
  assert.equal(configFromEnv({ SCENARIO_START: '2024-06-25 23:00', SCENARIO_END: '2024-06-26 00:00' }).start, '2024-06-25T23:00Z');
  assert.throws(() => configFromEnv({ SCENARIO_START: '2024-06-25T23:00', SCENARIO_END: '2024-06-25T21:00' }));
  assert.throws(() => configFromEnv({ SCENARIO_START: '2024-02-30T21:00' }));
});

test('completed scenario ZIP has radar, synchronized layers, icons and no raw CSVs; failures publish nothing', async () => {
  const output = await mkdtemp(join(tmpdir(), 'scenario-test-'));
  const originalFetch = globalThis.fetch;
  const radar = Buffer.from('AR2V0006 fixture bytes for transfer-integrity test only');
  let failRadar = false, failKsc = false; const requested: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input); requested.push(url);
    if (url.startsWith(BUCKET) && url.includes('list-type')) return new Response(`<ListBucketResult><Contents><Key>2024/06/25/KMLB/KMLB20240625_210000_V06</Key><Size>${radar.length}</Size></Contents></ListBucketResult>`);
    if (url.startsWith(BUCKET)) return new Response(failRadar ? radar.subarray(0, 10) : radar);
    if (failKsc) return new Response('Unavailable', { status: 503 });
    if (url.includes('/WeatherTower/')) return new Response('Date,Time,SiteName,Height,Average Wind Direction,Average Wind Speed\n06/25/2024,21:00:00,1,54,270,20\n');
    if (url.includes('/FieldMill/')) return new Response('Date,Time,MillNo,OneMinuteMean\n06/25/2024,21:00:00,1,-1400\n');
    if (url.includes('/MerlinCloudTo')) return new Response('Date,Time,Latitude,Longitude,Signal Strength\n06/25/2024,21:00:00,28.5,-80.6,0\n');
    throw Error('Unexpected request: ' + url);
  };
  const bin = await mkdtemp(join(tmpdir(), 'sounding-fake-'));
  const soundingOk = await fakeSoundingPython(bin, 'ok', `cat <<'JSON'\n${SOUNDING_JSON}\nJSON`);
  const soundingDown = await fakeSoundingPython(bin, 'down', `echo 'Traceback noise' >&2; echo 'No 74794 sounding found in the 12 hours before 2024-06-25 21:00Z.' >&2; exit 1`);
  const env = { SCENARIO_START: '2024-06-25T21:00', SCENARIO_END: '2024-06-25T21:02', SCENARIO_TRAIL: '1', SCENARIO_WINDS: 'true', SCENARIO_OUTPUT: output, SOUNDING_PYTHON: soundingOk };
  try {
    const zip = await run(env);
    assert(requested.includes(kscURL('fieldmills', 0, '2024-06-25T20:45Z', '2024-06-25T21:02Z')), 'Retrieval must include the 15-minute field-mill history');
    execFileSync('python3', ['-c', `import zipfile,sys,json
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 names=z.namelist()
 assert not any(n.endswith('.csv') or '/raw/' in n for n in names)
 expected={'README.txt','manifest.json','FIX_ICON_PATHS.cmd','placefiles/wind_barb.png','placefiles/winds.txt','placefiles/fieldmills.txt','placefiles/merlin_cg.txt','placefiles/merlin_cc_density.txt','placefiles/replay_clock_check.txt','sounding_llcc.txt','radar/KMLB/KMLB20240625_210000_V06'}
 assert {'/'.join(n.split('/')[1:]) for n in names} == expected
 prefix=names[0].split('/')[0]+'/'
 assert z.read(prefix+'radar/KMLB/KMLB20240625_210000_V06') == b'AR2V0006 fixture bytes for transfer-integrity test only'
 assert b'-1400' in z.read(prefix+'placefiles/fieldmills.txt')
 assert b'TimeRange: 2024-06-25T21:00:00' in z.read(prefix+'placefiles/merlin_cg.txt')
 sounding=z.read(prefix+'sounding_llcc.txt').decode()
 assert '74794' in sounding and '2000' in sounding and '4500' in sounding
 readme=z.read(prefix+'README.txt').decode()
 assert 'sounding_llcc.txt included' in readme
 manifest=json.loads(z.read(prefix+'manifest.json'))
 assert manifest['raw_csvs_included'] is False and not manifest['missing']
 assert 'sounding_llcc.txt included' in manifest['sounding']
 assert any(x.get('kind')=='sounding' and 'type=TEXT%3ACSV' in x['url'] for x in manifest['sources'])
`, zip]);
    await rm(zip);
    failRadar = true;
    await assert.rejects(() => run(env), /Incomplete radar/);
    assert.deepEqual(await readdir(output), []);
    failRadar = false; failKsc = true;
    await assert.rejects(() => run(env), /HTTP 503/);
    assert.deepEqual(await readdir(output), []);
    const partial = await run({ ...env, SCENARIO_ALLOW_PARTIAL: 'true', SOUNDING_PYTHON: soundingDown });
    assert(partial.endsWith('-PARTIAL.zip'));
    execFileSync('python3', ['-c', `import zipfile,sys,json
with zipfile.ZipFile(sys.argv[1]) as z:
 names=z.namelist()
 assert not any('/merlin_' in n or n.endswith('/winds.txt') or n.endswith('/fieldmills.txt') for n in names)
 assert not any(n.endswith('/sounding_llcc.txt') for n in names)
 m=json.loads(z.read(next(n for n in names if n.endswith('/manifest.json'))))
 assert m['package_scope']=='partial' and len(m['missing'])==3
 assert m['sounding'] == 'sounding_llcc.txt not included: No 74794 sounding found in the 12 hours before 2024-06-25 21:00Z.', m['sounding']
 readme=z.read(next(n for n in names if n.endswith('/README.txt'))).decode()
 assert 'sounding_llcc.txt not included' in readme
`, partial]);
  } finally { globalThis.fetch = originalFetch; await rm(output, { recursive: true, force: true }); await rm(bin, { recursive: true, force: true }); }
});

test('observation files over 20 MB are written and compressed without a separate observation cap', async () => {
  const output = await mkdtemp(join(tmpdir(), 'observation-test-'));
  try {
    let size = 0;
    function* chunks() { for (let i = 0; i < 21; i++) yield 'x'.repeat(1_000_000); }
    await writeParts(join(output, 'large.txt'), chunks(), n => { size += n; });
    assert.equal(size, 21_000_000);
    assert.equal((await readFile(join(output, 'large.txt'))).length, size);
    await writeFile(join(output, 'README.txt'), 'Large observation test only');
    const zip = output + '.zip';
    try {
      execFileSync('python3', ['scripts/package-scenario.py', output, zip]);
      execFileSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert max(i.file_size for i in z.infolist())==21000000', zip]);
      await writeFile(join(output, 'unwanted.csv'), 'Date,Time');
      assert.throws(() => execFileSync('python3', ['scripts/package-scenario.py', output, zip], { stdio: 'pipe' }), /Raw CSVs/);
    } finally { await rm(zip, { force: true }); }
    await assert.rejects(() => writeParts(join(output, 'failure.txt'), chunks(), () => { throw Error('budget'); }), /budget/);
  } finally { await rm(output, { recursive: true, force: true }); }
});
