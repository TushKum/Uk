> This is the historical UI-phase report. For the current relational backend and authentication checks, see `docs/BACKEND.md` and the machine-readable backend/API reports.

# Verified locally · 8 November 2026

All tests used fictional operational data and deterministic demo mode. No GitHub push, deployment, valve control, spending commitment or real communication occurred.

## Executed checks

| Check | Measured result |
| --- | --- |
| `npm test` | 26 tests passed, 0 failed |
| `npm run typecheck` | Passed with no TypeScript errors |
| `npm run build` | Production Webpack build passed; all application/API routes generated |
| `npm run test:integration` | 5 Postgres integration checks passed |
| `npm run test:api` | 27 HTTP commands passed across normal and failed-repair workflows |
| `npm run evaluate` | 24 labelled fixtures, including 6 held-out variants; detailed JSON saved |

The Postgres integration suite verified state/run persistence, reloading from the DB, one work order, command replay without mutation, and a concurrent write conflict (one succeeds and one is rejected). It restores the prior aggregate after the test. The HTTP suite verified the real server's role rejection, approval idempotency, completion-to-verification transition, missing-window rejection, normal human closure, failed-repair reopening, and identical state on reload.

The workflow suite additionally covers reassignment after decline, unavailable/conflicting technicians, stale approvals, missing/faulty readings, insufficient 75% data coverage, stale initial data, tool retry, contradictory inspection evidence, bounded agent execution, rejection of complaint-embedded instructions, session signature tampering, origin validation, and fresh abnormal readings arriving after an initially good verification window.

## Browser verification

Using the Codex in-app browser:

- Opened the real production app at 127.0.0.1:3001; automatic local demo sign-in and dashboard data loaded.
- Ran scenario D through reset, investigation, manager approval, technician acceptance, checklist, saved observation and completion report.
- Tested the technician layout at **390 × 844** and the management layout at the default **1280 × 720** viewport.
- Advanced the simulated clock by 60 minutes as the operator; evaluated as manager. The page showed **anomaly persists**, **100% data coverage**, a **125.3 L/min** post-report mean and an open incident with a follow-up proposal.
- Stopped and restarted the application, then reloaded. The same failed outcome, report, proposal and **revision 34** remained intact in Postgres.
- Checked the final mobile SIMULATION / DEMO MODE label and selected Science Centre to confirm the consumption chart changes buildings.
- Saved `docs/screenshots/failed-repair.png`, `campus-overview.png`, and `mobile-overview.png`.

Mobile inspection and completion were exercised through browser controls. Normal closure was exercised through the HTTP API and workflow tests. Not every pixel, keyboard path or assistive technology was exhaustively tested; this is not an accessibility certification. The temporary viewport override was reset after testing.

## Measured synthetic evaluation

| Metric | Deterministic agent | Threshold baseline |
| --- | --- | --- |
| False dispatch alarms | 0 / 24 | 4 / 24 |
| Missed labelled flow anomalies | 0 / 16 | 0 / 16 |
| Incorrect closures | 0 / 24 | 4 / 24 |
| Correct reassignments after decline | 4 / 4 | 0 / 4 |
| Successful scenario completion | 24 / 24 | 8 / 24 |
| Mean simulated minutes to actionable work order | 8.75 | 0 |
| Tool attempts | 208 | 0 |

The dispatch timing includes a configured human-review delay in the agent workflow; baseline dispatch is immediate. It is not a measurement of real staff response time. Actual evaluator execution times, per-case outcomes and development/held-out aggregates are in `evaluation/results.json`. They are harness timings, excluding DB/browser/API latency. All model latency and cost are zero in deterministic mode; live-mode performance is not represented by these figures.

See `docs/EVALUATION.md` for labels and baseline rules. These are small within-family synthetic holdouts, not evidence of field performance or guaranteed diagnosis. No water-saving estimate is reported.

## Environment findings and remaining verification limits

The host returned filesystem read timeouts for dependencies and Postgres data under Documents. An isolated runnable mirror at `/private/tmp/leakloop-runtime` and Postgres cluster at `/private/tmp/leakloop-postgres` avoided those failures. The final build, tests and browser checks used that mirror; application source was kept synchronized with the workspace `leakloop` directory. The unused Documents-based database was stopped. The final preview server was stopped after QA; restart it with:

```sh
cd /private/tmp/leakloop-runtime
npm start -- --port 3001
```

The working local Postgres instance uses port **55433** and remains available for the demo. If it has stopped, run the `pg_ctl` command in README. Temporary directories may be cleaned by the OS; use a persistent database and the source setup for longer-lived work. The source `.env.example` supports a regular Postgres/Supabase connection.

Turbopack failed when its Tailwind worker could not bind a local IPC port; the final reproducible build command uses Next.js Webpack. A permission review timed out once during checks; a smaller retry succeeded. No task remains blocked by approval review.

The live API adapter is implemented and typechecked. Missing live credentials were tested to fail explicitly without demo fallback. A real authenticated model call, Supabase-hosted DB, production SSO, external recipients, hardware telemetry and background crash recovery were **not** tested. Completed workflow/run records survive restart; an interrupted in-flight aggregate transaction rolls back and can be retried, rather than resuming a partially executed run.

## Three.js / brutalist UI follow-up

TypeScript, all 26 existing workflow tests, and the production build passed after this UI change. Browser QA confirmed a WebGL canvas rendered, numbered building selection updated both the selected meter and consumption chart, and play/pause and camera reset controls responded. The 1440 × 1000 desktop and 390 × 844 mobile layouts were inspected; mobile document width was 390 pixels with no page-wide horizontal overflow. The model is a fictional schematic, with an explicit non-WebGL fallback. No live model or external operational calls were introduced. The existing user-run preview on port 3001 was restarted with the new build.

Direct clicking on the 3D Campus Commons building selected WM-003 and updated the chart to the Commons expected range. Navigation away removed the canvas; returning recreated one canvas. The narrow 803-pixel desktop layout was also inspected and its headline clipping corrected. Screenshot: `docs/screenshots/brutalist-overview.png`.
