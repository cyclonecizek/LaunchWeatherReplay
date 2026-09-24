import { useRef, useState } from 'react';
import { generate, parse, probe, templates, validate, type Config, type Kind, type Observation } from '@/lib/replay';
import { merlinEntries, merlinRequests, type MerlinChunk, type MerlinSource } from '@/lib/merlin';
import { KSC_MIN_YEAR, KSC_MAX_YEAR } from '@/lib/archive';
import { soundingReportText } from '@/lib/sounding';
import { layers, type Prepared } from './layers';
import { addMinutes } from './format';

const BACKEND =
  typeof window !== 'undefined' && window.location.hostname.endsWith('.github.io')
    ? 'https://launch-weather-replay.bciz392.chatgpt.site'
    : '';

export function useScenarioBuilder() {
  const [name, setName] = useState('Cape weather scenario');
  const [start, setStart] = useState('2024-06-25T21:00');
  const [end, setEnd] = useState('2024-06-25T23:00');
  const [radar, setRadar] = useState('KMLB');
  const [selected, setSelected] = useState<Kind[]>(['fieldmills', 'lightning']);
  const [windHeight, setWindHeight] = useState('54');
  const [lightningMinutes, setLightningMinutes] = useState('30');
  const [profilerHeight, setProfilerHeight] = useState('1000');
  const [uploads, setUploads] = useState<Partial<Record<Kind, File[]>>>({});
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [partial, setPartial] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const reset = () => {
    setPrepared(null);
    setErrors([]);
    setPartial(false);
    setSubmitted(false);
    setStatus('');
  };
  const update = (fn: () => void) => {
    reset();
    fn();
  };
  const changeStart = (value: string) =>
    update(() => {
      setStart(value);
      if (value && end && Date.parse(end + 'Z') <= Date.parse(value + 'Z')) setEnd(addMinutes(value, 60));
    });
  const changeEnd = (value: string) =>
    update(() =>
      setEnd(value && start && Date.parse(value + 'Z') <= Date.parse(start + 'Z') ? addMinutes(start, 60) : value)
    );

  async function api(path: string, params: Record<string, string>, signal: AbortSignal) {
    const r = await fetch(BACKEND + path + '?' + new URLSearchParams(params), { signal });
    const data = await r.json();
    if (!r.ok || data.error) throw Error(data.error || 'Source request failed.');
    return data;
  }

  async function prepare() {
    reset();
    setBusy(true);
    setProgress(0);
    const controller = new AbortController();
    abort.current = controller;
    const c: Config = {
      name,
      start: start + 'Z',
      end: end + 'Z',
      radar: radar.toUpperCase(),
      layers: selected,
      windHeight,
      lightningMinutes: Number(lightningMinutes),
      profilerHeight: Number(profilerHeight),
    };
    const result: Prepared = { config: c, entries: [], radar: [], reports: [], missing: [], sources: [] };
    const issues: string[] = [];
    try {
      const { a, b } = validate(c);
      setStatus('Finding archived Level II volumes…');
      result.radar = (await api('/api/radar', { start: c.start, end: c.end, radar: c.radar }, controller.signal)).files;
      if (!result.radar.length) throw Error('No radar volumes found for this site and time window. Check the radar identifier and dates.');
      if (result.radar.length > 45)
        throw Error(`This window contains ${result.radar.length} radar volumes. Cloudflare can safely package up to 45 at once; choose a shorter window.`);
      const size = result.radar.reduce((s, f) => s + f.size, 0);
      if (size > 2e9) throw Error('Radar alone exceeds 2 GB. Choose a shorter time window.');
      result.sources.push({ kind: 'radar', source: 'https://registry.opendata.aws/noaa-nexrad/' });
      setProgress(15);
      for (let i = 0; i < c.layers.length; i++) {
        const kind = c.layers[i];
        const label = layers.find((l) => l.key === kind)!.name;
        const files = uploads[kind] || [];
        let obs: Observation[] = [];
        let notes: string[] = [];
        let failed = false;
        try {
          if (files.length) {
            for (let j = 0; j < files.length; j++) {
              if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
              setStatus(`Reading ${label}: ${files[j].name}`);
              if (files[j].size > 5_000_000) throw Error('Each uploaded CSV must be under 5 MB.');
              const text = await files[j].text();
              const parsed = parse(kind, text);
              obs.push(...parsed.obs);
              notes.push(...parsed.notes);
              result.entries.push({ name: `raw/${kind}-import-${j + 1}.csv`, text });
              result.sources.push({ kind, source: 'Imported file: ' + files[j].name });
            }
          } else if (kind === 'winds' || kind === 'fieldmills') {
            if ([new Date(a).getUTCFullYear(), new Date(b).getUTCFullYear()].some((y) => y < KSC_MIN_YEAR || y > KSC_MAX_YEAR))
              throw Error(`Automatic KSC export URLs support ${KSC_MIN_YEAR} through ${KSC_MAX_YEAR}.`);
            const lookback = kind === 'winds' ? 7 * 60000 : 15 * 60000;
            let chunk = 0;
            // Include antecedent observations, clamped to the earliest supported archive year.
            const begin = Math.max(a - lookback, Date.UTC(2000, 0, 1));
            for (let t = begin; t < b; t += 3600000) {
              chunk++;
              setStatus(`Fetching ${label}, hour ${chunk} of ${Math.ceil((b - begin) / 3600000)}…`);
              const responses = await Promise.allSettled(
                Array.from({ length: kind === 'winds' ? 4 : 1 }, (_, g) =>
                  api('/api/ksc', { kind, group: String(g), start: new Date(t).toISOString(), end: new Date(Math.min(b, t + 3600000)).toISOString() }, controller.signal)
                )
              );
              let good = 0;
              for (let g = 0; g < responses.length; g++) {
                const response = responses[g];
                if (response.status === 'rejected') {
                  failed = true;
                  notes.push(`Hour ${chunk}, group ${g + 1}: ${response.reason instanceof Error ? response.reason.message : 'Fetch failed'}`);
                  continue;
                }
                const parsed = parse(kind, response.value.text);
                obs.push(...parsed.obs);
                notes.push(...parsed.notes);
                good++;
                result.entries.push({ name: `raw/${kind}-hour-${chunk}-group-${g + 1}.csv`, text: response.value.text });
                result.sources.push({ kind, source: response.value.url });
              }
              if (!good) {
                failed = true;
                break;
              }
            }
          } else if (kind === 'lightning') {
            const requests = merlinRequests(c);
            const sources: MerlinSource[] = [];
            const chunks: MerlinChunk[] = [];
            for (let j = 0; j < requests.length; j++) {
              const request = requests[j];
              setStatus(`Fetching MERLIN ${request.type}, interval ${j + 1} of ${requests.length}…`);
              const chunk = (await api('/api/merlin', request, controller.signal)) as MerlinChunk;
              chunks.push(chunk);
              sources.push(chunk.source);
              setProgress(15 + (80 * (i + (j + 1) / requests.length)) / c.layers.length);
            }
            const count = sources.reduce((n, s) => n + s.records, 0);
            const rejected = sources.reduce((n, s) => n + s.rejected, 0);
            result.merlin = sources;
            result.entries.push(...merlinEntries(c, chunks));
            result.sources.push(...sources.map((s) => ({ kind: 'lightning', source: s.url })));
            result.reports.push({
              kind,
              records: count,
              plotted: count,
              first: requests[0].start,
              last: c.end,
              sites: 2,
              intervals: [],
              notes: [
                `Retrieved ${sources.filter((s) => s.type === 'CG').reduce((n, s) => n + s.records, 0).toLocaleString()} CG and ${sources.filter((s) => s.type === 'CC').reduce((n, s) => n + s.records, 0).toLocaleString()} CC records, including the ${c.lightningMinutes}-minute lookback.`,
                `${rejected} invalid records excluded. No invented quality flag or flash identification.`,
                `CC: approximately 1 km cells, refreshed every minute, counting [frame time minus trail, frame time). Colors show record density; observations may take up to one minute to appear or expire.`,
                `CG: individual markers, expiring after ${c.lightningMinutes} minutes.`,
                `All archive intervals responded. Empty results do not establish sensor uptime. Archive generation rechecks the source hashes and stops if data change.`,
              ],
            });
            setProgress(15 + (80 * (i + 1)) / c.layers.length);
            continue;
          } else throw Error('Unsupported source.');
          const seen = new Set<string>();
          obs = obs.filter((o) => {
            const key = JSON.stringify(o);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          const generated = generate(kind, obs, c, [...new Set(notes)]);
          result.reports.push(generated.report);
          if (generated.report.plotted) result.entries.push(generated.entry);
          else failed = true;
          if (failed) {
            result.missing.push(label);
            issues.push(`${label}: incomplete or unavailable. ${notes.find((n) => n.includes('HTTP') || n.includes('failed')) || 'Review the coverage notes.'}`);
          }
        } catch (e) {
          if (controller.signal.aborted) throw e;
          result.missing.push(label);
          issues.push(`${label}: ${e instanceof Error ? e.message : 'Unable to prepare source.'}`);
        }
        setProgress(15 + (80 * (i + 1)) / Math.max(1, c.layers.length));
      }
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      result.entries.push(probe(result.radar, c));
      try {
        setStatus('Fetching nearest KXMR sounding…');
        const soundingResp = await api('/api/sounding', { time: String(a) }, controller.signal);
        const text = soundingReportText(soundingResp.sounding, a);
        result.entries.push({ name: 'sounding_llcc.txt', text });
        result.sources.push({ kind: 'sounding', source: 'https://weather.uwyo.edu/upperair (KXMR 74794)' });
      } catch (e) {
        if (controller.signal.aborted) throw e;
        issues.push(`KXMR sounding: ${e instanceof Error ? e.message : 'Unable to fetch the nearest sounding.'}`);
      }
      if (result.entries.filter((e) => e.name.startsWith('placefiles/')).reduce((n, e) => n + e.text.length, 0) > 20e6)
        throw Error('Observation files exceed 20 MB. Choose a shorter window.');
      setPrepared(result);
      setErrors(issues);
      setStatus(result.missing.length ? 'Coverage checked. Some selected sources are missing or incomplete.' : 'Selected sources prepared. Review coverage before downloading.');
      setProgress(100);
    } catch (e) {
      setErrors([controller.signal.aborted ? 'Preparation cancelled.' : e instanceof Error ? e.message : 'Unable to prepare scenario.']);
      setStatus('');
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  function download() {
    if (!prepared) return;
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = BACKEND + '/api/bundle';
    form.target = '_blank';
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'payload';
    input.value = JSON.stringify(prepared);
    form.append(input);
    document.body.append(form);
    form.submit();
    form.remove();
    setSubmitted(true);
  }

  function template(kind: string) {
    const url = URL.createObjectURL(new Blob([templates[kind]], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = kind + '-import-template.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function cancel() {
    abort.current?.abort();
  }

  const duration = (Date.parse(end + 'Z') - Date.parse(start + 'Z')) / 3600000;
  const ordered = Number.isFinite(duration) && duration > 0;
  const bytes = prepared?.radar.reduce((s, f) => s + f.size, 0) || 0;

  return {
    name, setName,
    start, end, radar, setRadar,
    selected, setSelected,
    windHeight, setWindHeight,
    lightningMinutes, setLightningMinutes,
    profilerHeight, setProfilerHeight,
    uploads, setUploads,
    prepared, errors, busy, status, progress, partial, setPartial, submitted,
    update, changeStart, changeEnd,
    prepare, download, template, cancel,
    duration, ordered, bytes,
  };
}
