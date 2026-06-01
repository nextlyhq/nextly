/**
 * @module domains/schema/pipeline/classifier/__tests__/modes
 * @since v0.0.3-alpha (Plan C2)
 */
import { describe, it, expect } from "vitest";

import type { Operation } from "../../diff/types";
import { classifyForMode } from "../modes";

const dropCol: Operation = {
  type: "drop_column",
  tableName: "t",
  columnName: "c",
  columnType: "text",
};
const addColNoDefault: Operation = {
  type: "add_column",
  tableName: "t",
  column: { name: "c", type: "text", nullable: false },
};
const addColWithDefault: Operation = {
  type: "add_column",
  tableName: "t",
  column: { name: "c", type: "text", nullable: false, default: "''" },
};
const addColNullable: Operation = {
  type: "add_column",
  tableName: "t",
  column: { name: "c", type: "text", nullable: true },
};

describe("classifyForMode", () => {
  it("production-strict refuses a drop_column", () => {
    const r = classifyForMode([dropCol], "postgresql", "production-strict");
    expect(r.verdict).toBe("refuse");
    if (r.verdict === "refuse") expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("production-strict refuses add_column with no default + not-null", () => {
    expect(
      classifyForMode([addColNoDefault], "postgresql", "production-strict")
        .verdict
    ).toBe("refuse");
  });

  it("production-strict applies a purely additive (with-default) diff", () => {
    expect(
      classifyForMode([addColWithDefault], "postgresql", "production-strict")
        .verdict
    ).toBe("apply");
  });

  it("production-strict applies a nullable add_column", () => {
    expect(
      classifyForMode([addColNullable], "postgresql", "production-strict")
        .verdict
    ).toBe("apply");
  });

  it("dev-loose applies everything", () => {
    const r = classifyForMode([dropCol], "postgresql", "dev-loose");
    expect(r.verdict).toBe("apply");
    if (r.verdict === "apply") expect(r.applied).toHaveLength(1);
  });

  it("dev-additive skips destructive ops, applies the safe subset", () => {
    const r = classifyForMode(
      [dropCol, addColWithDefault],
      "postgresql",
      "dev-additive"
    );
    expect(r.verdict).toBe("apply");
    if (r.verdict === "apply") {
      expect(r.applied).toHaveLength(1);
      expect(r.skipped).toHaveLength(1);
    }
  });

  it("empty diff applies (no-op) in every mode", () => {
    for (const mode of [
      "dev-additive",
      "dev-loose",
      "production-strict",
    ] as const) {
      expect(classifyForMode([], "postgresql", mode).verdict).toBe("apply");
    }
  });
});
