# Auth E2E Suite

Playwright suite that exercises Nextly's auth flows end-to-end against a fresh `create-nextly-app` project linked via yalc. Uses Mailpit for email delivery assertions.

## Prerequisites

- `docker compose --profile with-mailpit up -d mailpit` from the repo root.
- `yalc` installed globally: `npm i -g yalc`.
- Node 24, pnpm.

## First-time setup

```bash
cd e2e/auth-e2e
pnpm install
pnpm setup           # publishes yalc packages + scaffolds .sandbox/auth-e2e-app
npx playwright install chromium
```

## Run

```bash
pnpm test            # headless
pnpm test:headed     # see the browser
pnpm test:ui         # Playwright UI mode
```

Order matters — specs share DB state, so they run sequentially in this order:

1. `setup.spec.ts` — first-admin setup (skipped if already done).
2. `login-logout.spec.ts` — baseline login/logout.
3. `signup-activation.spec.ts` — signup → Mailpit → verify → login.
4. `forgot-password.spec.ts` — reset email → reset → login with new password.
5. `change-password.spec.ts` — authenticated change with CSRF enforcement.
6. `csrf-negative.spec.ts` — all protected routes reject requests without a token.

## Reset the sandbox

```bash
pnpm setup:fresh     # deletes .sandbox/auth-e2e-app and re-scaffolds
```

The `.sandbox/` directory is gitignored.

## Configure Mailpit-backed email provider

The first time you run against a fresh sandbox, manually create the default email provider (the test harness does not auto-seed one):

1. Start dev: `(cd .sandbox/auth-e2e-app && pnpm dev)`.
2. Open http://localhost:3000/admin/setup and create the test admin.
3. Open **Settings → Email Providers → Add Provider** and fill in:
   - Name: Local Mailpit
   - Host: localhost
   - Port: 1025
   - Secure: off
   - Username: dev
   - Password: dev
   - From Email: noreply@nextly.test
4. Mark as default and save.

After the first run, the sandbox persists, so you only do this once.

## Layout

- `scripts/setup-project.sh` — bootstraps the sandbox project via yalc + create-nextly-app.
- `lib/mailpit.ts` — typed HTTP client for the Mailpit inbox.
- `lib/test-base.ts` — Playwright fixtures (inbox clearing between tests).
- `tests/*.spec.ts` — one scenario per file.
