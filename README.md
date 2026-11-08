# LeakLoop

A working local application for investigating simulated campus water anomalies. Next.js + TypeScript + Tailwind + Three.js, backed by a relational Postgres database, account authentication and a durable agent worker.

Evergreen Campus, people, complaints, schedules and telemetry are fictional. The app has no hardware connection, field deployment, proven water saving, guaranteed leak diagnosis, external messaging or valve control. No production deployment has been performed.

## Start the tested local copy

The workspace source is this `leakloop` directory. Start the persistent macOS runtime from here:

```sh
npm run local:macos
```

This prepares the isolated local database, applies migrations, installs locked dependencies, builds, and runs the API/UI plus worker at http://127.0.0.1:3001. The runtime is `~/Library/Application Support/LeakLoop/runtime`; PostgreSQL data is in the sibling `postgres` directory, listening on loopback port 55433. Requires Node, Python 3, npm and Homebrew PostgreSQL with `pg_config` on PATH.

Ctrl-C stops the app and worker; the database remains running. Run the same command after reboot. These files survive temporary-directory cleanup. For an externally managed database, follow “Set up from source” below instead.

## Accounts

Sign in with a real local password account. **Demo identity switching is disabled.** Account IDs and roles come from the database; client-supplied role fields are rejected.

The account initializer creates Ava (manager), Ravi/Maya (technicians), and an operator with independent random passwords. Read `.local-accounts.json` in this source directory or the runtime directory to obtain the credentials. It is ignored by Git, owner-readable only, outside `public/`, and never served by the application. Passwords are not printed by setup. The manager email is `ava@evergreen.local`.

To change roles during a demonstration, sign out and sign in with the relevant account. An unassigned technician sees an empty assignment screen, not another technician's operational evidence.

### Account lifecycle

- **Invitations** (Administration → People & access): a manager sets name, email and role (technicians can be linked to a roster entry so they can receive work). The one-time link is shown once and expires after 72 hours; the invited person chooses their own password. Roles are always assigned by a manager and enforced server-side.
- **Password recovery**: “Forgot password?” sends a single-use, 30-minute link through the configured mail transport. The default `file` transport writes messages to an owner-only local outbox (`.data/outbox`); nothing leaves the machine unless `MAIL_TRANSPORT=smtp` is configured. Managers can also issue a one-time reset link. Completing a reset signs out every session.
- **Sessions** (Account): list and revoke your sessions or sign out everywhere else; changing your password signs out other sessions. Sessions expire after 12 hours or 2 hours idle. Managers can disable people or change roles (never their own; the last manager is protected), which revokes that person's sessions.
- **SSO**: optional OpenID Connect (authorization code + PKCE, state, nonce, signature/issuer/audience checks). An identity signs in only if it matches an existing account (by issuer+subject, or a verified email), or an open invitation. Identity-provider role or group claims are ignored.
- **First real manager**: `npm run auth:bootstrap -- --email … --name …` prints a one-time set-password link.
- An append-only security log (Administration → Security log) records sign-ins, failures, invitations, resets, session revocations, role changes and device key changes. MFA and email-address verification are not implemented.

## Set up from source

Requires Node 22.13+ (tested with Node 25.9), npm, and Postgres 15+ or a Supabase Postgres connection.

```sh
npm ci
cp .env.example .env.local
# Set DATABASE_URL to your trusted server-side Postgres connection.
npm run setup
npm run build
npm run local
```

`setup` runs versioned migrations, fictional campus seeding and account initialization. It preserves existing campus progress and existing users. Run the API and worker separately if preferred:

```sh
npm start -- --port 3001
# In another terminal:
npm run worker
```

For Supabase, use the server-only direct or session-pooler Postgres URL, with your provider's SSL configuration. No database credential is sent to the browser. The migration enables RLS with no public/anonymous policies; access uses a trusted server database role. This remains a single-campus application, not a multi-tenant platform.

## Backend architecture

- `migrations/002_backend.sql` creates relational tables for campuses, users, sessions, buildings, readings, technicians, incidents, proposals, verification records, work orders, assignment history, evidence requests, agent runs, tool executions, jobs and audit events.
- Foreign keys, checks and unique indexes enforce references, valid reading quality, one work order per incident, one active assignment per technician, and one active agent job per incident.
- `lib/repository.ts` loads a domain view from those tables. Complex notes/plans remain JSONB payloads attached to individual records; the campus is no longer stored as one writable JSON snapshot.
- `lib/engine.ts` remains the deterministic domain policy: authorization, state transitions, calculations, verification thresholds and approval requirements.
- Mutations lock the campus revision in a short transaction. Optimistic revisions reject stale clients. Durable idempotency receipts bind a command key to the actor and canonical request payload; reusing a key with different content returns 409.
- Passwords use salted scrypt hashes. Session cookies contain random opaque tokens; only token hashes are stored. Sessions expire after 12 hours and are revoked on sign-out. User role/active-state changes are read on subsequent requests.
- Requests have strict Zod schemas, bounded bodies, same-origin mutation checks, role checks, database-backed rate limits and generic error responses with request IDs. Five failed account logins within 15 minutes lock that account for 15 minutes.
- Technicians can mutate only their assignments, and their incident/evidence/run responses are filtered to those assignments. Campus telemetry remains readable by campus staff. Audit access is manager-only.
- Audit and assignment-history rows are append-only through database triggers. A database administrator can still administer the database; this is not a claim of cryptographic tamper resistance.

See `docs/API.md` for the endpoint contract and `docs/BACKEND.md` for persistence, worker recovery and migration details. Operations (health, logs, backups, tested restore, retention, shutdown) are in `docs/OPERATIONS.md`; Docker, CI, migrations and hosting preparation are in `docs/DEPLOYMENT.md`.

## Real telemetry, evidence attachments and model usage

- **Real telemetry** (Administration → Telemetry devices): managers register a device for a building and receive a one-time bearer key (stored only as a hash; rotate or revoke at any time). Devices `POST /api/v1/ingest/readings` in batches. Timestamps, values and quality are validated per item; identical resubmissions are idempotent, conflicting values never overwrite stored readings, and implausible values are kept as `faulty`. Readings are queryable with keyset pagination or 15-minute/hourly/daily aggregates over valid readings only. **Real readings are labelled `device`, stored separately and never mixed into the simulated scenario**, which still drives incidents, charts and verification.
- **Evidence attachments** (Incident workspace and technician view): photos (JPEG/PNG/WebP), PDFs and plain-text documents, up to 10 MB and 50 per incident, identified by content not extension. Managers and the assigned technician (while work is active) can upload; unassigned technicians and operators cannot see them. Storage is a private local directory or any S3-compatible bucket. Each record keeps immutable provenance (uploader, role, server and simulated time, incident state, SHA-256); downloads are integrity-checked. Deletion is a recorded soft delete. Attachments are not analysed by the agent and never change verification results.
- **Model usage** (Administration → Model usage): every live-model request is recorded with tokens, latency, provider request ID, outcome and cost (when prices are configured).

## Durable agent jobs

The API returns **202 Accepted** with a job ID. A separate worker claims jobs using `FOR UPDATE SKIP LOCKED`, a unique lease token and a 60-second lease. It checkpoints each tool result, history and run progress in a transaction. Model calls happen outside database locks. Evidence/revision changes during a model request cause a replan rather than applying the stale choice.

A restarted worker can reclaim an expired lease and continue from saved results. A late worker with an old lease cannot commit. Jobs allow three delivery attempts, eight decisions and at most two tool attempts per decision. The per-delivery 30-second execution budget is checked between steps; an in-flight API call has an eight-second timeout. A reset switches to a new scenario generation and cancels old pending/running jobs. Old records remain queryable in the database for history.

The browser polls job status, shows queued/running states, and restores the workflow after reload. `/api/health` reports database and worker readiness. `npm run maintenance` removes expired/revoked sessions and old rate-limit/heartbeat rows; it does not purge operational history.

## Model modes

`AGENT_MODE=demo` is an explicitly labelled deterministic policy, with no API credentials or calls. For the live adapter set `AGENT_MODE=live`, `OPENAI_API_KEY` and `OPENAI_MODEL` in the API and worker environments, then restart both. Credentials remain server-side. Configuration is validated at startup and by `/api/health/ready`; with live mode selected but unconfigured, investigations are refused (503) instead of queued. Mode changes never silently fall back to demo. Requests time out after `AGENT_MODEL_TIMEOUT_MS` (default 8 s); timeouts, 429 and 5xx are retried by requeueing, while authentication errors, refusals, incomplete responses, multiple tool calls and disallowed tools fail the job visibly. Costs remain unavailable (not zero) unless both rates are configured. The model can only gather evidence and propose; creating a work order requires a current manager-approved proposal, and closure is a manager-only command.

The OpenAI Responses adapter follows the [official function-calling documentation](https://developers.openai.com/api/docs/guides/function-calling). `npm run test:live-agent` verifies request construction, parsing, usage recording, timeouts and failure handling against a **local mock** endpoint. A real credentialed model call was not made in this delivery; `npm run agent:check -- --yes` performs one when you configure credentials. The measured evaluation uses the deterministic policy.

## Product workflow

1. As manager, open Incidents and run investigation. The durable job checks meter readings, schedules, resident reports, maintenance and availability.
2. Review cited evidence and the versioned proposal. Approve to assign a non-invasive inspection.
3. Sign in as the assigned technician, accept, record observations, complete the checklist and report completion.
4. Sign in as operator and advance the simulated clock by 60 minutes.
5. Sign in as manager and evaluate fresh readings. Scenario A can reach human-confirmed closure. Scenario D stays open and requests further investigation.

The incident state machine is Detected → Investigating → Awaiting evidence/approval → Assigned → In progress → Awaiting verification → Ready for closure → Closed, with returns to investigation on contradictory evidence.

Verification requires a full 60-minute window, at least 80% valid 15-minute buckets, a current reading no older than 20 minutes, and both post-report samples and the latest reading inside the expected range. Four expected samples mean the coverage rule requires all four. Null/faulty readings are never treated as zero. A completion report alone cannot close an incident; closure rechecks evidence and requires a manager.

## Interface and scenarios

All six connected screens remain implemented: campus overview, incident workspace, maintenance board, mobile technician view, verification and simulation controls. The brutalist UI includes a client-side Three.js campus schematic linked to meter/chart selection, orbit/reset controls and optional flow animation. The geometry/animation is illustrative, not a measured campus map or hydraulic simulation. WebGL has a fallback, and motion starts paused and respects reduced-motion preferences.

Scenarios A–F cover persistent overnight flow, scheduled demand, technician decline, failed repair, missing telemetry and duplicate reports. The simulation clock is paused by default; when running, one real second represents one simulated minute, advanced lazily on polling and capped at 240 minutes per poll. Simulated operational time is separate from actual execution latency.

## Verification and evaluation

```sh
npm run typecheck
npm test
npm run test:backend       # pause the continuous worker first; restores the campus afterward
npm run test:api           # API + worker running; uses local accounts and restores the campus
npm run evaluate           # 24 synthetic fixtures, including 6 held-out variants
npm run build
npm run test:accounts      # invitations, recovery, sessions, admin, SSO (local mock IdP), SMTP (local sink)
npm run test:telemetry     # device keys, ingestion validation, duplicates, pagination, separation
npm run test:attachments   # validation, access control, provenance, integrity, local + fake-S3 storage
npm run test:live-agent    # live adapter against a local mock Responses API
npm run test:restore       # backup → restore drill into a scratch database
npm run test:http          # API + worker running; production endpoints over HTTP
```

Each suite writes a machine-readable report to `evaluation/*-results.json`. CI (`.github/workflows/ci.yml`) runs all of them.

Current backend validation is in `docs/BACKEND.md`; detailed machine-readable results are in `evaluation/backend-results.json` and `evaluation/api-results.json`. The earlier UI/evaluation report remains in `docs/VALIDATION.md`, and the reproducible evaluation protocol in `docs/EVALUATION.md`. See `docs/DEMO.md` for the failed-repair demo.

## Persistent local startup on macOS

Run `npm run local:macos` from the workspace after installing Node, Python 3 and Homebrew PostgreSQL (`pg_config` must be on PATH). This prepares dependencies, applies migrations, preserves existing users/campus data, builds the app, and starts the API plus worker at http://127.0.0.1:3001. It uses an isolated loopback database on port 55433.

The runtime and PostgreSQL cluster live under `~/Library/Application Support/LeakLoop/`, outside macOS temporary storage. Stop the app and worker with Ctrl-C; the database remains available. Run the same command again after reboot. Local passwords are in the runtime’s owner-only `.local-accounts.json`; keep this directory private and back up its database with `pg_dump`. The ordinary `npm run local` command still supports your configured database and requires a completed build.

Recovery on November 9 found that the previous `/private/tmp` runtime and database had been cleared. The older workspace cluster was recovered but contained no saved campus activity; setup initialized a fresh fictional campus; progress stored only in the removed temporary cluster could not be recovered. Persistent startup prevents that specific loss from recurring. It does not provide automatic backups.

## Limits

This is a tested local foundation with production-oriented features, not a completed production deployment. It has one campus and simulated scenario telemetry. Real device ingestion, invitations, recovery, SSO, attachments, a live model adapter, backups and Docker/CI are implemented, but SSO, SMTP, S3 and the live model were verified only against local stand-ins (see `docs/OPERATIONS.md` → Known limitations). It does not include MFA, document parsing, hardware integration, real message recipients, or an externally managed job broker. The aggregate domain service serializes campus mutations; a high-volume telemetry deployment would need narrower transactions, ingestion/retention policies and load testing. Historical scenario generations and command receipts are retained; no operational-history cleanup policy is automatically applied.

No live-model quality/latency/cost, hosted Supabase integration, TLS proxy configuration, multi-instance load, real identity provider, real mail provider or real object store was tested. Backup restoration was tested into a scratch database on the same server. No field performance or avoided-water-loss claim is made.
