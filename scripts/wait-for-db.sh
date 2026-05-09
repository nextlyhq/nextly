#!/usr/bin/env bash
# Polls a TCP host:port until it's reachable, with a timeout.
# Used by CI before running integration tests so we don't race against
# Docker container boot.
#
# Usage:
#   ./scripts/wait-for-db.sh <host> <port> [timeout_seconds]
#
# Examples:
#   ./scripts/wait-for-db.sh localhost 5434       # default 60s timeout
#   ./scripts/wait-for-db.sh localhost 3307 120   # 120s timeout
#
# Exits 0 on success, 1 on timeout.

set -euo pipefail

HOST="${1:?Usage: wait-for-db.sh <host> <port> [timeout_seconds]}"
PORT="${2:?Usage: wait-for-db.sh <host> <port> [timeout_seconds]}"
TIMEOUT="${3:-60}"

echo "Waiting for ${HOST}:${PORT} (timeout ${TIMEOUT}s)..."

START=$(date +%s)
while true; do
  if (echo > /dev/tcp/"${HOST}"/"${PORT}") 2>/dev/null; then
    ELAPSED=$(($(date +%s) - START))
    echo "  -> ready after ${ELAPSED}s"
    exit 0
  fi
  ELAPSED=$(($(date +%s) - START))
  if [ "${ELAPSED}" -ge "${TIMEOUT}" ]; then
    echo "  -> timeout after ${ELAPSED}s; ${HOST}:${PORT} not reachable"
    exit 1
  fi
  sleep 1
done
