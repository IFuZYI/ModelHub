#!/usr/bin/env bash
# Start the ModelHub test instance (port 9000, admin / 12345678).
#
# Uses the standalone build in .next/standalone with the isolated test data
# dir (data-test/) so it never touches the dev data. First run seeds the
# admin user with MODELHUB_ADMIN_PASSWORD from .env.test.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
. ./.env.test
set +a

# Standalone output does not include the client assets; copy them once.
if [ ! -d .next/standalone/.next/static ]; then
  cp -r .next/static .next/standalone/.next/static
  cp -rn public .next/standalone/public 2>/dev/null || true
fi

cd .next/standalone
exec node server.js
