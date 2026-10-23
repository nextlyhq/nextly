import { describe, expect, it, vi } from "vitest";

vi.mock("../../schema/pipeline/live-table-facts", () => ({
  readIndexUniqueness: () => Promise.resolve(new Map()),
  uniqueIndexNames: () => new Set<string>(),
}));

vi.mock("./companion-io", () => ({
  companionTableExists: () => Promise.resolve(true),
}));

const { reconcileCompanionUniqueIndexes } = await import(
  "./companion-unique-reconcile"
);

/**
 * A server that cannot key an expression (MariaDB, MySQL before 8.0.13), so a translated unique
 * TEXT field is held back while a number field is still indexable.
 */
const adapterThatCannotKeyExpressions = (
  rows: Record<string, unknown>[],
  seen: string[]
) => ({
  dialect: "mysql" as const,
  getDrizzle: () => ({}),
  getCapabilities: () =>
    ({ dialect: "mysql", functionalIndexes: false }) as never,
  queryStatement: (statement: { queryChunks?: unknown }) => {
    seen.push(JSON.stringify(statement.queryChunks ?? statement));
    return Promise.resolve(rows);
  },
  executeQuery: (statement: string) => {
    seen.push(statement);
    return Promise.resolve([]);
  },
});

describe("reconciling per-language unique indexes where one field is held back", () => {
  const fields = [
    { name: "slug", type: "text", unique: true, localized: true },
    { name: "rank", type: "number", unique: true, localized: true },
  ];

  it("still checks the fields it can index, and reports both reasons", async () => {
    const seen: string[] = [];
    const errors: unknown[] = [];
    await reconcileCompanionUniqueIndexes(
      adapterThatCannotKeyExpressions(
        [
          { locale: "en", parent: "a" },
          { locale: "en", parent: "b" },
        ],
        seen
      ),
      { builtBy: "collection", tableName: "dc_posts", fields },
      error => errors.push(error)
    );
    const reported = String(
      (errors[0] as { publicMessage?: string }).publicMessage ?? errors[0]
    );
    // The text field this server cannot key, and the number field whose values already collide.
    expect(reported).toContain("slug");
    expect(reported).toContain("rank");
    // Neither index is created: one cannot be keyed, the other would not hold.
    expect(seen.filter(s => s.startsWith("CREATE UNIQUE INDEX"))).toEqual([]);
  });

  it("creates the index it can once the values it would hold are unique", async () => {
    const seen: string[] = [];
    const errors: unknown[] = [];
    await reconcileCompanionUniqueIndexes(
      adapterThatCannotKeyExpressions([], seen),
      { builtBy: "collection", tableName: "dc_posts", fields },
      error => errors.push(error)
    );
    expect(
      seen.filter(s => s.startsWith("CREATE UNIQUE INDEX")).join(" ")
    ).toContain("`rank`");
    expect(
      seen.filter(s => s.startsWith("CREATE UNIQUE INDEX")).join(" ")
    ).not.toContain("`slug`");
  });
});
