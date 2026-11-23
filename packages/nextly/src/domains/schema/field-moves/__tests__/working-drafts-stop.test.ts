/**
 * The stop a migration file opens with where a working draft keeps a moved field at its old place
 * (`workingDraftsStop`) finds working drafts as the versions repository finds them
 * (`WORKING_DRAFT_SHAPE`), so the two cannot come to disagree about which rows those are.
 *
 * The shape is given one more condition here than the repository holds: a stop written from the
 * shape carries it, and one that spells the shape out again does not.
 */
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { nextlyVersionsMysql } from "../../../../schemas/versions/mysql";
import { nextlyVersionsPg } from "../../../../schemas/versions/postgres";
import { nextlyVersionsSqlite } from "../../../../schemas/versions/sqlite";
import { WORKING_DRAFT_SHAPE } from "../../../versions/versions-repository";
import { toSnakeCase } from "../../services/field-column-descriptor";
import { workingDraftsStop } from "../move-statements";

vi.mock("../../../versions/versions-repository", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("../../../versions/versions-repository")
    >();
  return {
    ...actual,
    WORKING_DRAFT_SHAPE: [
      ...actual.WORKING_DRAFT_SHAPE,
      { column: "locale", op: "IS NULL" },
    ],
  };
});

/** The statement that selects the offending draft, where the conditions are. */
const insertOf = (statements: readonly string[]) =>
  statements.find(s => s.startsWith("INSERT INTO")) ?? "";

describe("workingDraftsStop", () => {
  it("finds working drafts by every condition of the repository's shape", () => {
    const insert = insertOf(
      workingDraftsStop("postgresql", { kind: "collection", slug: "posts" }, [
        "subtitle",
      ])
    );
    expect(insert).toContain(`"locale" IS NULL`);
    expect(insert).toContain(`"is_autosave" = false`);
    expect(insert).toContain(`"version_no" IS NULL`);
    expect(insert).toContain(`"status" = 'draft'`);
    expect(insert).toContain(`"scope_kind" = 'collection'`);
    expect(insert).toContain(`"scope_slug" = 'posts'`);
  });

  it("writes a false as each dialect keeps it", () => {
    const on = (dialect: "mysql" | "sqlite") =>
      insertOf(
        workingDraftsStop(dialect, { kind: "single", slug: "home" }, [
          "subtitle",
        ])
      );
    expect(on("mysql")).toContain("`is_autosave` = 0");
    expect(on("sqlite")).toContain(`"is_autosave" = 0`);
  });

  // The stop names each column by the snake case of the name the repository queries it by: that
  // holds for every column of the shape and the scope, on every dialect's table.
  it.each([
    ["postgresql", nextlyVersionsPg],
    ["mysql", nextlyVersionsMysql],
    ["sqlite", nextlyVersionsSqlite],
  ] as const)("names each column as the %s table does", (_dialect, table) => {
    const columns = getTableColumns(table) as Record<string, { name: string }>;
    for (const { column } of [
      { column: "scopeKind" },
      { column: "scopeSlug" },
      ...WORKING_DRAFT_SHAPE,
    ]) {
      expect(columns[column]?.name, column).toBe(toSnakeCase(column));
    }
  });
});
