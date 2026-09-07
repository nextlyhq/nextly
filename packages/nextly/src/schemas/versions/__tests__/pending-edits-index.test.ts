/**
 * `nextly_versions_pending_edits_idx` — the index the dashboard cards read on.
 *
 * 🔴 Checked against `WORKING_DRAFT_SHAPE` rather than against a second list of
 * column names. The index earns its place only by covering every predicate that
 * query applies; a hand-copied expectation would keep passing after a predicate
 * was added to the shape and not to the index, which is exactly the drift that
 * silently returns both cards to a full table scan.
 *
 * Declared for all three dialects here, and the PLAN it produces is measured on
 * SQLite in `pending-edit-query-plan.integration.test.ts` — presence and use are
 * two different claims, and an index nothing chooses is not a fix.
 */
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { WORKING_DRAFT_SHAPE } from "../../../domains/versions/versions-repository";
import { nextlyVersionsMysql } from "../mysql";
import { nextlyVersionsPg } from "../postgres";
import { nextlyVersionsSqlite } from "../sqlite";

const INDEX_NAME = "nextly_versions_pending_edits_idx";

/** Drizzle property name → database column name, per the versions table. */
const COLUMN_OF: Record<string, string> = {
  isAutosave: "is_autosave",
  versionNo: "version_no",
  status: "status",
};

const dialects = [
  ["sqlite", () => sqliteTableConfig(nextlyVersionsSqlite)],
  ["postgresql", () => pgTableConfig(nextlyVersionsPg)],
  ["mysql", () => mysqlTableConfig(nextlyVersionsMysql)],
] as const;

function indexColumns(config: {
  indexes: readonly { config: { name: string; columns: readonly unknown[] } }[];
}): string[] {
  const found = config.indexes.find(index => index.config.name === INDEX_NAME);
  if (!found) return [];
  return found.config.columns.map(
    column => (column as { name: string }).name ?? String(column)
  );
}

describe.each(dialects)("%s pending-edits index", (_name, read) => {
  it("covers every predicate that defines a working draft", () => {
    const columns = indexColumns(read() as never);

    // The predicates lead, so all three are equality probes rather than filters
    // applied to rows the index already made the engine fetch.
    const predicates = WORKING_DRAFT_SHAPE.map(
      condition => COLUMN_OF[condition.column] ?? condition.column
    );
    expect(columns.slice(0, predicates.length).sort()).toEqual(
      [...predicates].sort()
    );
  });

  it("then takes the collection filter and the cursor's own ordering", () => {
    const columns = indexColumns(read() as never);

    expect(columns.slice(WORKING_DRAFT_SHAPE.length)).toEqual([
      "scope_slug",
      "updated_at",
      "id",
    ]);
  });
});
