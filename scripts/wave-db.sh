#!/usr/bin/env bash
# Spin up an isolated throwaway Postgres for one wave phase.
# Usage:  scripts/wave-db.sh <phase-label> <host-port>
#   e.g.  scripts/wave-db.sh p1 5511
# Prints the DATABASE_URL to use for that worktree. Container auto-removes on stop.
set -euo pipefail

label="${1:?usage: wave-db.sh <phase-label> <host-port>}"
port="${2:?usage: wave-db.sh <phase-label> <host-port>}"
name="mkv2-wave-${label}"

docker rm -f "$name" >/dev/null 2>&1 || true
docker run --rm -d --name "$name" \
  -e POSTGRES_USER=mkv2 -e POSTGRES_PASSWORD=mkv2 -e POSTGRES_DB=mkv2 \
  -p "${port}:5432" postgres:16-alpine >/dev/null

# wait for readiness
for _ in $(seq 1 30); do
  if docker exec "$name" pg_isready -U mkv2 >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "DATABASE_URL=postgres://mkv2:mkv2@127.0.0.1:${port}/mkv2"
