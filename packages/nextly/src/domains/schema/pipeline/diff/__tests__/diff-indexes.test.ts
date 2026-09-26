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
    const cur = snap([
      { name: "uq_dc_x_email", columns: ["email"], unique: true },
    ]);
    const ops = diffSnapshots(prev, cur).filter(o => o.type === "add_index");
    expect(ops).toHaveLength(1);
    expect((ops[0] as { index: { name: string } }).index.name).toBe(
      "uq_dc_x_email"
    );
  });

  it("emits drop_index only for managed indexes", () => {
    const prev = snap([
      { name: "uq_dc_x_email", columns: ["email"], unique: true },
      { name: "external_idx", columns: ["foo"], unique: false },
    ]);
    const cur = snap([]);
    const drops = diffSnapshots(prev, cur).filter(o => o.type === "drop_index");
    expect(drops).toHaveLength(1); // external_idx is NOT dropped
    expect((drops[0] as { index: { name: string } }).index.name).toBe(
      "uq_dc_x_email"
    );
  });

  it("skips the index dimension when prev has no index data (sentinel)", () => {
    const prev = snap(undefined);
    const cur = snap([
      { name: "uq_dc_x_email", columns: ["email"], unique: true },
    ]);
    expect(
      diffSnapshots(prev, cur).filter(o => o.type.includes("index"))
    ).toEqual([]);
  });

  it("no-ops when the logical key matches despite name differences", () => {
    const prev = snap([
      { name: "dc_x_email_key", columns: ["email"], unique: true },
    ]);
    const cur = snap([
      { name: "uq_dc_x_email", columns: ["email"], unique: true },
    ]);
    expect(
      diffSnapshots(prev, cur).filter(o => o.type.includes("index"))
    ).toEqual([]);
  });

  it("creates a replacement index before dropping the one it replaces", () => {
    // Flipping a field from `index` to `unique` rekeys its index, so the diff
    // emits a drop and an add for the same column. The drop must come second:
    // where DDL auto-commits, a CREATE UNIQUE INDEX that existing duplicate
    // rows reject would otherwise leave the table with neither the old index
    // nor the new constraint.
    const prev = snap([
      { name: "idx_dc_x_code", columns: ["code"], unique: false },
    ]);
    const cur = snap([
      { name: "uq_dc_x_code", columns: ["code"], unique: true },
    ]);

    const types = diffSnapshots(prev, cur).map(o => o.type);

    expect(types.indexOf("add_index")).toBeLessThan(
      types.indexOf("drop_index")
    );
  });

  it("orders drop_index before column ops and add_index after them", () => {
    // Removing an indexed column while adding another indexed one: the
    // removed field's index drop must precede its drop_column (SQLite cannot
    // drop an indexed column), and the new field's add_index must follow its
    // add_column (an index cannot be created before its column exists).
    const prev: NextlySchemaSnapshot = {
      tables: [
        {
          name: "dc_x",
          columns: [col, { name: "hero_image", type: "text", nullable: true }],
          indexes: [
            {
              name: "idx_dc_x_hero_image",
              columns: ["hero_image"],
              unique: false,
            },
          ],
        } as never,
      ],
    };
    const cur: NextlySchemaSnapshot = {
      tables: [
        {
          name: "dc_x",
          columns: [col, { name: "cover", type: "text", nullable: true }],
          indexes: [
            { name: "idx_dc_x_cover", columns: ["cover"], unique: false },
          ],
        } as never,
      ],
    };
    const types = diffSnapshots(prev, cur).map(o => o.type);
    expect(types.indexOf("drop_index")).toBeLessThan(
      types.indexOf("drop_column")
    );
    expect(types.indexOf("add_index")).toBeGreaterThan(
      types.indexOf("add_column")
    );
  });
});

describe("a text cast in an expression index", () => {
  const table = (expression: string) => ({
    name: "fx__scores",
    columns: [
      { name: "id", type: "text", nullable: false },
      { name: "n", type: "integer", nullable: false },
      { name: "label", type: "varchar(64)", nullable: false },
    ],
    indexes: [
      { name: "idx_fx__scores_key", columns: [], unique: false, expression },
    ],
  });
  const ops = (before: string, after: string) =>
    diffSnapshots({ tables: [table(before)] }, { tables: [table(after)] }).map(
      op => op.type
    );

  it("is the author's on a non-text column, so adding one re-keys the index", () => {
    // `n::text` sorts as text, `n` as a number: two different indexes.
    expect(ops("n", "(n)::text").sort()).toEqual(["add_index", "drop_index"]);
  });

  it("is read against each side's own column type", () => {
    // `n` was text and is now an integer: the new side's cast is authored.
    const side = (type: string, expression: string) => ({
      tables: [
        {
          ...table(expression),
          columns: [
            { name: "id", type: "text", nullable: false },
            { name: "n", type, nullable: false },
          ],
        },
      ],
    });
    expect(
      diffSnapshots(side("text", "n"), side("integer", "(n)::text"))
        .map(op => op.type)
        .filter(type => type.endsWith("_index"))
        .sort()
    ).toEqual(["add_index", "drop_index"]);
  });

  it("is PostgreSQL's own on a text-like column, so it changes nothing", () => {
    expect(ops("(label)::text", "label")).toEqual([]);
  });
});

describe("expression index key lists compare by what each key computes", () => {
  it("PostgreSQL's spelling of a two-key list equals its declaration", () => {
    const table = (expression: string) => ({
      name: "fx__users",
      columns: [
        { name: "id", type: "text", nullable: false },
        { name: "email", type: "varchar(255)", nullable: false },
        { name: "status", type: "varchar(32)", nullable: false },
      ],
      indexes: [
        {
          name: "idx_fx__users_email_status",
          columns: [],
          unique: false,
          expression,
        },
      ],
    });
    expect(
      diffSnapshots(
        { tables: [table("lower((email)::text), status")] },
        { tables: [table("lower(email), status")] }
      )
    ).toEqual([]);
    // The control: a different second key is a different index.
    expect(
      diffSnapshots(
        { tables: [table("lower((email)::text), status")] },
        { tables: [table("lower(email), state")] }
      )
        .map(op => op.type)
        .sort()
    ).toEqual(["add_index", "drop_index"]);
  });
});
