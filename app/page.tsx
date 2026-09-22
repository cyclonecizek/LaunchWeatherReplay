"use client";
import { Radar, Download, FileArchive, Clock3, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Choice } from '@/components/scenario/Choice';
import { DateTime24 } from '@/components/scenario/DateTime24';
import { ReplayClockDiagram } from '@/components/scenario/ReplayClockDiagram';
import { Progress } from '@/components/ui/progress';
import { layers } from '@/components/scenario/layers';
import { mb, fmt } from '@/components/scenario/format';
import { useScenarioBuilder } from '@/components/scenario/useScenarioBuilder';

export default function Home() {
  const {
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
  } = useScenarioBuilder();

  return (
    <main className="workspace">
      <header>
        <div className="brand"><Radar size={25} /><span>LAUNCH WEATHER / REPLAY</span></div>
        <span className="tag">GR2Analyst · archive mode</span>
      </header>
      <div className="title-row">
        <p className="eyebrow">SCENARIO BUILDER</p>
        <h1>Bring the countdown back.</h1>
        <p className="intro">Archived radar and local observations, on one UTC timeline.</p>
      </div>
      <p className="notice">For a complete ZIP built on GitHub, <a href="https://github.com/cyclonecizek/LaunchWeatherReplay/actions/workflows/build-scenario.yml" style={{ textDecoration: 'underline' }}>open the GitHub scenario builder</a>. Sign in, choose Run workflow, and enter the UTC window. Raw CSVs are excluded.</p>
      <div className="work-grid">
        <div className="stack">
          <fieldset disabled={busy} className="panel" style={{ minWidth: 0 }}>
            <h2><span className="step">01</span> Define the scenario</h2>
            <label>Scenario name<Input maxLength={100} value={name} onChange={(e) => update(() => setName(e.target.value))} /></label>
            <div className="two-col">
              <DateTime24 id="start" label="Start" value={start} change={changeStart} />
              <DateTime24 id="end" label="End" value={end} change={changeEnd} />
            </div>
            <label>Radar identifier<Input maxLength={4} value={radar} onChange={(e) => update(() => setRadar(e.target.value.toUpperCase()))} placeholder="KMLB" spellCheck={false} /></label>
            <p className="note">KMLB is Melbourne NEXRAD. Times use 24-hour UTC. If the start moves to or beyond the end, the end automatically moves one hour later. Windows may be up to 12 hours and 2 GB per package.</p>
            <h2 style={{ marginTop: 28 }}><span className="step">02</span> Choose local observations</h2>
            <div className="notice">Radar, wind towers, field mills, and MERLIN lightning are retrieved automatically for the window below — no account or manual download needed.</div>
            {layers.map((layer) => {
              const checked = selected.includes(layer.key);
              return (
                <div className="source" key={layer.key}>
                  <div className="source-head">
                    <Checkbox id={layer.key} checked={checked} onCheckedChange={(v) => update(() => setSelected(v ? [...selected, layer.key] : selected.filter((k) => k !== layer.key)))} />
                    <layer.icon size={18} />
                    <label htmlFor={layer.key}>{layer.name}</label>
                    <span className="status">{uploads[layer.key]?.length ? 'FILE IMPORT' : layer.mode}</span>
                  </div>
                  <p>{layer.detail}</p>
                  {checked && (
                    <>
                      {layer.key === 'winds' && (
                        <div className="source-settings">
                          <label>Wind height<Choice label="Wind height" value={windHeight} change={(v) => update(() => setWindHeight(v))} items={[['surface', 'Surface · ≤20 ft'], ['lowest', 'Lowest available'], ['54', '54 ft'], ['200plus', 'Lowest ≥200 ft']]} /></label>
                        </div>
                      )}
                      {layer.key === 'lightning' && (
                        <div className="source-settings">
                          <label>Detection trail<Choice label="Lightning trail" value={lightningMinutes} change={(v) => update(() => setLightningMinutes(v))} items={['1', '5', '10', '15', '30', '45', '60'].map((v) => [v, v + ' minutes'])} /></label>
                        </div>
                      )}
                      {layer.key === 'profilers' && (
                        <div className="source-settings">
                          <label>Target height · AGL<Choice label="Profiler height" value={profilerHeight} change={(v) => update(() => setProfilerHeight(v))} items={['500', '1000', '2000', '3000', '5000'].map((v) => [v, v + ' meters'])} /></label>
                        </div>
                      )}
                      <input type="file" multiple accept=".csv,text/csv" aria-label={`Import ${layer.name} CSV files`} onChange={(e) => update(() => setUploads({ ...uploads, [layer.key]: Array.from(e.target.files || []) }))} />
                      <p>
                        {layer.key === 'winds' || layer.key === 'fieldmills'
                          ? 'Optional: upload KSC export CSVs to use instead of automatic retrieval.'
                          : layer.key === 'lightning'
                          ? 'Automatic retrieval is the default. Optional normalized CSV imports use individual detection markers.'
                          : <><button type="button" onClick={() => template(layer.key)} style={{ textDecoration: 'underline', color: '#8cdafa' }}>Download CSV header template</button> · Map your archive export to these columns before importing.</>}
                      </p>
                      {uploads[layer.key]?.length ? (
                        <p>{uploads[layer.key]!.length} file(s) selected · <button type="button" onClick={() => update(() => setUploads({ ...uploads, [layer.key]: [] }))} style={{ textDecoration: 'underline' }}>Use default source</button></p>
                      ) : null}
                      {layer.key === 'lightning' && <details><summary>Lightning import requirements</summary><p>UTC ISO timestamps ending in Z; decimal latitude/longitude; type CG or CC; quality good for accepted rows. Optional peak_current_ka. These are detection records. The importer does not identify or combine flashes.</p></details>}
                      {layer.key === 'profilers' && <details><summary>Profiler import requirements</summary><p>UTC ISO timestamps ending in Z; site, latitude, longitude, height_m_agl, wind_direction_deg, wind_speed_kt, quality. Accepted rows require quality good. Nearest level within 250 m of the target is shown; no vertical interpolation. Do not relabel MSL heights as AGL.</p></details>}
                    </>
                  )}
                </div>
              );
            })}
          </fieldset>
        </div>
        <div className="stack">
          <section className="panel">
            <h2><span className="step">03</span> Check coverage & download</h2>
            <div className="metrics">
              <div><p className="small-title">REQUESTED WINDOW</p><div className="summary" style={{ margin: 0 }}><div className="big">{Number.isFinite(duration) && duration > 0 ? duration.toFixed(1) : '—'} <span style={{ fontSize: 18 }}>hours</span></div><div className="metric-label">All timestamps in UTC</div></div></div>
              <div><p className="small-title">RADAR SOURCE</p><div className="summary" style={{ margin: 0 }}><div className="big">{radar || '—'}</div><div className="metric-label">Archived Level II volumes</div></div></div>
            </div>
            <Button className="action" onClick={prepare} disabled={busy || !ordered}>{busy ? 'Checking sources…' : prepared ? 'Refresh coverage' : 'Check coverage'}<ArrowRight size={18} /></Button>
            {!ordered && <p className="error" role="alert" style={{ marginTop: 18 }}>End time must be after the start time.</p>}
            {busy && <Button variant="outline" className="secondary-action" onClick={cancel}>Cancel</Button>}
            <div aria-live="polite">
              {status && <p className="log">{status}</p>}
              {busy && <Progress value={progress} aria-label="Source preparation progress" style={{ marginTop: 12 }} />}
            </div>
            {!!errors.length && <div className="error" role="alert" style={{ marginTop: 18 }}>{errors.join('\n\n')}</div>}
            {prepared && (
              <>
                <div className="summary">
                  <div className="metrics">
                    <div><div className="big">{prepared.radar.length}</div><div className="metric-label">Radar volumes found</div></div>
                    <div><div className="big">{mb(bytes)}</div><div className="metric-label">Radar size, before observations</div></div>
                  </div>
                  <div className="timeline" aria-label="Radar volume start times within the requested interval">{prepared.radar.map((f) => <div key={f.key} style={{ left: 100 * (Date.parse(f.time) - Date.parse(prepared.config.start)) / (Date.parse(prepared.config.end) - Date.parse(prepared.config.start)) + '%', width: 2 }} />)}</div>
                  <p className="note">First {fmt(prepared.radar[0]?.time)} · Last {fmt(prepared.radar.at(-1)?.time || null)}</p>
                  <p className="note">Ticks mark volume starts. Radar volumes span several minutes.</p>
                </div>
                {prepared.reports.map((r) => (
                  <div className="result" key={r.kind}>
                    <b>{layers.find((l) => l.key === r.kind)?.name}</b>
                    <p>{r.plotted.toLocaleString()} {r.kind === 'lightning' && prepared.merlin ? 'retrieved records, including lookback' : 'plotted records'} · {r.sites} {r.kind === 'lightning' ? 'detection types' : 'sites'}<br />{fmt(r.first)} to {fmt(r.last)}</p>
                    <details><summary>Coverage and time rules</summary>{r.notes.map((n, i) => <p key={i}>{n}</p>)}<p>Intervals with at least one displayed record: {r.intervals.length}. This does not establish complete network coverage.</p></details>
                  </div>
                ))}
                {!!prepared.missing.length && (
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 20 }}>
                    <Checkbox checked={partial} onCheckedChange={(v) => setPartial(v === true)} />
                    Download the available data as a partial scenario; list missing sources in the package.
                  </label>
                )}
                <Button className="action" disabled={prepared.missing.length > 0 && !partial} onClick={download}><Download size={18} />{prepared.missing.length ? 'Download partial scenario' : 'Download scenario TAR'}</Button>
                {submitted && <p className="note" role="status">Download requested in a new tab. The checked MERLIN data is reused while radar files stream into the TAR archive. After it finishes, extract it and confirm manifest.json is present. If a source error appears, refresh coverage and retry.</p>}
              </>
            )}
            {!prepared && (
              <div className="summary">
                <div className="zip-list"><FileArchive size={24} /><div><p style={{ margin: 0, color: '#e0eef9' }}>One folder for the replay</p><p className="note">Radar volumes, time-windowed placefiles, icons, and a coverage manifest.</p></div></div>
                <ul className="files">
                  <li><span>radar/</span> original Level II files</li>
                  <li><span>placefiles/</span> selected layers + clock check</li>
                  <li><span>manifest.json</span> time rules & missing data</li>
                  <li><span>README.txt</span> GR loading instructions</li>
                </ul>
              </div>
            )}
          </section>
          <section className="panel">
            <h2><Clock3 size={19} color="#88d8f5" /> One replay clock</h2>
            <p>Each observation gets a UTC validity window, so GR shows the right reading for each layer as you play, pause, or step through the archived radar — illustrated below.</p>
            <ReplayClockDiagram />
            <p className="note">After downloading: extract the TAR archive, run FIX_ICON_PATHS.cmd once, open the radar files, and add the local placefiles in GR's Placefile Manager.</p>
            <details>
              <summary>About data & limits</summary>
              <p>Towers expire after 7 minutes, mills after 2, or sooner when replaced; lightning uses your selected trail. Future observations are never shown, and gaps stay visible rather than being filled in.</p>
              <p>Automatic KSC exports cover 2000 through 2059; actual sensor availability is still checked for your selected period, and MERLIN CG/CC retrieval depends on NASA/S3 uptime.</p>
              <p>Verify replay_clock_check.txt against your installed GR2Analyst version before relying on synchronized playback.</p>
            </details>
          </section>
        </div>
      </div>
      <footer className="footer">
        Sources: <a href="https://registry.opendata.aws/noaa-nexrad/" target="_blank" rel="noreferrer">Unidata NEXRAD archive</a> · <a href="https://kscweather.ksc.nasa.gov/wxarchive/" target="_blank" rel="noreferrer">KSC Spaceport Weather Archive</a>
        <br />Station locations and wind icons reuse your existing placefile assets. Raw CSVs are processed temporarily and omitted from the download; scenarios are not saved as a server-side catalog.
      </footer>
    </main>
  );
}
