# Deployment preparation

Nothing has been deployed and no service has been purchased. This document prepares a deployment; every step that creates infrastructure, sends email, or calls a paid API is yours to authorise.

## 1. Local with Docker

```sh
cp .env.docker.example .env        # set POSTGRES_PASSWORD to a long random value
docker compose up --build
```

- Services: `db` (Postgres 16), `setup` (one-shot: migrations, fictional campus seed if empty, local accounts if missing), `app` (API/UI on `127.0.0.1:3001` only), `worker`.
- Local account passwords: `docker compose exec app cat /data/accounts/.local-accounts.json`.
- Data lives in the `pgdata` and `appdata` named volumes. `docker compose down` keeps them; `down -v` deletes them.
- Ops: `docker compose run --rm maintenance`, `docker compose run --rm backup` then `docker compose cp app:/data/backups ./backups`.
- Use a registry mirror for the base image with `NODE_IMAGE=<mirror>/node:22-alpine` in `.env`.

What was verified here: the compose file validates; the stack ran with a substitute Node base image (Docker Hub was rate-limited and containers had no package-registry access in this environment), so the runtime stage, volumes, permissions, health checks, setup ordering, worker job processing, ingestion, attachment upload, backup job and graceful stop were exercised. The Dockerfile's `npm ci`/`npm run build` stages and `apk add` were **not** executed inside Docker here; CI's `docker` job builds the real image.

## 2. Local without Docker

```sh
npm ci
cp .env.example .env.local         # set DATABASE_URL
npm run setup                      # migrations + seed (if empty) + local accounts (if missing)
npm run build
npm run local                      # API/UI + worker on http://127.0.0.1:3001
```

macOS persistent runtime: `npm run local:macos` (unchanged).

## 3. Environment

`.env.example` documents every variable with defaults. Rules enforced at startup and by `/api/health/ready`:

- `DEPLOYMENT_PROFILE=hosted` requires an `https` `APP_ORIGIN`, forbids `COOKIE_SECURE=false` and demo login.
- `AGENT_MODE=live` requires `OPENAI_API_KEY` and `OPENAI_MODEL`; prices must be set together or not at all.
- SSO requires issuer, client id and client secret together, and an `https` issuer.
- `MAIL_TRANSPORT=smtp` requires `SMTP_URL`; `STORAGE_DRIVER=s3` requires `S3_BUCKET` and `S3_REGION`.

Secrets (`DATABASE_URL` password, `OPENAI_API_KEY`, `OIDC_CLIENT_SECRET`, `SMTP_URL`, AWS credentials) belong in your platform's secret store, never in the repository or image. `.env*` files are git- and docker-ignored except the examples.

## 4. Migrations

- Files in `migrations/` are applied in name order by `npm run db:migrate` under an advisory lock, each in its own transaction, recorded in `schema_migrations`. Re-running is a no-op.
- This delivery adds `003_accounts.sql`, `004_telemetry.sql`, `005_attachments.sql`, `006_model_usage.sql`. All are additive (new tables/columns, one `DROP NOT NULL` on `ll_users.password_hash` for SSO-only accounts). Existing users, sessions and campus history are preserved.
- Procedure for any upgrade: take a backup (`npm run db:backup`), run `npm run db:migrate` once (as a release step, not from every app instance), then roll the app and worker. `/api/health/ready` returns 503 while a migration file is unapplied.
- There are no down-migrations. Roll back by restoring the pre-upgrade backup into a new database (see `docs/OPERATIONS.md`).

## 5. CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`:

- `checks`: Postgres 16 service → `npm ci`, production `npm audit` (high), typecheck, unit tests, setup, migration idempotency, all database suites (backend, accounts, telemetry, attachments, live-agent mock, restore drill), evaluation, build, then the HTTP suites against the built app and worker.
- `docker`: builds the image and validates `docker-compose.yml`.

No secrets are required; the live-agent suite uses a local mock. The workflow has not run on GitHub yet (nothing was pushed).

## 6. Hosting checklist (not performed)

A minimal hosted shape is one container image run as two services (app, worker) plus managed Postgres 16 and, optionally, S3-compatible storage.

1. **Database**: managed Postgres 16+ (e.g. Supabase, RDS, Cloud SQL, Neon) with automated backups/PITR enabled. Use a direct or session-pooler URL (the app uses transactions and advisory locks; transaction-mode poolers are not supported). Require TLS (`?sslmode=require`).
2. **Image**: build from `Dockerfile`, push to your registry.
3. **Release step**: run `npm run db:migrate` once per release using the image.
4. **App service**: `node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port 3001` (image default) behind an HTTPS load balancer. Liveness `/api/health/live`, readiness `/api/health/ready`. Set `DEPLOYMENT_PROFILE=hosted`, `APP_ORIGIN=https://…`, `TRUST_PROXY=true` only if the proxy overwrites `X-Forwarded-For`.
5. **Worker service**: same image, command `node --import tsx scripts/worker.ts`, same environment, 30 s stop grace period, no public port.
6. **Storage**: `STORAGE_DRIVER=s3` with a private bucket (block public access, versioning on, SSE on), credentials via instance role/workload identity. Or a persistent volume for `STORAGE_LOCAL_DIR` with one app instance.
7. **Scheduled jobs**: `npm run maintenance` hourly; `npm run db:backup` if you rely on it rather than provider backups (ship the output off-host).
8. **Identity**: register `https://<origin>/api/auth/sso/callback` with your OIDC provider; pre-provision people by invitation (roles are never taken from IdP claims). Optionally set `PASSWORD_LOGIN=false` once SSO works.
9. **Email**: only after authorisation, set `MAIL_TRANSPORT=smtp` and `SMTP_URL`; send a test invitation to yourself first.
10. **Live agent**: only after authorisation, set `AGENT_MODE=live`, key, model and prices on both services; run `npm run agent:check -- --yes` once and review the result and the Model usage tab.
11. **First account**: run `npm run auth:bootstrap -- --email you@example.org --name "Your Name"` once in the release environment and open the printed one-time link to set a password. Then invite everyone else. Do not run `auth:seed` in a hosted environment (it creates the fictional demo accounts); if the `setup` script already did, disable those accounts in Administration.

Not ready for production without: a real identity-provider test, a real mail-provider test, a credentialed model evaluation, a real-bucket test, load testing, a security review/penetration test, and an organisational decision on data retention.
