# LeakLoop application image (API/UI, worker, migrations and maintenance share one image).
# Build:  docker build -t leakloop .
# The base image is configurable for registries/mirrors: --build-arg NODE_IMAGE=<registry>/node:22-alpine
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Dev dependencies are kept: tsx runs the worker, migrations, backups and maintenance scripts.
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
# postgresql16-client: pg_dump/pg_restore for npm run db:backup / db:restore (must be >= server major version).
RUN apk add --no-cache postgresql16-client tar
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 \
    STORAGE_LOCAL_DIR=/data/attachments MAIL_OUTBOX_DIR=/data/outbox LOCAL_ACCOUNTS_PATH=/data/accounts/.local-accounts.json
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --chown=node:node package.json package-lock.json next.config.ts tsconfig.json instrumentation.ts README.md ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node public ./public
COPY --chown=node:node docs ./docs
COPY --chown=node:node evaluation ./evaluation
RUN mkdir -p /data/attachments /data/outbox /data/accounts /data/backups && chown -R node:node /data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD wget -qO- http://127.0.0.1:3001/api/health/live >/dev/null || exit 1
# Inside the container the server must listen on all interfaces; publish the port on loopback only (see docker-compose.yml).
CMD ["node","node_modules/next/dist/bin/next","start","--hostname","0.0.0.0","--port","3001"]
