#!/bin/sh
# Container entrypoint (plan 03-01).
#
# Applies node-pg-migrate migrations before the server binary runs. Set
# the env-var kill-switch to 0 (see check below) to skip migrations when
# ops prefer manual control — e.g., multi-replica deploys where only one
# replica should own the migration (RESEARCH.md Pitfall 7).
#
# The `exec "$@"` pattern hands off to the Dockerfile CMD/ENTRYPOINT
# binary (tini → node dist/index.js) while preserving PID 1 for signal
# forwarding (plan 01-03 STOPSIGNAL).

set -e

case "${1:-}" in
  -h | --help | help | -v | --version | version)
    exec node dist/index.js "$@"
    ;;
esac

if [ "${1#-}" != "$1" ]; then
  set -- node dist/index.js "$@"
fi

if [ "${MS365_MCP_MIGRATE_ON_STARTUP:-1}" != "0" ]; then
  echo "[entrypoint] Applying migrations..."
  node bin/migrate.mjs up
fi

exec "$@"
