# Base image is overridable so a restricted network can point at a mirror:
#   docker build --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:22-alpine .
# Must be declared before the first FROM to be usable in a FROM line.
ARG NODE_IMAGE=node:22-alpine

# ---- deps: install node_modules (builds native better-sqlite3) ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# better-sqlite3 ships no musl prebuilt binary, so npm ci compiles it from
# source; alpine has no toolchain by default.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile the Next.js standalone bundle ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time only: Next bakes rewrites (incl. the MODELHUB_ADMIN_PATH alias)
# into routes-manifest.json during `next build`, so this must be an ARG passed
# to the build stage — a runtime env var would have no effect.
ARG MODELHUB_ADMIN_PATH
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: minimal runtime image ----
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    MODELHUB_DATA_PATH=/data

# Run as an unprivileged user. The entrypoint starts as root only to fix the
# data volume's ownership, then drops to nextjs.
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nextjs \
  && apk add --no-cache su-exec

# The standalone bundle already carries its traced node_modules
# (better-sqlite3, pg, pino, thread-stream), so no npm install is needed here.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# SQLite lives on a volume; create it owned by the runtime user so a fresh
# named volume inherits that ownership.
RUN mkdir -p /data && chown -R nextjs:nodejs /data
VOLUME ["/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
