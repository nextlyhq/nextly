import { describe, it, expect } from "vitest";

import type { Operation } from "../../diff/types";
import { canEmitWithoutDrizzleKit } from "../index";

const addCol: Operation = {
  type: "add_column",
  tableName: "dc_authors",
  column: { name: "age", type: "integer", nullable: true },
};

describe("canEmitWithoutDrizzleKit", () => {
  it("returns true for postgresql when every op is a supported add_column", () => {
    expect(canEmitWithoutDrizzleKit([addCol], "postgresql")).toBe(true);
  });

  it("returns false if any op is not yet supported (mixed list)", () => {
    const renameTable: Operation = {
      type: "rename_table",
      fromName: "a",
      toName: "b",
    };
    expect(canEmitWithoutDrizzleKit([addCol, renameTable], "postgresql")).toBe(
      false
    );
  });

  it("returns false for non-postgresql dialects", () => {
    expect(canEmitWithoutDrizzleKit([addCol], "mysql")).toBe(false);
    expect(canEmitWithoutDrizzleKit([addCol], "sqlite")).toBe(false);
  });

  it("returns false for an empty op list", () => {
    expect(canEmitWithoutDrizzleKit([], "postgresql")).toBe(false);
  });
});
