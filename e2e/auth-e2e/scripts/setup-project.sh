#!/usr/bin/env bash
# Bootstraps a throwaway Nextly project linked via yalc for E2E auth tests.
# Idempotent: reuses the sandbox project unless --fresh is passed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
SANDBOX="$ROOT/e2e/auth-e2e/.sandbox"
PROJECT="$SANDBOX/auth-e2e-app"
FRESH=0

for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
  esac
done

echo "[setup-project] root=$ROOT"
echo "[setup-project] project=$PROJECT"

if [[ "$FRESH" -eq 1 && -d "$PROJECT" ]]; then
  echo "[setup-project] --fresh: removing $PROJECT"
  rm -rf "$PROJECT"
fi

mkdir -p "$SANDBOX"

# 1. Publish all packages to yalc (reuses ./scripts/yalc-publish.sh).
echo "[setup-project] publishing yalc packages"
(cd "$ROOT" && pnpm yalc:publish:fast)

# 2. If no project, scaffold one. We go through create-nextly-app via a
#    small bootstrap package so yalc can resolve it.
if [[ ! -d "$PROJECT" ]]; then
  echo "[setup-project] scaffolding $PROJECT"
  BOOTSTRAP="$SANDBOX/bootstrap"
  mkdir -p "$BOOTSTRAP"
  if [[ ! -f "$BOOTSTRAP/package.json" ]]; then
    cat > "$BOOTSTRAP/package.json" <<'JSON'
{
  "name": "auth-e2e-bootstrap",
  "private": true,
  "version": "0.0.0"
}
JSON
  fi
  (cd "$BOOTSTRAP" && yalc add @revnixhq/create-nextly-app)
  node "$BOOTSTRAP/node_modules/@revnixhq/create-nextly-app/bin/create-nextly-app.js" \
    "$PROJECT" \
    --template blank \
    --database sqlite \
    --approach visual \
    --use-yalc \
    --local-template "$ROOT/templates"
fi

echo "[setup-project] ready at $PROJECT"
echo ""
echo "Next steps:"
echo "  1. Start Mailpit:   docker compose --profile with-mailpit up -d mailpit"
echo "  2. Start dev:       (cd $PROJECT && pnpm dev)"
echo "  3. First-time setup: open http://localhost:3000/admin/setup and create admin"
echo "  4. Configure SMTP:  open http://localhost:3000/admin/settings/email-providers/create"
echo "                      use host=localhost port=1025 user=dev pass=dev"
echo "  5. Run tests:       pnpm test"
