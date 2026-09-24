import assert from 'node:assert/strict';
import { test } from 'node:test';
import { soundingQuerySpecs, soundingURL, parseSoundingPage, nearestSounding, fetchNearestSounding, criticalAltitudes, soundingReportText, type SoundingLevel } from '../lib/sounding';

function fixture(yy: string, mm: string, dd: string, hh: string, mi: string, rows: [number, number, number][]) {
  const col = (n: number) => n.toFixed(1).padStart(7);
  const data = rows.map(([p, h, t]) => col(p) + col(h) + col(t)).join('\n');
  return `<H2>74794 XMR Cape Canaveral Observations at ${hh}Z ${dd} Jun 20${yy}</H2>\n<PRE>\n---\n   PRES   HGHT   TEMP\n${data}\n</PRE>\n<H3>Station information and sounding indices</H3>\n<PRE>\n                             Station number: 74794\n                           Observation time: ${yy}${mm}${dd}/${hh}${mi}\n                          Station elevation: 3.0\n</PRE>\n`;
}
// A clean 10 C/1000 m lapse rate makes every threshold crossing land at a round, hand-checkable altitude.
const LAPSE: [number, number, number][] = [[1013, 0, 25], [900, 1000, 15], [800, 2000, 5], [700, 3000, -5], [600, 4000, -15], [500, 5000, -25]];

test('soundingQuerySpecs only tries KXMR\'s known launch hours within the lookback window', () => {
  const target = Date.UTC(2024, 5, 25, 21, 0);
  const specs = soundingQuerySpecs(target, 12);
  assert.deepEqual(specs.map(s => new Date(s.time).toISOString()), [
    '2024-06-25T18:00:00.000Z',
    '2024-06-25T15:00:00.000Z',
    '2024-06-25T12:00:00.000Z',
    '2024-06-25T09:00:00.000Z',
  ]);
  const url = soundingURL(specs[0]);
  assert(url.startsWith('https://weather.uwyo.edu/wsgi/sounding?'));
  assert(url.includes('id=74794') && url.includes('type=TEXT%3ALIST') && url.includes('datetime=2024-06-25+18%3A00%3A00'));
});

test('fetchNearestSounding stops at the first known-launch-hour hit, tolerating misses on the way', async () => {
  const target = Date.UTC(2024, 5, 25, 21, 0);
  const html = fixture('24', '06', '25', '12', '00', LAPSE); // the 12Z launch
  let calls = 0;
  const sounding = await fetchNearestSounding(target, async url => {
    calls++;
    if (url.includes('datetime=2024-06-25+12%3A00%3A00')) return html;
    throw Error(`HTTP 404 for ${url}`);
  });
  assert.equal(sounding.time, Date.UTC(2024, 5, 25, 12, 0));
  assert.equal(calls, 3); // tries 18Z, then 15Z, then hits 12Z
});

test('fetchNearestSounding reports the last error when nothing is found in the lookback window', async () => {
  const target = Date.UTC(2024, 5, 25, 21, 0);
  await assert.rejects(
    // Only one launch hour (18Z) falls within a 4-hour lookback from 21:00.
    fetchNearestSounding(target, async url => { throw Error(`HTTP 404 for ${url}`); }, 4),
    /No 74794 \(KXMR\) sounding was found in the 4 hours before the requested time\. Last attempt: HTTP 404 for/,
  );
});

test('parseSoundingPage reads the fixed-width levels and observation time', () => {
  const html = fixture('24', '06', '25', '12', '00', LAPSE);
  const [sounding] = parseSoundingPage(html);
  assert.equal(sounding.time, Date.UTC(2024, 5, 25, 12, 0));
  assert.equal(sounding.levels.length, 6);
  assert.deepEqual(sounding.levels.map(l => l.hghtM), [0, 1000, 2000, 3000, 4000, 5000]);
  assert.deepEqual(sounding.levels.map(l => l.tempC), [25, 15, 5, -5, -15, -25]);
});

test('nearestSounding picks the closer observation time', () => {
  const a = { time: Date.UTC(2024, 5, 25, 0, 0), levels: [] as SoundingLevel[] };
  const b = { time: Date.UTC(2024, 5, 25, 12, 0), levels: [] as SoundingLevel[] };
  assert.equal(nearestSounding([a, b], Date.UTC(2024, 5, 25, 15, 0)), b);
  assert.equal(nearestSounding([a, b], Date.UTC(2024, 5, 25, 3, 0)), a);
});

test('criticalAltitudes interpolates each isotherm at the first crossing above the surface', () => {
  const [sounding] = parseSoundingPage(fixture('24', '06', '25', '21', '00', LAPSE));
  const rows = criticalAltitudes(sounding.levels);
  assert.deepEqual(rows.map(r => r.thresholdC), [5, 0, -5, -10, -15, -20]);
  assert.deepEqual(rows.map(r => r.altitudeM), [2000, 2500, 3000, 3500, 4000, 4500]);
  // altitudeFt is exact meters*3.28084; soundingReportText is what rounds it for display.
  assert.deepEqual(rows.map(r => r.altitudeFt), [6561.68, 8202.1, 9842.52, 11482.94, 13123.36, 14763.78]);
});

test('criticalAltitudes reports "not reached" when the sounding never gets that cold', () => {
  const warm: SoundingLevel[] = [{ presHpa: 1013, hghtM: 0, tempC: 25 }, { presHpa: 950, hghtM: 500, tempC: 20 }];
  const rows = criticalAltitudes(warm, [0, -20]);
  assert.deepEqual(rows, [{ thresholdC: 0, altitudeM: null, altitudeFt: null }, { thresholdC: -20, altitudeM: null, altitudeFt: null }]);
  // soundingReportText always reports all 6 default thresholds; each unreached one shows "not
  // reached" in both the meters and feet columns, plus one more mention in the footer legend.
  const text = soundingReportText({ time: Date.UTC(2024, 5, 25), levels: warm }, Date.UTC(2024, 5, 25));
  assert.equal(text.match(/not reached/g)?.length, 6 * 2 + 1);
});

test('soundingReportText names the station, both times, and the source', () => {
  const [sounding] = parseSoundingPage(fixture('24', '06', '25', '12', '00', LAPSE));
  const text = soundingReportText(sounding, Date.UTC(2024, 5, 25, 21, 0));
  assert(text.includes('74794') && text.includes('KXMR'));
  assert(text.includes('2024-06-25 12:00Z') && text.includes('2024-06-25 21:00Z'));
  assert(text.includes('weather.uwyo.edu'));
  assert(text.includes('2500') && text.includes('8200'));
});
