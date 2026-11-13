// The rename check's judgement on a MySQL server folding table names (`lower_case_table_names`
// 1 or 2), where it judges table renames: the integration suite's server compares them by case, so
// there table renames are not judged at all and this ordering is never reached. The live readers
// are stubbed to such a server holding `notes` and `archive`.
import { beforeEach, describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({
  tables: new Map<string, Map<string, string>>(),
}));

vi.mock("../../pipeline/live-column-types", () => ({
  queryLiveColumnTypes: (_db: unknown, _dialect: unknown, names: string[]) =>
    Promise.resolve(
      new Map([...live.tables].filter(([name]) => names.includes(name)))
    ),
}));
vi.mock("../../pipeline/live-table-facts", () => ({
  readNameHoldersElsewhere: () => Promise.resolve(new Map()),
}));
vi.mock("../../utils/read-identifier-case", () => ({
  readIdentifierCaseRules: () =>
    Promise.resolve({ tables: "fold-ascii", columns: "fold-ascii" }),
}));

import { renamesOntoTakenTargets } from "../rename-preflight";

const judge = (statement: string) =>
  renamesOntoTakenTargets(
    [{ label: "001_rename.sql", statements: [statement] }],
    {},
    "mysql"
  );

describe("renames on a MySQL server folding table names", () => {
  beforeEach(() => {
    live.tables = new Map([
      ["notes", new Map([["id", "text"]])],
      ["archive", new Map([["id", "text"]])],
    ]);
  });

  it("refuses a table renamed onto a table that exists", async () => {
    expect(await judge("RENAME TABLE `notes` TO `archive`")).toEqual([
      expect.objectContaining({
        message:
          "Table 'notes' cannot be renamed to 'archive': a table 'archive' already exists.",
      }),
    ]);
  });

  // MySQL renames the pairs of one RENAME TABLE in order: the second pair finds `notes` freed by
  // the first, so the swap runs and is not refused.
  it("does not refuse a swap of two tables' names through a spare one", async () => {
    expect(
      await judge(
        "RENAME TABLE `notes` TO `spare`, `archive` TO `notes`, `spare` TO `archive`"
      )
    ).toEqual([]);
  });
});
