---
name: writing-integration-tests
description: Use when writing or debugging Nextly integration tests (*.integration.test.ts), when integration tests fail with self-import or connection errors, or when adding database-backed test coverage for a new feature.
---

# Writing integration tests in the Nextly monorepo

## The rules that prevent 90% of the pain

1. **Build first, always.** Integration tests import built package output.
   Run from the repo ROOT (`pnpm test:integration...`) so turbo builds
   dependencies; a direct `pnpm --filter nextly test:integration` on an
   unbuilt tree fails 60+ files with self-import errors that look real.
2. **Dialect URLs decide what runs.** Tests self-skip when the dialect's URL
   is unset: `TEST_POSTGRES_URL`, `TEST_MYSQL_URL` (SQLite falls back to
   in-memory). The root scripts wire the standard local ports:
   - `pnpm test:integration:postgres17` -> localhost:5435
   - `pnpm test:integration:postgres15` -> localhost:5434
   - `pnpm test:integration:mysql` -> localhost:3307
   - `pnpm test:integration:sqlite` -> no URL needed
     Start the throwaway containers with `pnpm docker:test`. NEVER point a
     TEST\_\* URL at a database you did not create for the run.
3. **Isolation is per-file prefixes, not parallelism.** Use the canonical
   helper (`packages/nextly/src/database/__tests__/integration/helpers/test-db.ts`)
   which generates a random per-file table/schema prefix. In packages/nextly
   the integration config runs files sequentially (`fileParallelism: false`,
   single fork) because system-table suites share fixed table names like
   `nextly_schema_events`. Do not re-enable parallelism to make runs faster.
4. **System tables come from production DDL.** If a suite needs a Nextly
   system table, create it with the production helper (for example
   `getSchemaEventsDdl(dialect)`), never a hand-copied CREATE TABLE. Copies
   drift; there is a parity test that will catch you.

## Writing a new suite

- Name it `<area>.integration.test.ts`; the unit config excludes that
  pattern and the integration config picks it up.
- Follow an existing suite in the same domain for setup/teardown shape.
- Timeouts are 30s in integration configs; if a test needs more, the test is
  usually doing too much.
- Cover Postgres AND at least one of MySQL/SQLite when the behavior touches
  SQL generation; the CI matrix runs all three dialects
  (`.github/workflows/integration.yml`).

## Debugging failures

- "Cannot resolve nextly/testing" or self-import errors -> unbuilt tree,
  build first.
- Connection refused -> containers not up (`pnpm docker:test`), or wrong
  port (see the mapping above).
- A suite passes alone but fails in the full run -> table-name collision;
  check the suite uses the prefix helper, and that it is not creating a
  fixed-name system table directly.
- Do not add retries or sleeps to mask ordering issues; fix the isolation.
