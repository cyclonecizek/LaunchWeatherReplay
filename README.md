# Launch Weather Replay

Private scenario builder for GR2Analyst. User selects an archived UTC time range, NEXRAD site, and KSC observation layers, checks source coverage, then downloads a streaming ZIP with original radar volumes, local time-windowed placefiles, raw imported/retrieved observations, and a manifest.

## Current scope and limitations

- NEXRAD inventory/download: Unidata's `unidata-nexrad-level2` archive, paginated by UTC day; MDM files excluded. Maximum 12 hours / 2 GB radar per bundle.
- KSC tower retrieval: four export groups from Brian Cizek's current WINDS_Placefile implementation, split into one-hour chunks. Fixed token year is explicitly limited to 2026.
- Field mills: OneMinuteMean, Date, Time, MillNo CSV and the existing all-mill 2026 token.
- KSC returned 502 gateway errors during development. Live tower/mill retrieval is implemented but has not been verified from the hosted runtime. Manual KSC CSV import is available.
- MERLIN and profiler automatic retrieval is NOT implemented. Strict normalized CSV import is supported, with header templates and explicit units/quality requirements. Actual raw archive exports are still needed to implement and verify their adapters.
- TimeRange v1.5 generation is implemented, but GR2Analyst native playback has NOT been tested. A clock-check placefile is included for the user's installed GR build.
- Only NEXRAD sites with matching public archive keys are retrieved. Cape non-NEXRAD WSR is not connected.
- No scenario database or upload persistence. Download requests carry observation text to the server for ZIP packaging.

## Time semantics

All times are UTC, with an exclusive scenario end. Tower, mill, and profiler observations expire at the earlier of the next selected observation or age limits of 7, 2, and 10 minutes. Lightning detections begin no earlier than their observation time (subsecond starts round up) and expire after the selected trailing window. No future observations, interpolation, or infinite carry-forward. Raw timestamps and source units are retained. No claim is made about observation publication latency at the historical time.

Field-mill display colors are user visualization categories, not launch criteria. Wind barbs reuse the existing 0-60 kt sprite. Profiler input requires heights in meters AGL and displays the nearest available level within 250 m of a selected target. Imported lightning counts are records, not deduplicated flash counts.

## Source provenance

Station coordinates and wind icon: https://github.com/cyclonecizek/WINDS_Placefile and https://github.com/cyclonecizek/EFM_GR2_Placefile . Export token construction is adapted from the user's existing Python scripts. Source URLs and import names accompany each package. No credentials are embedded. TLS certificate verification is not disabled.

## Validation

`tests/replay.test.ts` checks date parsing, 2026 token parity, signed electric fields, coordinate joins, preferred tower side, height filtering, missing-data expiry, future exclusion, fractional lightning times, radar key filtering, and streaming ZIP assembly. Bundle with esbuild to execute with Node. ZIP byte/CRC integrity is independently checked with Python zipfile during development. `npm run build` creates the Worker and browser assets. The stock starter's standalone TypeScript check requires generated Cloudflare ambient types; the build passes.

## Follow-up acceptance test

Use a known event with archived radar, KSC exports, and expected tower/mill observations. Step forward/backward and pause in the user's GR2Analyst installation. Verify the clock check, observation times, gaps, icons after folder extraction, lightning trail, profiler height, and absence of future observations. Test one actual MERLIN and each profiler raw export before implementing their automatic retrieval adapters.


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
