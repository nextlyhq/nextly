import { describe, expect, it } from "vitest";

import { buildInverseOperations } from "../down-generator";

describe("down-generator — index ops", () => {
  it("inverts add_index to drop_index and vice versa", () => {
    const idx = { name: "uq_dc_x_email", columns: ["email"], unique: true };
    const prev = { tables: [] };
    const invAdd = buildInverseOperations(
      [{ type: "add_index", tableName: "dc_x", index: idx }] as never,
      prev as never
    );
    expect(invAdd[0]).toMatchObject({
      type: "drop_index",
      tableName: "dc_x",
      index: idx,
    });
    const invDrop = buildInverseOperations(
      [{ type: "drop_index", tableName: "dc_x", index: idx }] as never,
      prev as never
    );
    expect(invDrop[0]).toMatchObject({
      type: "add_index",
      tableName: "dc_x",
      index: idx,
    });
  });
});
