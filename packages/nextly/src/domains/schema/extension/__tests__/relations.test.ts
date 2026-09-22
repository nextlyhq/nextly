/**
 * Relations, and tables Nextly does not manage.
 *
 * The adoption refusal is the one that matters most and is easiest to get
 * backwards: adopting a MANAGED table would make the pipeline treat a table it
 * maintains as one it must not touch, so schema changes to it would silently
 * stop being applied — and "not managed" is exactly the state that produces no
 * operations, so nothing would report it.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  assertAdoptable,
  assertRelationAllowed,
  impliedEdges,
  toEdges,
} from "../relations";
import type { ExtensionTable, SchemaOwner } from "../types";

const table: ExtensionTable = {
  name: "fx__orders",
  authored: "orders",
  owner: { kind: "plugin", id: "fx" },
  columns: [
    { key: "id", name: "id", kind: "varchar", nullable: false },
    {
      key: "userId",
      name: "user_id",
      kind: "shortText",
      nullable: false,
      references: "users",
    },
    { key: "total", name: "total", kind: "integer", nullable: false },
  ],
  indexes: [],
};

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof NextlyError) {
      const data = error.publicData as
        | { errors?: { message: string }[] }
        | undefined;
      return data?.errors?.[0]?.message ?? "";
    }
    throw error;
  }
  throw new Error("expected a refusal, and the call returned");
}

describe("implied edges", () => {
  it("derives a `one` edge from each ref column", () => {
    // Derived rather than declared twice: a `ref` already states where the
    // column points, and two statements of one fact come to disagree.
    expect(impliedEdges(table)).toEqual([
      { key: "user", fromColumn: "user_id", targetTable: "users" },
    ]);
  });

  it("derives nothing from a table with no refs", () => {
    // The control: an extractor returning an edge per column would relate
    // every table to nothing in particular.
    expect(impliedEdges({ ...table, columns: [table.columns[0]] })).toEqual([]);
  });
});

describe("relation permissions", () => {
  const fx: SchemaOwner = { kind: "plugin", id: "fx" };

  const allowed = (over: Record<string, unknown>) =>
    assertRelationAllowed({
      owner: fx,
      dependsOn: new Set(["billing"]),
      targetTable: "t",
      targetOwner: { kind: "core" },
      path: "p",
      ...over,
    });

  it("allows relating to core and entity tables", () => {
    // Those are Nextly's, not another participant's, and nothing about them
    // is a private contract.
    expect(() => allowed({ targetOwner: { kind: "core" } })).not.toThrow();
    expect(() => allowed({ targetOwner: { kind: "entity" } })).not.toThrow();
  });

  it("allows a plugin its own tables", () => {
    expect(() =>
      allowed({ targetOwner: { kind: "plugin", id: "fx" } })
    ).not.toThrow();
  });

  it("allows a declared dependency", () => {
    expect(() =>
      allowed({ targetOwner: { kind: "plugin", id: "billing" } })
    ).not.toThrow();
  });

  it("refuses an undeclared plugin, saying why the declaration matters", () => {
    // Without `dependsOn` the edge is a guess that works until the other
    // plugin renames a column.
    expect(
      refusal(() =>
        allowed({ targetOwner: { kind: "plugin", id: "stranger" } })
      )
    ).toMatch(/not in dependsOn/);
  });

  it("refuses a target no table declares", () => {
    expect(refusal(() => allowed({ targetOwner: undefined }))).toMatch(
      /no table declares/
    );
  });

  it("refuses a plugin relating to the app's table", () => {
    expect(refusal(() => allowed({ targetOwner: { kind: "app" } }))).toMatch(
      /may not relate to the app/
    );
  });
});

describe("toEdges", () => {
  it("puts a `one` edge on the declaring table", () => {
    const { own, reverse } = toEdges("fx__orders", [
      { kind: "one", key: "user", targetTable: "users", column: "user_id" },
    ]);
    expect(own).toEqual([
      { key: "user", fromColumn: "user_id", targetTable: "users" },
    ]);
    expect(reverse.size).toBe(0);
  });

  it("puts a `many` edge on the TARGET table, pointing back", () => {
    // Registering it on the declaring table would describe a column that
    // table does not have.
    const { own, reverse } = toEdges("fx__orders", [
      { kind: "many", key: "orders", targetTable: "users", column: "user_id" },
    ]);
    expect(own).toEqual([]);
    expect(reverse.get("users")).toEqual([
      { key: "orders", fromColumn: "user_id", targetTable: "fx__orders" },
    ]);
  });
});

describe("adopting an unmanaged table", () => {
  const managed = new Set(["dc_posts", "users", "fx__orders"]);

  it("allows a table Nextly does not manage", () => {
    expect(() => assertAdoptable("legacy_orders", managed)).not.toThrow();
  });

  it("refuses a table Nextly DOES manage", () => {
    // The failure this prevents is silent: the pipeline would treat a table it
    // maintains as one it must not touch, and "not managed" produces no
    // operations — so nothing reports that changes stopped being applied.
    expect(refusal(() => assertAdoptable("dc_posts", managed))).toMatch(
      /stop schema changes to it being applied/
    );
  });

  it("refuses a core table too", () => {
    expect(refusal(() => assertAdoptable("users", managed))).toMatch(
      /Nextly manages/
    );
  });
});
