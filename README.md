# Launch Weather Replay

Scenario builder for GR2Analyst. Select an archived UTC time range, NEXRAD site,
and KSC observation layers, check source coverage, then download a streaming ZIP
with original radar volumes, synchronized placefiles, raw observations, and a
coverage manifest.

## Current scope and limitations

- NEXRAD inventory/download: Unidata's `unidata-nexrad-level2` archive, paginated by UTC day; MDM files excluded. Maximum 12 hours / 2 GB radar per bundle.
- KSC tower retrieval: four export groups from Brian Cizek's WINDS_Placefile implementation, split into one-hour chunks. The archive year token supports 2000 through 2059; actual sensor availability is checked for the selected period.
- Field mills: automatic retrieval of signed one-minute means using the same 2000–2059 archive year encoding. Manual CSV import is also supported.
- MERLIN: automatic Cloud-to-Ground and Cloud-to-Cloud retrieval in five-minute intervals, including the selected lookback before the replay begins. Checked source data is reused during ZIP assembly to avoid repeated Worker subrequests. CG detections remain individual markers. CC detections are grouped into approximately 1 km density cells refreshed once per minute.
- Wind profilers are intentionally deferred.
- TimeRange v1.5 generation is implemented, but GR2Analyst native playback has NOT been tested. A clock-check placefile is included for the user's installed GR build.
- Only NEXRAD sites with matching public archive keys are retrieved. Cape non-NEXRAD WSR is not connected.
- No scenario database or upload persistence. Download requests carry observation text to the server for ZIP packaging.

## Time semantics

All times are UTC, with an exclusive scenario end. Tower, mill, and profiler observations expire at the earlier of the next selected observation or age limits of 7, 2, and 10 minutes. Lightning detections begin no earlier than their observation time (subsecond starts round up) and expire after the selected trailing window. No future observations, interpolation, or infinite carry-forward. Raw timestamps and source units are retained. No claim is made about observation publication latency at the historical time.

Field-mill display colors are visualization categories, not launch criteria. Wind
barbs reuse the existing 0-60 kt sprite. MERLIN counts are detection records, not
independently identified flashes.

## Source provenance

Station coordinates and wind icon: https://github.com/cyclonecizek/WINDS_Placefile and https://github.com/cyclonecizek/EFM_GR2_Placefile . Export token construction is adapted from the user's existing Python scripts. Source URLs and import names accompany each package. No credentials are embedded. TLS certificate verification is not disabled.

## Validation

`tests/replay.test.ts` checks date parsing, archive token construction, signed
electric fields, coordinate joins, tower selection, missing-data expiry, future
exclusion, radar key filtering, and streaming ZIP assembly. `tests/merlin.test.ts`
checks MERLIN tokens, coordinate formats, interval boundaries, trail expiry,
subsecond times, grouped CC cells, and source hash consistency. `npm run build`
creates the Worker and browser assets.

## Follow-up acceptance test

Use a known event with archived radar and KSC observations. Step forward, backward,
and pause in GR2Analyst 3.0, 3.2, and 3.4. Verify the clock check, observation
times, gaps, icon paths, CC density, lightning trail, and absence of future
observations.


## Cloudflare deployment

This is a full-stack Cloudflare Worker application. It serves the interface and the
server-side radar, KSC, MERLIN, and ZIP routes from one deployment.

In Cloudflare Workers Builds, use:

- Production branch: `main`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Root directory: `/`

The included `wrangler.jsonc` deploys the generated Worker from
`dist/server/index.js` and serves the built interface from `dist/client`.
