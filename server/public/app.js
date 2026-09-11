const $ = id => document.getElementById(id);
const api = (window.REPLAY_API_URL || '').replace(/\/$/, '');
const utc = value => new Date(value).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const pad = n => String(n).padStart(2, '0');
let active = false, timer, pollFailures = 0;
for (const part of ['start', 'end']) {
  for (const [unit, count, selected] of [['Hour', 24, 21], ['Minute', 60, part === 'start' ? 0 : 30]]) {
    for (let n = 0; n < count; n++) { const o = new Option(pad(n), pad(n), false, n === selected); $(part + unit).add(o); }
  }
  $(part + 'Date').max = new Date().toISOString().slice(0, 10);
}
const time = part => `${$(part + 'Date').value}T${$(part + 'Hour').value}:${$(part + 'Minute').value}Z`;
function validateWindow() {
  const start = Date.parse(time('start')), end = Date.parse(time('end'));
  if (!Number.isFinite(start + end)) throw Error('Choose both dates.');
  if (end <= start) throw Error('End time must be later than start time.');
  if (end - start > 12 * 3_600_000) throw Error('Choose a window of 12 hours or less.');
  if (end > Date.now() + 60_000) throw Error('Choose a past date and time.');
  return { start, end };
}
function error(message) { $('form-error').textContent = message; $('form-error').hidden = !message; }
function changed(startChanged) {
  if (startChanged && Date.parse(time('start')) >= Date.parse(time('end'))) {
    const later = new Date(Date.parse(time('start')) + 3_600_000).toISOString();
    $('endDate').value = later.slice(0, 10); $('endHour').value = later.slice(11, 13); $('endMinute').value = later.slice(14, 16);
  }
  try { validateWindow(); error(''); $('build').disabled = active; }
  catch (e) { error(e.message); $('build').disabled = true; }
}
for (const part of ['start', 'end']) for (const unit of ['Date', 'Hour', 'Minute']) $(part + unit).addEventListener('change', () => changed(part === 'start'));
$('winds').onchange = () => { $('windHeight').disabled = !$('winds').checked; };
$('merlin').onchange = () => { $('trail').disabled = !$('merlin').checked; };
$('network-test').href = api + '/network-test.zip';
function busy(value) { active = value; $('build').disabled = value; $('build').textContent = value ? 'Build in progress…' : 'Build scenario ZIP'; }
function render(job) {
  $('status-heading').textContent = ({ queued: 'Waiting to build', running: 'Building your replay', complete: job.missing?.length ? 'Partial replay ready' : 'Your replay is ready', failed: 'Build could not finish', expired: 'Download expired' })[job.state] || 'Checking build';
  $('status').textContent = (job.state === 'queued' ? `Queue position ${job.position}. ` : '') + job.message;
  $('job-window').textContent = `${job.radar} · ${utc(job.start)} to ${utc(job.end)}`;
  const pending = ['queued', 'running'].includes(job.state); busy(pending); $('progress').hidden = !pending;
  $('another').hidden = pending; $('download').hidden = job.state !== 'complete'; $('expiry').textContent = '';
  $('missing').replaceChildren(); $('missing').hidden = !job.missing?.length;
  for (const message of job.missing || []) { const li = document.createElement('li'); li.textContent = message; $('missing').append(li); }
  if (job.state === 'complete') {
    $('download').href = `${api}/api/jobs/${job.id}/download`;
    $('download').textContent = `Download ${job.missing?.length ? 'partial ' : ''}ZIP · ${(job.size / 1e6).toFixed(1)} MB`;
    $('expiry').textContent = `${job.radarVolumes} radar volumes. Available until ${utc(job.expiresAt)}.`;
  }
  return pending;
}
async function check(id) {
  clearTimeout(timer);
  try {
    const response = await fetch(`${api}/api/jobs/${id}`, { signal: AbortSignal.timeout(15_000) });
    const job = await response.json(); if (!response.ok) throw Error(job.error || 'Could not check the build.');
    pollFailures = 0;
    if (render(job)) timer = setTimeout(() => check(id), 4000);
  } catch (e) {
    $('status').textContent = `Could not check progress: ${e.message} Retrying shortly. Your build may still be running.`;
    $('another').hidden = false;
    timer = setTimeout(() => check(id), Math.min(30_000, 5000 * ++pollFailures));
  }
}
$('scenario').onsubmit = async event => {
  event.preventDefault(); if (active) return;
  try {
    validateWindow(); error(''); busy(true);
    const body = { start: time('start'), end: time('end'), radar: $('radar').value.trim().toUpperCase(),
      winds: $('winds').checked, fieldmills: $('fieldmills').checked, merlin: $('merlin').checked,
      windHeight: $('windHeight').value, trail: Number($('trail').value), allowPartial: $('allowPartial').checked };
    const response = await fetch(`${api}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    const job = await response.json(); if (!response.ok) throw Error(job.error || 'Could not start the build.');
    history.replaceState(null, '', '#job=' + job.id); render(job); check(job.id);
  } catch (e) { busy(false); error(e.message); }
};
$('another').onclick = () => { clearTimeout(timer); history.replaceState(null, '', location.pathname + location.search); busy(false); $('another').hidden = true; changed(false); $('scenario').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
const saved = /^#job=([a-f0-9]{48})$/.exec(location.hash);
if (saved) { busy(true); check(saved[1]); }
