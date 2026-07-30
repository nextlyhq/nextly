import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { readIdentifierCaseRules } from "../read-identifier-case";
import type { IdentifierCase } from "../resolve-catalog-name";

/**
 * `result` stands in for whatever the driver hands back from `db.execute`. The
 * mysql2 driver returns a `[rows, fields]` tuple; others return rows directly,
 * and both shapes are exercised below.
 */
function adapter(dialect: SupportedDialect, result: unknown = []) {
  const execute = vi.fn().mockResolvedValue(result);
  return {
    dialect,
    getDrizzle: vi.fn(() => ({ execute })),
    execute,
  };
}

const TUPLE = (value: unknown) => [[{ lower_case_table_names: value }], []];

describe("readIdentifierCaseRules", () => {
  // Both are decided by dialect alone, so they must not cost a round trip.
  it.each<[SupportedDialect, IdentifierCase]>([
    ["postgresql", "preserve"],
    ["sqlite", "fold-ascii"],
  ])("decides %s without querying the server", async (dialect, expected) => {
    const db = adapter(dialect);
    expect((await readIdentifierCaseRules(db)).tables).toBe(expected);
    expect(db.getDrizzle).not.toHaveBeenCalled();
  });

  it("reads lower_case_table_names on mysql", async () => {
    const db = adapter("mysql", TUPLE(1));
    expect(await readIdentifierCaseRules(db)).toEqual({
      tables: "fold-unicode",
      columns: "fold-unicode",
    });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  // The setting is the whole reason for the query: 0 is the case-sensitive
  // packaging, where folding a lookup would report a dropped table as present.
  it("treats mysql lower_case_table_names=0 as case-sensitive for tables", async () => {
    const db = adapter("mysql", TUPLE(0));
    expect((await readIdentifierCaseRules(db)).tables).toBe("preserve");
  });

  // MySQL compares column names case-insensitively whatever that setting says.
  it("keeps mysql columns folded even when tables are case-sensitive", async () => {
    const db = adapter("mysql", TUPLE(0));
    expect((await readIdentifierCaseRules(db)).columns).toBe("fold-unicode");
  });

  // A driver that returns rows directly rather than a `[rows, fields]` tuple.
  it("accepts a flat row list", async () => {
    const db = adapter("mysql", [{ lower_case_table_names: 1 }]);
    expect((await readIdentifierCaseRules(db)).tables).toBe("fold-unicode");
  });

  it("accepts a numeric string and the camelCase key a driver may return", async () => {
    const db = adapter("mysql", [[{ lowerCaseTableNames: "2" }], []]);
    expect((await readIdentifierCaseRules(db)).tables).toBe("fold-unicode");
  });

  it.each([
    ["no rows", [[], []]],
    ["an empty result", []],
    ["a non-array result", { rows: [] }],
  ])("refuses when the server returns %s", async (_label, result) => {
    const db = adapter("mysql", result);
    await expect(readIdentifierCaseRules(db)).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        /returned no rows/.test(String(error.logContext?.reason))
    );
  });

  it("refuses when the value cannot be read", async () => {
    const db = adapter("mysql", TUPLE("unknown"));
    await expect(readIdentifierCaseRules(db)).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        /not a non-negative integer/.test(String(error.logContext?.reason))
    );
  });
});
