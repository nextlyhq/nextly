/**
 * The extension-only column kinds.
 *
 * Two properties per kind, and the second is the one that was missing when
 * these were added: the kind must RENDER a dialect type, and it must BUILD a
 * Drizzle column. The builders return `unknown` with no `default` arm, so a
 * kind nobody added a case for compiles cleanly and produces `undefined` —
 * `services/__tests__/column-kind-coverage.test.ts` is the standing control
 * for that, and this file covers what each kind means.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { toTableSpec } from "../compile";
import { col, defineTable, type InferRow } from "../dsl";
import type { ExtensionTable } from "../types";

function tableOf(columns: Parameters<typeof defineTable>[1]): ExtensionTable {
  const def = defineTable("widgets", columns);
  return {
    name: "fx__widgets",
    authored: "widgets",
    owner: { kind: "plugin", id: "fx" },
    columns: def.columns.map(c => ({ ...c })),
    indexes: [],
  };
}

describe("the new kinds render per dialect", () => {
  const table = tableOf({
    id: col.id(),
    big: col.bigint(),
    small: col.smallint(),
    code: col.char(3),
    ref: col.uuid(),
    ratio: col.real(),
    blobby: col.bytes({ nullable: true }),
  });

  it("gives PostgreSQL its introspection tokens", () => {
    const spec = toTableSpec(table, "postgresql");
    const type = (name: string) =>
      spec.columns.find(c => c.name === name)?.type;
    // `int8`/`int2`/`float4`/`bpchar` rather than the SQL keywords: the live
    // side reads `udt_name`, so the desired side must say the same or every
    // diff reports a type change on a column nobody touched.
    expect(type("big")).toBe("int8");
    expect(type("small")).toBe("int2");
    expect(type("ratio")).toBe("float4");
    expect(type("code")).toBe("bpchar");
    expect(type("ref")).toBe("uuid");
    expect(type("blobby")).toBe("bytea");
  });

  it("gives MySQL its own spellings", () => {
    const spec = toTableSpec(table, "mysql");
    const type = (name: string) =>
      spec.columns.find(c => c.name === name)?.type;
    expect(type("big")).toBe("bigint");
    expect(type("code")).toBe("char(3)");
    expect(type("ref")).toBe("char(36)");
    expect(type("blobby")).toBe("longblob");
  });

  it("collapses to SQLite's few storage classes", () => {
    const spec = toTableSpec(table, "sqlite");
    const type = (name: string) =>
      spec.columns.find(c => c.name === name)?.type;
    // SQLite has one integer type and one text type. The declaration stays
    // portable because what it promises is the value's shape, not the word.
    expect(type("big")).toBe("integer");
    expect(type("small")).toBe("integer");
    expect(type("code")).toBe("text");
    expect(type("blobby")).toBe("blob");
  });
});

describe("char", () => {
  it("carries its width into the spec", () => {
    const spec = toTableSpec(
      tableOf({ id: col.id(), code: col.char(3) }),
      "mysql"
    );
    expect(spec.columns.find(c => c.name === "code")?.type).toBe("char(3)");
  });

  it("refuses a width no dialect accepts", () => {
    expect(() => col.char(0)).toThrow(NextlyError);
    expect(() => col.char(9999)).toThrow(NextlyError);
  });
});

describe("enum", () => {
  const status = defineTable("orders", {
    id: col.id(),
    state: col.enum(["open", "paid", "void"] as const),
  });

  it("records its permitted values", () => {
    expect(status.columns.find(c => c.key === "state")).toMatchObject({
      kind: "enum",
      enumValues: ["open", "paid", "void"],
    });
  });

  it("narrows the inferred type to the literal union", () => {
    // The point of declaring one: a value outside the set is a compile error
    // rather than a row the database refuses at write time.
    type Row = InferRow<typeof status>;
    const row: Row = { id: "x", state: "paid" };
    expect(row.state).toBe("paid");
    // @ts-expect-error "cancelled" is not one of the declared values.
    const bad: Row = { id: "x", state: "cancelled" };
    expect(bad.state).toBe("cancelled");
  });

  it("refuses an empty set", () => {
    expect(() => col.enum([] as const)).toThrow(NextlyError);
  });

  it("refuses a repeated value", () => {
    // A duplicate is a typo every time, and the database would accept the
    // type while the second entry did nothing.
    expect(() => col.enum(["open", "open"] as const)).toThrow(NextlyError);
  });

  it("carries an explicit type name for a native PostgreSQL enum", () => {
    const named = defineTable("orders", {
      id: col.id(),
      state: col.enum(["open"] as const, { name: "order_status" }),
    });
    expect(named.columns.find(c => c.key === "state")).toMatchObject({
      enumName: "order_status",
    });
  });
});

describe("serialisation", () => {
  it("survives a JSON round trip with the new kinds", () => {
    // Every consumer downstream reads a definition as data — a migration
    // snapshot writes it to disk — so a kind carrying something
    // non-representable would be lost there rather than here.
    const def = defineTable("widgets", {
      id: col.id(),
      big: col.bigint(),
      state: col.enum(["a", "b"] as const),
      raw: col.bytes({ nullable: true }),
    });
    expect(JSON.parse(JSON.stringify(def))).toEqual(def);
  });
});
