/**
 * The DSL's runtime contract: what a definition IS, and what it refuses.
 *
 * The type test beside this one covers what a definition means to the checker.
 * This covers the data, because every consumer downstream — the diff engine,
 * the migration snapshot, the runtime registry — reads the data and never the
 * types.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { col, defineTable } from "../dsl";

/** The error a caller can act on: a validation failure carrying a path. */
function validationPaths(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof NextlyError) {
      const data = error.publicData as
        | { errors?: { path: string }[] }
        | undefined;
      return (data?.errors ?? []).map(issue => issue.path);
    }
    throw error;
  }
  throw new Error("expected the call to throw, and it returned");
}

describe("defineTable", () => {
  const identities = defineTable(
    "identities",
    {
      id: col.id(),
      providerAccountId: col.shortText(),
      emailAtLink: col.text({ nullable: true }),
      ...col.timestamps(),
    },
    { indexes: [{ columns: ["providerAccountId"], unique: true }] }
  );

  it("survives a JSON round trip unchanged", () => {
    // Every consumer downstream reads this as data — a migration snapshot
    // writes it to disk. Anything not JSON-representable would be lost there
    // rather than here, where it is visible.
    expect(JSON.parse(JSON.stringify(identities))).toEqual(identities);
  });

  it("freezes the definition and its column list", () => {
    expect(Object.isFrozen(identities)).toBe(true);
    expect(Object.isFrozen(identities.columns)).toBe(true);
  });

  it("snake-cases the authored key into the SQL column name", () => {
    const column = identities.columns.find(c => c.key === "providerAccountId");
    expect(column?.name).toBe("provider_account_id");
  });

  it("resolves index columns to their SQL names", () => {
    expect(identities.indexes).toEqual([
      { columns: ["provider_account_id"], unique: true },
    ]);
  });

  it("gives col.id() a bounded, generated primary key", () => {
    // Bounded rather than text: MySQL cannot index an unbounded text column,
    // so a `text` id could not carry the primary key at all.
    expect(identities.columns.find(c => c.key === "id")).toMatchObject({
      kind: "varchar",
      length: 36,
      primaryKey: true,
      generated: "uuidv7",
      nullable: false,
    });
  });

  it("gives col.timestamps() two non-null columns, one refreshed on update", () => {
    expect(identities.columns.find(c => c.key === "createdAt")).toMatchObject({
      name: "created_at",
      kind: "timestamp",
      nullable: false,
      // Tagged, not the bare string: a text column may legitimately default to
      // the word "now", and the compiler has to tell the two apart.
      default: { token: "now" },
    });
    const updated = identities.columns.find(c => c.key === "updatedAt");
    expect(updated).toMatchObject({
      name: "updated_at",
      kind: "timestamp",
      nullable: false,
      default: { token: "now" },
      onUpdate: "now",
    });
  });

  it("refuses a varchar with no usable width", () => {
    expect(validationPaths(() => col.varchar(0))).toEqual(["varchar.length"]);
  });

  it("refuses a decimal whose scale exceeds its precision", () => {
    // DECIMAL(3,5) asks for five fractional digits out of three total, which
    // describes no representable number.
    expect(validationPaths(() => col.decimal(3, 5))).toEqual(["decimal.scale"]);
  });

  it("refuses two keys that collide once snake-cased", () => {
    // `fooBar` and `foo_bar` are one SQL column, so the table would declare it
    // twice and fail at CREATE rather than here.
    expect(
      validationPaths(() =>
        defineTable("t", {
          id: col.id(),
          fooBar: col.text(),
          foo_bar: col.text(),
        })
      )
    ).toEqual(["t.foo_bar"]);
  });

  it("refuses an index naming a column the table does not declare", () => {
    expect(
      validationPaths(() =>
        defineTable("t", { id: col.id() }, { indexes: [{ columns: ["nope"] }] })
      )
    ).toEqual(["t.indexes[0]"]);
  });

  it("refuses an index over no columns", () => {
    expect(
      validationPaths(() =>
        defineTable("t", { id: col.id() }, { indexes: [{ columns: [] }] })
      )
    ).toEqual(["t.indexes[0]"]);
  });

  it("refuses a table with no columns", () => {
    expect(validationPaths(() => defineTable("t", {}))).toEqual(["t"]);
  });
});
