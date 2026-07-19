---
paths:
  - "**/*.integration.test.ts"
---

Integration tests in this repo must:

- Reuse the production DDL helpers for system tables (for example
  `getSchemaEventsDdl`); never hand-copy CREATE TABLE statements into
  fixtures, they drift.
- Self-skip when the dialect's connection URL (`TEST_POSTGRES_URL`,
  `TEST_MYSQL_URL`) is unset instead of failing; SQLite may fall back to
  in-memory.
- Use a unique per-file table or schema prefix for TEST-OWNED tables (see
  `packages/nextly/src/database/__tests__/integration/helpers/test-db.ts`)
  so files stay independent. Fixed-name SYSTEM tables (for example
  `nextly_schema_events`) cannot be prefixed; suites that create them rely on
  the sequential integration run (`fileParallelism: false`) for isolation,
  which is why parallelism must never be re-enabled.
- Never target an existing database. Use the throwaway containers from
  `pnpm docker:test` (Postgres 15 on 5434, Postgres 17 on 5435, MySQL on
  3307; these are the matrix-tested versions).
- Run from the repo root so turbo builds dependencies first; a direct
  package-level run on an unbuilt tree produces dozens of false failures.
