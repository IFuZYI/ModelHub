#!/bin/sh
set -e

# Runs as root so it can repair the data volume's ownership, then drops to the
# unprivileged runtime user. A named volume created by an older image (or by a
# root process) is root-owned, and `docker compose down` does not remove it;
# without this the app would fail with SQLITE_READONLY on upgrade.
if [ "$(id -u)" = "0" ]; then
  if [ -n "$MODELHUB_DATA_PATH" ] && [ -d "$MODELHUB_DATA_PATH" ]; then
    chown -R nextjs:nodejs "$MODELHUB_DATA_PATH" 2>/dev/null || true
  fi
  exec su-exec nextjs:nodejs "$@"
fi

exec "$@"
