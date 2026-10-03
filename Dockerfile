# ---- deps: install node_modules (builds native better-sqlite3) ----
FROM node:22-alpine AS deps
WORKDIR /app
# better-sqlite3 ships no musl prebuilt binary, so npm ci compiles it from
# source; alpine has no toolchain by default.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile the Next.js standalone bundle ----
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: minimal runtime image ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    MODELHUB_DATA_PATH=/data

# Run as an unprivileged user.
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nextjs

# The standalone bundle already carries its traced node_modules
# (better-sqlite3, pg, pino, thread-stream), so no npm install is needed here.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# SQLite lives on a volume; create it owned by the runtime user so the named
# volume inherits that ownership on first creation (root-owned volumes would
# make the app fail to open the database).
RUN mkdir -p /data && chown -R nextjs:nodejs /data
VOLUME ["/data"]

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
