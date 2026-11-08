# Backend API

Base URL for this session: `http://127.0.0.1:3001`. All responses use JSON. Authenticated endpoints require the HttpOnly `leakloop_session` cookie. Requests that mutate state must supply an Origin matching the request Host; the browser supplies it automatically. JSON endpoints require `Content-Type: application/json` and have bounded bodies.

## Endpoints

| Method / path | Purpose | Access |
| --- | --- | --- |
| POST `/api/auth/login` | Email/password login; sets an opaque session cookie | Public, rate-limited |
| GET `/api/session` | Current database-backed identity | Signed in |
| DELETE `/api/session` | Revoke the current session and clear cookie | Same-origin |
| POST `/api/session` | Explicit development-only demo sign-in | Disabled by default and in production |
| GET `/api/state` | UI projection, revision, actor and recent jobs | Signed in; technician evidence scoped to assignments |
| POST `/api/command` | Validated operational/simulation action | Role + assignment ownership |
| GET `/api/v1/incidents` | Current incident list | Signed in; technicians see assigned incidents |
| GET `/api/v1/incidents/:id` | Incident, evidence and linked work | Signed in; assignment-scoped |
| POST `/api/v1/incidents/:id/actions` | Investigate, approve, reject, request evidence or close | Manager |
| GET `/api/v1/work-orders` | Work order list | Signed in; technicians see their own |
| POST `/api/v1/work-orders/:id/actions` | Accept, decline, record observation or completion | Assigned technician |
| GET `/api/v1/approvals` | Current pending proposals | Manager |
| GET `/api/v1/agent-runs` | Runs and current jobs | Signed in; assignment-scoped |
| POST `/api/v1/agent-runs` | Enqueue `run_agent` | Manager |
| GET `/api/v1/jobs/:id` | Durable job status | Signed in; technician assignment-scoped |
| GET `/api/v1/telemetry` | Indexed reading window | Campus staff |
| GET `/api/v1/audit` | Append-only audit history across scenario generations | Manager |
| GET `/api/health` | Database/worker readiness | Public; no credentials or internal connection details |

## Authentication

Login accepts exactly `{ "email": "ava@evergreen.local", "password": "<local account password>" }`. Roles and identity IDs are not accepted in the body. Setup writes random local credentials to owner-only `.local-accounts.json`; do not put that file in `public/` or commit it. Session lifetime is 12 hours. Sign-out revokes the token in Postgres, and disabled accounts and changed roles are applied when the next request authenticates.

Five incorrect account logins within 15 minutes lock that account for 15 minutes. Global login requests are limited to 100/minute; operational commands are limited to 120/minute per account. All processes share the database-backed limits. This prototype does not provide password recovery or public registration.

## Commands

Every command includes `commandId` (8–100 ASCII letters/digits/`:_-`) and the current integer `revision`. The server computes a canonical body hash excluding those two fields. Reusing a command ID with the same actor and payload is a replay; changing its payload returns 409. A new command with a stale revision returns 409. The UI refreshes to obtain the current revision.

Example investigation request:

```json
{
  "action": "run_agent",
  "incidentId": "INC-1042",
  "commandId": "c3420676-885a-42bd-9e73-40b91cfba9e5",
  "revision": 58
}
```

The response is `202` with `{ "state": { ... }, "job": { "id": "...", "status": "queued", ... }, "accepted": true }` at `/api/command`. Poll `/api/v1/jobs/:id`. The worker persists a separate agent-run record and each tool execution. The same incident cannot have two active jobs.

Actions and extra fields:

- Manager: `run_agent` (`incidentId`), `approve` / `reject` / `close` (`incidentId`, `proposalId`, `version`), `request_evidence` (`incidentId`, `text`). Rejection and evidence requests require nonempty notes. Closure has an optional note.
- Assigned technician: `accept`, `decline`, `observe`, `complete` (`workOrderId`). Decline/observation/completion require notes. An observation may use `event: "meter_fault"` to record contradictory inspection evidence. Completion requires `checklist: ["location", "meter", "findings"]` with three distinct values, plus a prior saved observation.
- Operator: `reset` (`scenario`: A–F), `advance` (`minutes`: integer 1–240), `clock` (`event`: start/pause), `inject` (`event`: duplicate_report/manual_reading/tool_failure/stale_telemetry).

Simulation reset starts a new generation, cancels old queued/running jobs and preserves old relational records/history. It does not reset accounts or sessions. Proposal approvals are checked against ID, version, current evidence version, role and assignment constraints. Technician mutation responses are scoped as well as read endpoints.

## Queries and errors

Telemetry requires `buildingId`; optional `from`/`to` are simulated Unix epoch milliseconds, and `limit` is 1–500 (default 100). It returns newest readings first and preserves `null` and quality flags. Audit accepts `limit` 1–200 (default 50). These endpoints do not ingest hardware readings or send external actions.

Validation returns 400 with safe field paths; unknown fields/actions are rejected. Missing/expired authentication returns 401; permissions/origin failures 403; missing or inaccessible records 404; stale revisions, idempotency mismatches and database constraints 409; excessive bodies 413; wrong content type 415; throttling 429. Unexpected errors have a generic message and request ID. Database connectivity errors/readiness can return 503. Internal exception details and credentials are not sent to clients.

`/api/health` is 200 only when the database is connected and a worker heartbeat is newer than 45 seconds. An offline worker yields 503 with a degraded status. A stopped worker does not lose queued jobs.
