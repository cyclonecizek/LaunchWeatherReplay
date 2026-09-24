"""Print the most recent upper-air sounding at or before a time, as JSON, via siphon.

Usage: fetch-sounding.py <target epoch ms> <station id> <lookback hours>

The University of Wyoming archive only answers exact launch datetimes, so this
tries each whole hour from the target back through the lookback window and
prints the first sounding found:
{"time": <epoch ms>, "url": "...", "levels": [{"presHpa", "hghtM", "tempC"}, ...]}
Exits non-zero with a message on stderr if none is found.
"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone

import requests
from siphon.simplewebservice.wyoming import WyomingUpperAir

# siphon sets no request timeout of its own.
TIMEOUT_SECONDS = 20


def main():
    target_ms, station, lookback = int(sys.argv[1]), sys.argv[2], int(sys.argv[3])
    start = datetime.fromtimestamp(target_ms / 1000, tz=timezone.utc).replace(minute=0, second=0, microsecond=0)
    endpoint = WyomingUpperAir()
    session = endpoint._session
    session.request = _with_timeout(session.request)
    problems = []
    for hours_back in range(lookback + 1):
        when = start - timedelta(hours=hours_back)
        try:
            df = endpoint._get_data(when.replace(tzinfo=None), station)
        except ValueError as e:
            # siphon raises its HTTPError without the response attached; the
            # status only appears in the message as "Server Error ( 404: ...".
            status = re.search(r'Server Error \(\s*(\d+)', str(e.__cause__ or ''))
            # 404 is the archive's answer for an hour with no launch - expected on most hours.
            if not (status and status.group(1) == '404'):
                text = str(e.__cause__ or e)
                problems.append(f'{when:%H}Z: {_short(text[text.find("Server Error"):] if status else text)}')
            continue
        except Exception as e:  # network errors, timeouts, an unexpected page
            problems.append(f'{when:%H}Z: {type(e).__name__}: {_short(e)}')
            continue
        levels = df[['pressure', 'height', 'temperature']].dropna().sort_values('height')
        if len(levels) < 5:
            problems.append(f'{when:%H}Z: only {len(levels)} usable levels')
            continue
        print(json.dumps({
            'time': int(when.timestamp() * 1000),
            'url': endpoint.url_path(f'sounding?type=TEXT%3ACSV&datetime={when:%Y-%m-%d%%20%H:%M:%S}&id={station}'),
            'levels': [{'presHpa': float(p), 'hghtM': float(h), 'tempC': float(t)}
                       for p, h, t in levels.itertuples(index=False)],
        }))
        return 0
    detail = f' Problems: {"; ".join(problems[:3])}' if problems else ''
    print(f'No {station} sounding found in the {lookback} hours before '
          f'{start:%Y-%m-%d %H:%M}Z.{detail}', file=sys.stderr)
    return 1


def _short(error):
    return ' '.join(str(error).split())[:160]


def _with_timeout(request):
    def bounded(*args, **kwargs):
        kwargs.setdefault('timeout', TIMEOUT_SECONDS)
        return request(*args, **kwargs)
    return bounded


if __name__ == '__main__':
    try:
        sys.exit(main())
    except requests.RequestException as e:
        print(f'Sounding request failed: {e}', file=sys.stderr)
        sys.exit(1)
