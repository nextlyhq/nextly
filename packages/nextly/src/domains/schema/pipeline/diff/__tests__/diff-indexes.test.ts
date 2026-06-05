import { describe, expect, it } from "vitest";

import { diffSnapshots } from "../diff";
import type { NextlySchemaSnapshot } from "../types";

const col = { name: "id", type: "text", nullable: false };
function snap(indexes: unknown): NextlySchemaSnapshot {
  return { tables: [{ name: "dc_x", columns: [col], indexes } as never] };
}

describe("diffIndexes", () => {
  it("emits add_index for a new unique index", () => {
    const prev = snap([]);
    const cur = snap([{ name: "uq_dc_x_email", columns: ["email"], unique: true }]);
    const ops = diffSnapshots(prev, cur).filter(o => o.type === "add_index");
    expect(ops).toHaveLength(1);
    expect((ops[0] as { index: { name: string } }).index.name).toBe("uq_dc_x_email");
  });

  it("emits drop_index only for managed indexes", () => {
    const prev = snap([
      { name: "uq_dc_x_email", columns: ["email"], unique: true },
      { name: "external_idx", columns: ["foo"], unique: false },
    ]);
    const cur = snap([]);
    const drops = diffSnapshots(prev, cur).filter(o => o.type === "drop_index");
    expect(drops).toHaveLength(1); // external_idx is NOT dropped
    expect((drops[0] as { index: { name: string } }).index.name).toBe("uq_dc_x_email");
  });

  it("skips the index dimension when prev has no index data (sentinel)", () => {
    const prev = snap(undefined);
    const cur = snap([{ name: "uq_dc_x_email", columns: ["email"], unique: true }]);
    expect(diffSnapshots(prev, cur).filter(o => o.type.includes("index"))).toEqual([]);
  });

  it("no-ops when the logical key matches despite name differences", () => {
    const prev = snap([{ name: "dc_x_email_key", columns: ["email"], unique: true }]);
    const cur = snap([{ name: "uq_dc_x_email", columns: ["email"], unique: true }]);
    expect(diffSnapshots(prev, cur).filter(o => o.type.includes("index"))).toEqual([]);
  });
});
