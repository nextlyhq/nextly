import { describe, it, expect } from "vitest";

import type { Operation } from "../../diff/types";
import { preResolutionStatements } from "../executor";

describe("preResolutionStatements", () => {
  it("returns the rename SQL that the additive emitter never sees", () => {
    const ops: Operation[] = [
      {
        type: "rename_column",
        tableName: "dc_widget",
        fromColumn: "subtitle",
        toColumn: "tagline",
        fromType: "text",
        toType: "text",
      } as unknown as Operation,
    ];

    const sql = preResolutionStatements(ops, "sqlite");
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/rename/i);
    expect(sql[0]).toContain("subtitle");
    expect(sql[0]).toContain("tagline");
  });

  it("ignores additive ops, which the emitter handles instead", () => {
    const ops: Operation[] = [
      {
        type: "add_column",
        tableName: "dc_widget",
        column: { name: "headline", type: "text", nullable: true },
      } as unknown as Operation,
    ];

    expect(preResolutionStatements(ops, "sqlite")).toEqual([]);
  });

  it("returns nothing when there are no operations", () => {
    expect(preResolutionStatements([], "sqlite")).toEqual([]);
  });
});
