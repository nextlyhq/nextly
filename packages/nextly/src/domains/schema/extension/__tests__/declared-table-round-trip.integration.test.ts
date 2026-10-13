/**
 * A declared table, pushed and read back, shows no difference.
 *
 * The capabilities file beside this one creates each table with its own
 * hand-written DDL, so it says nothing about what the push makes of a
 * declaration. Here the real boot pushes a plugin's tables, and the database
 * is then read by the introspection the diff engine uses and diffed against
 * the compiled declaration: the same comparison the next development push
 * makes. Anything the push writes differently from how it was declared shows
 * up as an operation, and that push would try to change the table again.
 *
 * The tables carry every column kind the DSL offers, defaults of each type
 * that takes one, a unique compound index, a foreign key between the two and
 * a check.
 */
import { afterEach, expect, it } from "vitest";

import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import { definePlugin } from "../../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { diffSnapshots } from "../../pipeline/diff/diff";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { getActiveExtensionSchema } from "../build-extension-schema";
import { col, defineTable } from "../dsl";

const parents = defineTable("parents", {
  id: col.serial(),
  label: col.shortText(),
});

const kinds = defineTable(
  "kinds",
  {
    id: col.id(),
    title: col.text({ default: "untitled" }),
    code: col.shortText(),
    body: col.longText({ nullable: true }),
    handle: col.varchar(64, { default: "none" }),
    country: col.char(2),
    externalId: col.uuid({ nullable: true }),
    quantity: col.integer({ default: 0 }),
    rank: col.smallint({ default: 1 }),
    views: col.bigint({ nullable: true }),
    ratio: col.double({ nullable: true }),
    weight: col.real({ default: 1.5 }),
    price: col.decimal(10, 2, { default: 9.99 }),
    active: col.boolean({ default: true }),
    publishedAt: col.timestamp({ nullable: true }),
    settings: col.json({ nullable: true }),
    status: col.enum(["draft", "live"]),
    payload: col.bytes({ nullable: true }),
    parentId: col.integer(),
    ...col.timestamps(),
  },
  {
    indexes: [{ columns: ["code", "country"], unique: true }],
    checks: [{ name: "quantity", sql: "quantity >= 0" }],
    foreignKeys: [
      {
        columns: ["parentId"],
        references: { table: "rt__parents", columns: ["id"] },
        onDelete: "cascade",
      },
    ],
  }
);

const fixture = definePlugin({
  name: "round-trip-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: { schema: { prefix: "rt", tables: [parents, kinds] } },
});

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describeEachDialect("a declared table pushed and read back", dialect => {
  it("shows no difference from its declaration", async () => {
    current = await createTestNextly({ dialect, plugins: [fixture] });

    const declared = (getActiveExtensionSchema(dialect)?.specs ?? []).filter(
      spec => spec.name.startsWith("rt__")
    );
    // The premise: both tables compiled, and the comparison below has an
    // index, a foreign key and a check to compare. A declaration that lost
    // one of them would diff clean for the wrong reason.
    expect(declared.map(spec => spec.name).sort()).toEqual([
      "rt__kinds",
      "rt__parents",
    ]);
    const kindsSpec = declared.find(spec => spec.name === "rt__kinds");
    expect(kindsSpec?.columns.length).toBe(21);
    expect(kindsSpec?.indexes?.some(index => index.unique)).toBe(true);
    expect(kindsSpec?.foreignKeys).toHaveLength(1);
    expect(kindsSpec?.checks?.length).toBeGreaterThan(0);

    const live = await introspectLiveSnapshot(
      current.adapter.getDrizzle(),
      dialect,
      declared.map(spec => spec.name)
    );

    expect(diffSnapshots(live, { tables: declared })).toEqual([]);
  });
});
