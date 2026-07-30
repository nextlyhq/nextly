import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { readIdentifierCaseRules } from "../read-identifier-case";

function adapter(dialect: SupportedDialect, rows: unknown[] = []) {
  return {
    dialect,
    executeQuery: vi.fn().mockResolvedValue(rows),
  };
}

describe("readIdentifierCaseRules", () => {
  // Both are decided by dialect alone, so they must not cost a round trip.
  it.each<[SupportedDialect, "preserve" | "fold"]>([
    ["postgresql", "preserve"],
    ["sqlite", "fold"],
  ])("decides %s without querying the server", async (dialect, expected) => {
    const db = adapter(dialect);
    expect((await readIdentifierCaseRules(db)).tables).toBe(expected);
    expect(db.executeQuery).not.toHaveBeenCalled();
  });

  it("reads lower_case_table_names on mysql", async () => {
    const db = adapter("mysql", [{ lower_case_table_names: 1 }]);
    expect(await readIdentifierCaseRules(db)).toEqual({
      tables: "fold",
      columns: "fold",
    });
    expect(db.executeQuery).toHaveBeenCalledTimes(1);
  });

  // The setting is the whole reason for the query: 0 is the case-sensitive
  // packaging, where folding a lookup would report a dropped table as present.
  it("treats mysql lower_case_table_names=0 as case-sensitive for tables", async () => {
    const db = adapter("mysql", [{ lower_case_table_names: 0 }]);
    expect((await readIdentifierCaseRules(db)).tables).toBe("preserve");
  });

  // Drivers differ on the column key they hand back.
  it("accepts the camelCase key a driver may return", async () => {
    const db = adapter("mysql", [{ lowerCaseTableNames: "1" }]);
    expect((await readIdentifierCaseRules(db)).tables).toBe("fold");
  });

  it("refuses when the server returns no row", async () => {
    const db = adapter("mysql", []);
    await expect(readIdentifierCaseRules(db)).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        /returned no rows/.test(String(error.logContext?.reason))
    );
  });

  it("refuses when the value cannot be read", async () => {
    const db = adapter("mysql", [{ lower_case_table_names: "unknown" }]);
    await expect(readIdentifierCaseRules(db)).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        /not a non-negative integer/.test(String(error.logContext?.reason))
    );
  });
});
