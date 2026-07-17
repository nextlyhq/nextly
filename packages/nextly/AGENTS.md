# packages/nextly: Agent Guide

Core package. Read the root AGENTS.md first; this file adds what only matters
inside `packages/nextly`.

## Entry points

- Config surface: `src/config.ts` (field factories, `defineCollection`,
  `defineSingle`, `defineConfig`, type guards). Field factories live in
  `src/collections/fields/helpers.ts`.
- Field-type catalog: `src/collections/fields/catalog.ts`, published as the
  `nextly/field-catalog` subpath. Pure serializable data (labels, categories,
  hints, Lucide icon NAMES); admin pickers, the user-fields page, and the
  form builder all render from it. Surfaces narrow it with
  `narrowFieldTypeCatalog`; they never redeclare type lists.
- Direct API: `src/direct-api/nextly.ts`. REST dispatcher: `src/routeHandler.ts`
  plus `src/dispatcher/`. CLI: `src/cli/program.ts`.

## Facts agents get wrong without help

- Direct API lists return `{ items, meta }`; mutations return a result with
  `.item`. There is no `docs`/`totalDocs` shape anywhere.
- `overrideAccess` defaults to `true` (trusted server context). Enforcing
  access control requires `overrideAccess: false` plus a `user`.
- The canonical `FieldType` union has 18 members and the structured-array
  type is `repeater`; the `array()` factory is a backward-compat alias, use
  `repeater()` in new code. Surface-only types (`url`, `phone` for users;
  plus `file`, `time`, `hidden` for forms) are intentionally NOT in the
  union so they can never reach the schema pipeline's column mappers.
- Field-to-column mapping has ONE source of truth:
  `src/domains/schema/services/field-column-descriptor.ts` (per-dialect).
  The adapters do not map field types; do not add mapping logic there.
- Error codes live in `src/errors/error-codes.ts` with canonical HTTP
  statuses. Add new codes there; never inline status numbers. Throw via
  `NextlyError` factories.
- The CLI has no `dev` command on purpose (user apps run `next dev`; schema
  applies via the HMR listener in `src/runtime/hmr-listener.ts`).
  `generate:schema` is a stub. `migrate:down` exists (single-step rollback);
  `migrate:reset`/`migrate:rollback`/`migrate:refresh` were deliberately
  deleted. Do not resurrect removed commands.

## Testing in this package

- Unit: `vitest run` (excludes `*.integration.test.ts`).
- Integration: separate config (`vitest.integration.config.ts`), forks pool,
  single fork, `fileParallelism: false`. Test-owned tables use a unique
  per-file prefix (see
  `src/database/__tests__/integration/helpers/test-db.ts`); fixed-name
  system tables (created via the production DDL helpers) cannot be prefixed
  and rely on the sequential run for isolation.
- Integration tests self-skip when `TEST_POSTGRES_URL` / `TEST_MYSQL_URL` is
  unset; SQLite falls back to in-memory. Run from the repo root so turbo
  builds first.
