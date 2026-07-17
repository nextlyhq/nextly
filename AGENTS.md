# Nextly Monorepo: Agent Guide

Nextly is an open-source, Next.js-native CMS and app framework. Users define
content schema in TypeScript (code-first) or visually (the Schema Builder), and
it runs inside their own Next.js app with their own database (Postgres, MySQL,
or SQLite via Drizzle ORM). This repository is the pnpm + Turborepo monorepo
for all published packages. Status: alpha, all packages version in lockstep.

## Repository map

- `packages/nextly` - core: config surface, Direct API, REST dispatcher, CLI,
  auth, schema pipeline, migrations. Publishes `nextly` with many export
  subpaths (`nextly/config`, `nextly/runtime`, `nextly/field-catalog`, ...).
- `packages/admin` - the admin panel UI (`@nextlyhq/admin`).
- `packages/adapter-{drizzle,postgres,mysql,sqlite}` - database adapters.
  `adapter-drizzle` is shared logic; the per-dialect adapters extend it.
- `packages/plugin-sdk` - the ONLY stable import surface for plugin authors.
- `packages/plugin-{form-builder,page-builder}` - first-party plugins.
- `packages/storage-{s3,vercel-blob,uploadthing}` - media storage adapters.
- `packages/create-nextly-app` - scaffolding CLI. Templates live in
  `/templates` (`base`, `blank`, `blog`, `plugin`).
- `packages/ui` - shared React components and the design-token theme.
- `apps/playground` - contributor dev harness (not published).
- `e2e/` - Playwright suite. `docs/` - user docs (MDX, deployed to
  nextlyhq.com/docs).

Before editing a package, read its README.md and check for a nested AGENTS.md.

## Setup and dev loop

- Requirements: Node >= 20, pnpm 9.0.0 (`packageManager` is pinned in
  `package.json`; Corepack enforces the exact version).
- Install: `pnpm install`.
- Dev harness: `pnpm dev:app` starts the playground on :3000 (SQLite by
  default; `pnpm dev:postgres` / `pnpm dev:mysql` for other dialects, with
  services from `pnpm docker:up`). It seeds a dev user and auto-logs-in to
  `/admin` (dev-only; the credentials are `dev@nextly.local` /
  `DevPassword123!`, and auto-login is hard-blocked in production).
- There is no `nextly dev` CLI command by design: user apps run plain
  `next dev`, and schema changes apply in-process via the HMR listener.

## Build and test (read this before running anything)

- `pnpm build` builds all packages (turbo, dependency order).
- `pnpm check-types` and `pnpm lint` do NOT need a build first. `pnpm test`
  does (turbo handles it when run from the root).
- CRITICAL: integration tests require built packages. Run them from the ROOT
  (`pnpm test:integration...`) so turbo builds first. Running
  `pnpm --filter nextly test:integration` on an unbuilt tree fails 60+ files
  with self-import errors that look real but are not.
- Integration tests self-skip when the dialect's URL is unset. Use the root
  scripts: `pnpm test:integration:postgres17` (localhost:5435),
  `:postgres15` (:5434), `:mysql` (:3307), `:sqlite` (no URL needed). Start
  the databases with `pnpm docker:test`. NEVER point a TEST\_\* URL at a
  database you did not create for the test run.
- Integration files in `packages/nextly` run sequentially on purpose
  (`fileParallelism: false`, single fork): system-table suites share fixed
  table names. Do not "fix" slow integration runs by re-enabling parallelism.
- E2E: the root `e2e/` package (Playwright) boots its own playground on :3100
  with a fresh SQLite database per run.
- Some unit suites have a known pre-existing failing baseline. NEVER add to
  it: run the tests for the area you touch before and after your change, and
  fix any new failure you introduce.

## Conventions (enforced; violations will be rejected in review)

- Conventional Commits, checked by commitlint (husky) and a PR-title check.
  Allowed PR scopes are package-based (`nextly`, `admin`, `ui`,
  `adapter-postgres`, `adapter-mysql`, `adapter-sqlite`, `adapter-drizzle`,
  `storage-s3`, `storage-vercel-blob`, `storage-uploadthing`,
  `plugin-form-builder`, `plugin-page-builder`, `plugin-sdk`,
  `create-nextly-app`, `eslint-config`, `prettier-config`, `tsconfig`,
  `telemetry`, `client`) plus `playground`, `root`, `ci`, `docs`, `deps`,
  `release`. Scope is optional; the subject must not start with an uppercase
  letter. Subsystem names are not valid scopes.
- Errors thrown inside `packages/nextly/**` use `NextlyError` (static
  factories: `notFound`, `forbidden`, `validation`, `conflict`, `duplicate`,
  `authRequired`, `invalidCredentials`, `rateLimited`, `internal`, ...), never
  bare `Error`. The admin package is exempt: it consumes the typed
  `{ error: { code, message, requestId, data? } }` envelope via
  `parseApiError`.
- Database access is Drizzle ORM only. No raw SQL strings in product code.
  Test fixtures reuse the production DDL helpers (for example
  `getSchemaEventsDdl`), never hand-copied CREATE TABLE statements.
- Every code change includes a comment explaining what and why. Comments
  describe the code only: never reference tasks, plans, conversations, or
  review findings.
- No `as any`, `@ts-expect-error`, or eslint-disable to silence type or lint
  errors. Fix the cause with real types, guards, or generics.
- API responses use the canonical envelopes in
  `packages/nextly/src/api/response-shapes.ts` (`{ items, meta }` for lists,
  `{ message, item }` for mutations). Never invent a new response shape.
- Admin styling is token-driven: use `--nx-*` custom properties (defined for
  light AND dark in `packages/ui/src/styles/theme.css`). Zero hardcoded
  colors, and every visual change must work in both modes.

## Changesets and releases

- ONE changeset per PR, covering ALL published packages (they version in
  lockstep), always `patch` while in alpha.
- Test-only, CI-only, or docs-only PRs get NO changeset.
- Releases are CI-only: the Changesets bot opens a Version PR, and merging it
  publishes via npm trusted publishing. Never attempt to publish locally.

## Git and PR rules

- Never commit directly to main. Branch, open a PR, request review.
- Do not add "Generated with Claude Code", Co-Authored-By AI trailers, or any
  other AI attribution to commits or PR bodies.
- Husky runs gitleaks + lint-staged on commit, commitlint on the message, and
  lint + build on push. Never bypass hooks with `--no-verify`; if a hook
  fails, fix the cause.
- Pre-existing lint or type failures may be left alone (mention them in the
  PR); introducing new ones is not acceptable.
