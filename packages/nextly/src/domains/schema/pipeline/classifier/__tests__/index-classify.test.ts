import { describe, expect, it } from "vitest";

import { classifyForMode } from "../modes";

const dropIndex = {
  type: "drop_index" as const,
  tableName: "dc_x",
  index: { name: "uq_dc_x_e", columns: ["e"], unique: true },
};
const addIndex = {
  type: "add_index" as const,
  tableName: "dc_x",
  index: { name: "idx_dc_x_e", columns: ["e"], unique: false },
};

describe("classifier — index op safety", () => {
  it("refuses drop_index in production-strict (destructive)", () => {
    const r = classifyForMode([dropIndex], "postgresql", "production-strict");
    expect(r.verdict).toBe("refuse");
  });

  it("skips drop_index in dev-additive (destructive, not auto-applied)", () => {
    const r = classifyForMode([dropIndex], "postgresql", "dev-additive");
    expect(r.verdict).toBe("apply");
    expect(r.verdict === "apply" && r.skipped).toHaveLength(1);
  });

  it("applies add_index in dev-additive (safe/additive)", () => {
    const r = classifyForMode([addIndex], "postgresql", "dev-additive");
    expect(r.verdict).toBe("apply");
    expect(r.verdict === "apply" && r.applied).toHaveLength(1);
  });
});
