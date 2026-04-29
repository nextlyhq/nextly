import { describe, expect, it } from "vitest";

import {
  nextlyMigrationJournalMysql,
  nextlyMigrationJournalPg,
  nextlyMigrationJournalSqlite,
} from "../index.js";

// F10 PR 1: assert all three dialect tables expose the 6 new columns.
// Property-existence checks (Drizzle table objects) keep the test
// ORM-agnostic; we don't assert on the underlying SQL types here —
// those are exercised by the generated migration files in PR 1 and
// the integration tests in later F10 PRs.
describe("F10 journal scope+summary columns", () => {
  const newColumns = [
    "scopeKind",
    "scopeSlug",
    "summaryAdded",
    "summaryRemoved",
    "summaryRenamed",
    "summaryChanged",
  ] as const;

  it.each(newColumns)("postgres exposes %s", col => {
    expect(nextlyMigrationJournalPg).toHaveProperty(col);
  });

  it.each(newColumns)("mysql exposes %s", col => {
    expect(nextlyMigrationJournalMysql).toHaveProperty(col);
  });

  it.each(newColumns)("sqlite exposes %s", col => {
    expect(nextlyMigrationJournalSqlite).toHaveProperty(col);
  });
});
