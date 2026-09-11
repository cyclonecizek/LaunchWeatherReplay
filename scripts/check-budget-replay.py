"""Exercise the public HTTP/worker/download flow against real archive data.

Run from the host alongside the production container, constrained to 512 MB,
no swap, and half a CPU. Never use a fabricated fixture for this capacity trial.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import time
from urllib.request import Request, urlopen
import zipfile

BASE = 'http://localhost:10000'
CONTAINER = 'replay-budget'
OUTPUT = Path('/tmp/replay-budget-trial.zip')


def request(path, body=None):
    r = Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                headers={'Content-Type': 'application/json'})
    with urlopen(r, timeout=20) as response:
        return json.load(response)


def memory():
    # Reading cgroup counters via cat avoids launching an extra Node process.
    values = subprocess.check_output(['docker', 'exec', CONTAINER, 'cat',
                                     '/sys/fs/cgroup/memory.stat', '/sys/fs/cgroup/memory.events'], text=True)
    return dict((key, int(value)) for key, value in (line.split() for line in values.splitlines()))


began = time.monotonic()
job = request('/api/jobs', {'start': '2024-06-25T21:00', 'end': '2024-06-25T23:00', 'radar': 'KMLB',
                          'winds': True, 'fieldmills': True, 'merlin': True,
                          'windHeight': '54', 'trail': 60, 'allowPartial': True})
peak_anon = 0
last_message = None
while job['state'] in ('queued', 'running'):
    if time.monotonic() - began > 70 * 60:
        raise RuntimeError('Capacity trial exceeded 70 minutes')
    request('/api/health')  # The web server must respond throughout the build.
    counters = memory()
    peak_anon = max(peak_anon, counters.get('anon', 0))
    assert counters.get('oom_kill', 0) == 0, counters
    if job['message'] != last_message:
        print(job['message'], flush=True)
        last_message = job['message']
    time.sleep(5)
    job = request('/api/jobs/' + job['id'])
assert job['state'] == 'complete', job
assert job['radarVolumes'] > 0, job
assert all(message.startswith('winds:') for message in job['missing']), job['missing']

hash_value = hashlib.sha256()
with urlopen(BASE + '/api/jobs/' + job['id'] + '/download', timeout=120) as response, OUTPUT.open('wb') as output:
    declared = int(response.headers['Content-Length'])
    for chunk in iter(lambda: response.read(1024 * 1024), b''):
        output.write(chunk)
        hash_value.update(chunk)
assert OUTPUT.stat().st_size == declared == job['size']
with zipfile.ZipFile(OUTPUT) as archive:
    assert archive.testzip() is None
    names = archive.namelist()
    assert not any(n.endswith('.csv') or '/raw/' in n for n in names)
    for suffix in ('/placefiles/fieldmills.txt', '/placefiles/merlin_cg.txt', '/placefiles/merlin_cc_density.txt'):
        assert any(n.endswith(suffix) and archive.getinfo(n).file_size > 200 for n in names), suffix
    manifest = json.loads(archive.read(next(n for n in names if n.endswith('/manifest.json'))))
    assert manifest['config']['lightningMinutes'] == 60
    assert manifest['raw_csvs_included'] is False
counters = memory()
assert counters.get('oom_kill', 0) == counters.get('oom', 0) == 0, counters
print(json.dumps({'filename': job['filename'], 'bytes': job['size'], 'radar_volumes': job['radarVolumes'],
                  'missing': job['missing'], 'elapsed_seconds': round(time.monotonic() - began),
                  'sampled_peak_anonymous_memory_mb': round(peak_anon / 1e6, 1),
                  'oom_events': counters.get('oom', 0), 'sha256': hash_value.hexdigest(),
                  'zip_crc_check': 'passed', 'raw_csvs': False}, indent=2), flush=True)
OUTPUT.unlink()
