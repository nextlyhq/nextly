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

  it("down for an indexed-column removal creates the column before its index", () => {
    // Forward order (the diff contract): drop_index precedes drop_column.
    // The reversed inversion must therefore be (add_column, add_index) — an
    // index created before its column is invalid DDL on every dialect.
    const idx = {
      name: "idx_dc_x_hero_image",
      columns: ["hero_image"],
      unique: false,
    };
    const prev = {
      tables: [
        {
          name: "dc_x",
          columns: [{ name: "hero_image", type: "text", nullable: true }],
          indexes: [idx],
        },
      ],
    };
    const inv = buildInverseOperations(
      [
        { type: "drop_index", tableName: "dc_x", index: idx },
        {
          type: "drop_column",
          tableName: "dc_x",
          columnName: "hero_image",
          columnType: "text",
        },
      ] as never,
      prev as never
    );
    expect(inv.map(o => o.type)).toEqual(["add_column", "add_index"]);
  });
});
