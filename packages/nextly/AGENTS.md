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
- `overrideAccess` defaults to `true` (trusted server context) and returns
  before any check. Under `overrideAccess: false` there is ONE decision, the
  RBAC gate (`checkCollectionAccess` → `rbacAccessControlService.checkAccess`,
  or `apiKeyWriteAllowed` for a scoped key): super-admin bypass, then the
  code-defined `access` from `defineCollection`/`defineSingle` when it names
  the operation, else DB permissions. There is no stored rule layer; the
  `access_rules` registry column is retired, nothing reads it, and a database
  that still carries values in it is named at boot and by `nextly migrate`.
- Only the DB-permission half of the gate needs a `user`. An anonymous
  caller under `overrideAccess: false` is still judged by the collection's
  code-defined rule (`checkAnonymousCodeAccess`, handed `user: null`, no
  roles, no permissions); a rule that says nothing about the operation lets
  the request fall through to the public default. The Single gate
  (`checkSingleAccess`) and relationship expansion (`judgeTarget`) ask that
  same question, so one rule gives one answer on every door. Two exceptions
  fail closed regardless: `publish`/`unpublish` with no user, and
  `routeAuthorized` with no user.
- A code-defined rule reads permissions as `resource:action` (`posts:read`);
  a key's scope stores them as `action-resource` (`read-posts`). The one
  conversion is `ruleFacingPermissions`, and `ReadAccessCaller` carries both
  spellings (`permissions` for coarse checks, `rulePermissions` for rules) so
  no path hands a rule the stored form. Build callers with `readAccessCaller`;
  a hand-assembled literal is how two doors came to answer one key differently.
- A collection whose code-defined `access` says nothing about an operation
  falls through to DB permissions; a caller with no matching grant is refused.
  A rule that throws denies.
- FIELD-level rules are different: they run whenever `overrideAccess` is
  false, user or not. "Which fields may this writer set" has a perfectly good
  answer for nobody, and treating absence of a user as trust let an anonymous
  write set fields every authenticated user was forbidden from setting. An
  internal writer that needs a protected field says so with
  `overrideAccess: true`.
- The canonical `FieldType` union has 19 members and the structured-array
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
