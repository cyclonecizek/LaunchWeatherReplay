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

test('soundingQuerySpecs walks backward hour by hour from the target, capped to the lookback window', () => {
  const target = Date.UTC(2024, 5, 25, 21, 0);
  const specs = soundingQuerySpecs(target, 12);
  assert.equal(specs.length, 13);
  assert.equal(specs[0].time, target);
  assert.equal(specs[1].time, target - 3_600_000);
  assert.equal(specs[12].time, Date.UTC(2024, 5, 25, 9, 0));
  const url = soundingURL(specs[0]);
  assert(url.startsWith('https://weather.uwyo.edu/wsgi/sounding?'));
  assert(url.includes('src=FM35') && url.includes('id=74794') && url.includes('type=TEXT:LIST') && url.includes('datetime=2024-06-25%2021:00:00'));
});

test('fetchNearestSounding stops at the first hourly hit walking backward, tolerating misses on the way', async () => {
  const target = Date.UTC(2024, 5, 25, 21, 0);
  // KXMR's actual morning launch, an hour that isn't a clean synoptic slot.
  const html = fixture('24', '06', '25', '10', '00', LAPSE);
  let calls = 0;
  const sounding = await fetchNearestSounding(target, async url => {
    calls++;
    if (url.includes('datetime=2024-06-25%2010:00:00')) return html;
    throw Error(`HTTP 404 for ${url}`);
  });
  assert.equal(sounding.time, Date.UTC(2024, 5, 25, 10, 0));
  assert.equal(calls, 12); // 21:00 down through 10:00, inclusive, one hour at a time
});

test('fetchNearestSounding reports the last error when nothing is found in the lookback window', async () => {
  const target = Date.UTC(2024, 5, 25, 21, 0);
  await assert.rejects(
    fetchNearestSounding(target, async url => { throw Error(`HTTP 404 for ${url}`); }, 2),
    /No 74794 \(KXMR\) sounding was found in the 2 hours before the requested time\. Last attempt: HTTP 404 for/,
  );
});

test('fetchNearestSounding reports a page that loaded but could not be parsed, not the trailing 404s', async () => {
  const target = Date.UTC(2024, 5, 28, 16, 0);
  await assert.rejects(
    fetchNearestSounding(target, async url => {
      if (url.includes('datetime=2024-06-28%2015:00:00')) return '<html><body>Some new layout the parser does not know</body></html>';
      throw Error(`HTTP 404 for ${url}`);
    }, 3),
    /datetime=2024-06-28%2015:00:00&id=74794&type=TEXT:LIST loaded but had no readable sounding\. Page begins: Some new layout/,
  );
});

test('parseSoundingPage falls back to the requested time and whitespace columns when the legacy markers are absent', () => {
  const html = '<html><pre>\n PRES HGHT TEMP\n hPa m C\n1013.0 3 26.0\n850.0 1500 16.0\n700.0 3150 7.0\n500.0 5850 -8.0\n400.0 7500 -18.0\n</pre></html>';
  const [sounding] = parseSoundingPage(html, Date.UTC(2024, 5, 28, 15, 0));
  assert.equal(sounding.time, Date.UTC(2024, 5, 28, 15, 0));
  assert.deepEqual(sounding.levels.map(l => l.tempC), [26, 16, 7, -8, -18]);
  assert.deepEqual(parseSoundingPage(html), []);
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
