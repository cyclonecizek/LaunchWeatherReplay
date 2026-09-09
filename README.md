# Launch Weather Replay

Build a complete GR2Analyst replay ZIP on GitHub: archived Level II radar plus
synchronized wind towers, field mills, MERLIN CG, and grouped CC placefiles.
Raw CSVs are used temporarily during generation and are **not downloaded**.
Profilers are deferred.

## Start here: test the office download

1. Sign into GitHub and open [Build GR scenario](https://github.com/cyclonecizek/LaunchWeatherReplay/actions/workflows/build-scenario.yml).
2. Open the latest successful run and download `GitHub-download-test.zip` under **Artifacts**. The initial setup also attempts the June 25, 2024, 21:00–21:30 UTC weather scenario in a separate job.
3. Extract the test ZIP once and open `README.txt`. This tests a real GitHub artifact download, not just access to github.com. It contains no weather data.
4. If the download is blocked, give IT the exact blocked URL. No Cloudflare URL is used by this workflow.

## Build your scenario

1. On the same workflow page, click **Run workflow** and use branch `main`.
2. Select **Weather scenario**. Enter start and end as `YYYY-MM-DDTHH:MM`, in 24-hour UTC. End must be later than start, including the next date if crossing midnight.
3. Choose the radar site, observation layers, wind height, and lightning trail (up to 60 minutes).
4. Leave **Allow partial** unchecked to stop if a selected KSC layer fails. If deliberately enabled, the ZIP is named `PARTIAL` and the missing layers are identified inside.
5. Click **Run workflow**, wait for the green check, then download the ZIP under **Artifacts**. Extract once, follow `README.txt`, and verify the clock-check placefile in GR before adding the weather layers.

You need repository write access to start a workflow and a GitHub login with read
access to download its artifacts. Files expire after seven days; save them locally.
The ZIP is uploaded directly, with no extra ZIP wrapped around it.

## Package contents

- `radar/<site>/`: unchanged archived Level II volumes.
- `placefiles/`: selected weather layers and the replay clock check.
- `placefiles/wind_barb.png` and `FIX_ICON_PATHS.cmd`: included when towers are available. Instructions also explain manually setting the icon path if scripts cannot run.
- `README.txt`: GR setup and missing-source notes.
- `manifest.json`: small coverage/provenance record, including source hashes; no raw CSVs.

GitHub retrieves sources and writes files to temporary disk. A standard ZIP writer
finishes the archive, reopens it, checks every file CRC and the complete file list,
and only then makes it available. Failed required transfers publish no new ZIP.
The job has a 2 GB total uncompressed package limit and a 12-hour scenario limit;
there is no separate 20 MB observation limit and no 45-radar-volume cap.

Automatic source requests still depend on NASA/S3 availability. KSC export tokens
were verified against supplied 2024/2026 examples; other encoded years (2000–2059)
remain inferred, not independently verified archive coverage. Missing data is
reported rather than invented. The workflow does not bypass TLS checks or use
browser session cookies.

## Development

- `npm ci`
- `npm run test:scenario` checks parsing, UTC boundaries, the disk-based generator,
  interrupted transfers, missing layers, and completed ZIP contents with fixture data.
- `npm run scenario` builds the default 2024-06-25 21:00–21:30 UTC case. Override
  inputs with the `SCENARIO_*` environment variables in the workflow.
- `SCENARIO_MODE='Network test' npm run scenario` builds the small access-test ZIP.

Pushes affecting the generator run tests and create the small network-test ZIP.
Including `[trial-scenario]` in the commit message also attempts the default real
weather case. Manual runs use the selected form settings.

GitHub Actions is the current GitHub-hosted interface. A separate GitHub Pages
catalog is not required for these downloads. The existing Cloudflare page remains
available, links to this workflow, and also omits raw CSVs from its TAR downloads;
its request-size and runtime limits still apply.

## Time semantics

All times are UTC, with an exclusive scenario end. Tower and mill observations expire at the earlier of the next selected observation or age limits of 7 and 2 minutes. Lightning detections begin no earlier than their observation time (subsecond starts round up) and expire after the selected trailing window. No future observations, interpolation, or infinite carry-forward. Source timestamps and units are used in the placefiles; raw CSVs are not included. No claim is made about observation publication latency at the historical time.

Field-mill display colors are visualization categories, not launch criteria. Wind
barbs reuse the existing 0-60 kt sprite. MERLIN counts are detection records, not
independently identified flashes.

## Source provenance

Station coordinates and wind icon: https://github.com/cyclonecizek/WINDS_Placefile and https://github.com/cyclonecizek/EFM_GR2_Placefile . Export token construction is adapted from the user's existing Python scripts. Source URLs and import names accompany each package. No credentials are embedded. TLS certificate verification is not disabled.

## Validation

`tests/replay.test.ts` checks date parsing, archive token construction, signed
electric fields, coordinate joins, tower selection, missing-data expiry, future
exclusion, radar key filtering, and streaming TAR assembly. `tests/merlin.test.ts`
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
server-side radar, KSC, MERLIN, and TAR routes from one deployment.

In Cloudflare Workers Builds, use:

- Production branch: `main`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Root directory: `/`

The included `wrangler.jsonc` deploys the generated Worker from
`dist/server/index.js` and serves the built interface from `dist/client`.
