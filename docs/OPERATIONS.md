# Operations

How to run, observe, back up, restore and maintain LeakLoop. The limits stated at the end are deliberate; read them before relying on this for real operations.

## Processes

| Process | Command | Notes |
| --- | --- | --- |
| API + UI | `npm start -- --port 3001` (or `npm run local` for API + worker together) | Stateless; any number can share one database. |
| Agent worker | `npm run worker` | Claims durable jobs with leases. Exits immediately if the configuration is invalid. |
| Maintenance | `npm run maintenance` | Retention cleanup (see below). Run hourly or daily from a scheduler. |
| Backup | `npm run db:backup` | See "Backups". Schedule it; nothing runs it automatically. |

## Health and readiness

- `GET /api/health/live` — process liveness. Never touches the database, so a database outage does not make an orchestrator restart healthy app processes.
- `GET /api/health/ready` — per-check status for `config`, `database`, `migrations` (fails if any migration file is unapplied), `worker` (degraded when no heartbeat for 45 s) and `storage`. Returns **503 only when `unavailable`**. `degraded` returns 200: reads, approvals and field work continue; investigations wait in the queue.
- `GET /api/health` — the original combined check, unchanged.

The UI shows a notice when an investigation is queued but no worker is online, and the existing reconnect banner when the API is unreachable. Error pages (`app/error.tsx`, `app/global-error.tsx`) state that saved records are unaffected and show a reference digest.

## Logs

Every process writes one JSON object per line to stdout/stderr: `ts`, `level`, `event`, `service` (`leakloop`, `leakloop-worker`, `leakloop-maintenance`) and event fields. Keys that look like secrets (`password`, `token`, `secret`, `authorization`, `cookie`, `api_key`, `hash`, `credential`) are redacted and long strings truncated. API failures log `api_failure` with the same `requestId` returned to the client (also in `X-Request-Id`). Set `LOG_LEVEL=debug|info|warn|error`.

Useful events: `server_started`, `config_invalid`, `worker_ready`, `worker_stopping`, `worker_stopped`, `agent_job_error`, `telemetry_ingested`, `attachment_uploaded`, `attachment_integrity_failure`, `sso_id_token_rejected`, `mail_sent`/`mail_written_to_outbox`, `maintenance_completed`.

## Graceful shutdown

- `next start` finishes in-flight requests on SIGTERM/SIGINT.
- The worker stops claiming, aborts any in-flight model request, requeues that job **without consuming one of its three delivery attempts**, deletes its heartbeat (readiness reflects it immediately) and closes the pool. Tool results already checkpointed are kept.
- `npm run local` forwards SIGTERM to both children and force-kills after 10 s.
- Allow a 30 s stop grace period in your orchestrator (`docker-compose.yml` does).

## Backups

```sh
npm run db:backup                   # -> ./backups/leakloop-<timestamp>/
npm run db:backup -- --out /secure/location
```

Each backup directory holds `database.dump` (pg_dump custom format, consistent snapshot), `attachments.tar.gz` (local attachment storage only) and `manifest.json` (SHA-256 of each file, migrations, per-table row counts). Connection settings are passed to `pg_dump` through `PG*` environment variables, never command-line arguments. `pg_dump` must be the same or newer major version than the server.

Backups contain password hashes, session-token hashes, account events and operational records. Store them encrypted, off-host, with restricted access. Attachments in S3 storage are **not** included; enable bucket versioning/replication with your provider.

## Restore (tested procedure)

Restore never overwrites a database. It only restores into a new, empty database and refuses the current `DATABASE_URL`.

1. Create an empty database: `createdb leakloop_restored` (or your provider's console).
2. Restore and verify:
   ```sh
   npm run db:restore -- --from backups/leakloop-<timestamp>/manifest.json \
     --target postgresql://user@host:5432/leakloop_restored \
     --attachments-dir ./restored-attachments
   ```
   The script verifies the dump checksum before touching anything, restores in a single transaction (`--exit-on-error`), then compares every table's row count with the manifest. Exit code 3 means counts differ — investigate before going further.
3. Stop the API and worker. Point `DATABASE_URL` (and `STORAGE_LOCAL_DIR`, if restoring attachments) at the restored copies. Run `npm run db:migrate` (no-op unless the backup predates newer migrations). Start the processes and check `/api/health/ready`.
4. Keep the old database until the restored one is confirmed.

`npm run test:restore` rehearses this end to end: backup → refuse live target → refuse a corrupted dump → restore into a scratch database → identical row counts and migrations → byte-identical `ll_users`, `ll_audit_events`, `ll_account_events`, `schema_migrations` → append-only triggers still enforced → attachment files intact → refuse a non-empty target → drop the scratch database. It passed in this delivery (see `evaluation/restore-results.json`). Cross-host restores, managed-provider snapshots and point-in-time recovery were not tested.

## Retention

| Data | Retention | Mechanism |
| --- | --- | --- |
| Sessions | Removed 1 day after expiry, revocation or idle timeout | `npm run maintenance` |
| Rate-limit and login-throttle rows | 1 day | maintenance |
| Worker heartbeats | 1 day | maintenance |
| SSO state (`ll_oidc_states`) | 10 minutes | maintenance |
| Password-reset records | 90 days (tokens expire after `PASSWORD_RESET_MINUTES`) | maintenance |
| Invitations | Kept (status: open/accepted/revoked/expired) | — |
| Device readings and ingest batches | Kept by default; `TELEMETRY_RETENTION_DAYS=N` deletes older readings | maintenance |
| Attachment metadata | Kept permanently, including soft-deleted records | Database trigger forbids deletion |
| Attachment bytes after soft delete | Purged after `ATTACHMENT_PURGE_DAYS` (default 30); metadata records `purged_at` | maintenance |
| Audit history, account events, model usage | Kept permanently (append-only) | — |
| Scenario generations, command receipts, jobs | Kept permanently | — |

Nothing in operational history (incidents, proposals, work orders, verification, audit) is deleted automatically. Any wider retention policy needs an operator decision and a migration; none is implied here.

## Known limitations

- Single campus, single database. One worker was exercised; multiple workers are supported by the lease logic but not load-tested. Campus mutations are serialised.
- The investigation engine uses **simulated** telemetry only. Real device readings are stored, validated and queryable but do not drive incidents.
- Attachments are evidence for people. They are not analysed by the agent and do not affect verification.
- No MFA. SSO was verified against a local mock OpenID provider, not a real identity provider.
- Email delivery was verified with a local SMTP sink and the file outbox; no real mail provider was used.
- The live model adapter was verified against a local mock of the Responses API; no real model was called. Quality, latency and cost of a real model are unmeasured.
- S3 storage was verified against a local fake S3 endpoint (SigV4-signed requests, path-style), not a real bucket.
- No TLS termination is included; put the app behind an HTTPS reverse proxy when hosted.
- Rate limits are database-backed per account/email/device. Per-client-IP limits apply only when `TRUST_PROXY=true` behind a proxy you control.
