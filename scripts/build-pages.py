"""Render a static download catalog. GitHub credentials never enter public output."""
import argparse
from datetime import datetime, timezone
from html import escape
import json
import os
from pathlib import Path
import re
import shutil
import zipfile
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent


def render_public_builder(output, api_url):
    parsed = urlparse(api_url)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise ValueError('The replay API URL must be an HTTPS origin without a path or credentials.')
    output.mkdir(parents=True, exist_ok=True)
    for name in ('index.html', 'style.css', 'app.js', 'favicon.svg'):
        shutil.copyfile(ROOT / 'server/public' / name, output / name)
    (output / 'config.js').write_text('window.REPLAY_API_URL = ' + json.dumps(api_url.rstrip('/')) + ';\n')
    # The UI links to the Render copy of this test ZIP, to test its download host.
    with zipfile.ZipFile(output / 'network-test.zip', 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('README.txt', 'Launch Weather Replay network test. No weather data.\r\n')


def fetch_artifacts(repository):
    artifacts = []
    for page in range(1, 4):
        request = Request(
            f'https://api.github.com/repos/{repository}/actions/artifacts?per_page=100&page={page}',
            headers={'Authorization': 'Bearer ' + os.environ['GITHUB_TOKEN'],
                     'Accept': 'application/vnd.github+json', 'User-Agent': 'LaunchWeatherReplay-Pages'})
        with urlopen(request, timeout=30) as response:
            batch = json.load(response)['artifacts']
        artifacts.extend(batch)
        if len(batch) < 100:
            break
    return artifacts


def render(artifacts, repository):
    repo_url = f'https://github.com/{repository}'
    now = datetime.now(timezone.utc)
    scenarios, network, seen = [], [], set()
    # Newest artifact wins when a scenario is rebuilt with the same filename.
    for artifact in sorted(artifacts, key=lambda a: a['created_at'], reverse=True):
        name = artifact['name']
        run = artifact.get('workflow_run') or {}
        if artifact.get('expired') or run.get('head_branch') != 'main' or name in seen:
            continue
        expires = datetime.fromisoformat(artifact['expires_at'].replace('Z', '+00:00'))
        if expires <= now:
            continue
        match = re.fullmatch(r'([A-Z][A-Z0-9]{3})-(\d{12})-(\d{12})(-PARTIAL)?\.zip', name)
        is_test = name == 'GitHub-download-test.zip'
        if not match and not is_test:
            continue
        seen.add(name)
        if is_test:
            title, badge, detail = 'Office download test', 'Network test', 'Small ZIP with a text file. No weather data.'
        else:
            start = datetime.strptime(match[2], '%Y%m%d%H%M')
            end = datetime.strptime(match[3], '%Y%m%d%H%M')
            title = f'{match[1]} · {start:%b %d, %Y}'
            badge = 'Partial scenario' if match[4] else 'Scenario ZIP'
            detail = f'{start:%Y-%m-%d %H:%M} to {end:%Y-%m-%d %H:%M} UTC'
        size = int(artifact['size_in_bytes'])
        size_text = f'{size / 1e6:.1f} MB' if size >= 1e6 else f'{size:,} bytes'
        url = f'{repo_url}/actions/runs/{int(run["id"])}/artifacts/{int(artifact["id"])}'
        card = (f'<article class="card" data-expires="{escape(artifact["expires_at"], quote=True)}">'
                f'<p class="badge {"partial" if match and match[4] else ""}">{badge}</p>'
                f'<h3>{escape(title)}</h3><p>{escape(detail)}</p>'
                + ('<p class="note">Check README.txt for missing sources.</p>' if match and match[4] else '')
                + f'<p class="filename">{escape(name)} · {size_text}</p>'
                f'<a class="button secondary" href="{escape(url, quote=True)}">Download ZIP</a>'
                f'<p class="expiry">Available until {expires:%b %d, %Y %H:%M} UTC</p></article>')
        (network if is_test else scenarios).append(card)
    values = {
        'REPO_URL': repo_url,
        'WORKFLOW_URL': repo_url + '/actions/workflows/build-scenario.yml',
        'SCENARIOS': ''.join(scenarios[:12]) or '<p class="note">No unexpired scenarios yet. Use the build form to create one.</p>',
        'NETWORK_TEST': ''.join(network[:1]) or '<p class="note">Use the build form and select Network test to create a small test ZIP.</p>',
        'UPDATED': now.strftime('%Y-%m-%d %H:%M'),
    }
    html = (ROOT / 'pages/index.html').read_text()
    for key, value in values.items():
        html = html.replace('{{' + key + '}}', value)
    return html


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--catalog', type=Path, help='Local artifact JSON for offline verification')
    parser.add_argument('--output', type=Path, default=ROOT / 'outputs/pages')
    args = parser.parse_args()
    repository = os.environ.get('GITHUB_REPOSITORY', 'cyclonecizek/LaunchWeatherReplay')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Invalid repository name')
    args.output.mkdir(parents=True, exist_ok=True)
    api_url = json.loads((ROOT / 'pages/backend.json').read_text()).get('apiUrl', '')
    if api_url:
        render_public_builder(args.output, api_url)
    else:
        artifacts = json.loads(args.catalog.read_text()) if args.catalog else fetch_artifacts(repository)
        (args.output / 'index.html').write_text(render(artifacts, repository))
    (args.output / '.nojekyll').write_text('')
    print('GitHub Pages built. Only static page assets are published.')
