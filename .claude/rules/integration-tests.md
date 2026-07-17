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
- Use a unique per-file table or schema prefix (see
  `packages/nextly/src/database/__tests__/integration/helpers/test-db.ts`)
  so files stay independent.
- Never target an existing database. Use the throwaway containers from
  `pnpm docker:test` (Postgres 15 on 5434, Postgres 17 on 5435, MySQL on
  3307; these are the matrix-tested versions).
- Run from the repo root so turbo builds dependencies first; a direct
  package-level run on an unbuilt tree produces dozens of false failures.
