# Public Launch Weather Replay on Render

This runs the existing disk-based scenario builder behind a public form. Visitors choose their UTC dates and sources, wait on the page, and download a completed ZIP. They do not need a GitHub or Render account. GitHub Actions remains useful for automated code checks and publishing the static Pages frontend, but it does not build visitor scenarios in this setup.

## Deploy

1. In Render, select **New > Blueprint** and connect GitHub if prompted.
2. Give Render access to `cyclonecizek/LaunchWeatherReplay` and select that repository and its `main` branch.
3. Use the repository's `render.yaml` file. It defines one Docker web service named `launch-weather-replay`, a `1c-2g` compute plan (1 CPU, 2 GB RAM), and a 10 GB persistent disk. No Redis, database, GitHub token, or KSC browser cookies are needed.
4. Review Render's price before confirming deployment. As checked September 11, 2026, the compute plan is $25/month and disk storage is $0.25/GB/month, so these resources total about $27.50/month, plus any workspace charges, usage overages and tax. This is not a billing cap. Verify the current total in Render. Do not select the free service: it cannot attach this persistent disk.
5. After deployment is **Live**, open the assigned `https://...onrender.com` URL. Try **Download test ZIP** from the office network first. A GitHub Pages frontend still contacts this Render domain for builds and downloads; it cannot bypass office filtering.
6. Try a short real scenario. The June 25, 2024, 21:00–21:30 UTC trial previously returned field mills and MERLIN, but tower groups returned no observations. Select **Allow a partial package** if you want the remaining data when a source fails. Missing sources remain visible and the archive name includes `PARTIAL`.
7. To use the existing GitHub Pages address for the public form, put the Render origin into `pages/backend.json`, for example `{"apiUrl":"https://your-service.onrender.com"}`, and commit it. The Pages workflow publishes the form automatically after that commit. Repository Settings > Pages > Source must be GitHub Actions. The actual scenario work runs on Render, without manually running workflows. The current empty value preserves the older catalog until a real backend URL is available.

Render's Blueprint tracks `main` and automatically deploys commits. Because the service has a persistent disk and a single instance, a deployment interrupts any running build; queued jobs resume and completed downloads remain. Avoid deployments during a large active build. Interrupted jobs show an explicit retry message rather than offering an incomplete file.

## Defaults and limits

- One build runs at a time, with at most five queued/running jobs and 20 accepted builds per rolling 24 hours across all visitors. Environment settings in `render.yaml` control these limits. These are starter capacity limits, not a guarantee against automated traffic or bandwidth charges.
- The builder keeps the 12-hour window and 2 GB uncompressed GR package limits. It streams radar and placefiles to disk, excludes raw CSVs, writes a complete ZIP, and checks every entry's CRC before publishing the download. Downloads have a known length and support byte ranges.
- Source requests use bounded chunks. Individual source-response safety limits remain; large or unusually active windows may still need splitting. A two-hour build timeout and a separate worker memory limit protect the web service.
- Completed ZIPs expire after 24 hours. Admission pauses when fewer than 4.2 GB remain free, reserving space for one maximum-size working folder plus its ZIP. Existing downloads are not evicted early to accept new builds. The queue is saved on `/var/data/replay` and survives restarts; failed and expired metadata is removed after at least 48 hours.
- Job links use random identifiers and are not listed publicly. Anyone with a link can see that job and download it until expiry. No visitor account data is collected by this application.
- KSC retrieval uses the validated intermediate certificate in `scripts/ksc-trust.sh`; TLS verification stays enabled. Render supplies `RENDER_EXTERNAL_URL` automatically for same-origin requests. `REPLAY_ALLOWED_ORIGINS` additionally permits the Pages origin. Add an exact custom-domain origin there if you later use one.
- GR replay synchronization still needs checking in GR2Analyst 3.0, 3.2, and 3.4. The replay clock placefile and README explain that check. ZIP integrity alone does not establish GR compatibility.

## Local checks and runtime

Run `npm ci`, `npm run test:scenario`, and `npm run prepare:render`. The separate Render HTTP server starts with `npm run start:render` (port 10000 by default). The existing `npm run build` and `npm start` are the older Cloudflare/Vinext application and are not used by this Docker service.

The production Docker image installs Python for ZIP creation and validates the KSC certificate chain at build time. The `Verify Render server` workflow builds the image, starts it with persistent storage, checks the public form/health endpoint, verifies the test ZIP, and probes KSC TLS. This automated verification is independent of visitor requests.
