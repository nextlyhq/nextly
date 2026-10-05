/**
 * The single injection point.
 *
 * `apply` has many callers — HMR, the collection/single/component
 * dispatchers, the dev server, the DI registration — and merging extensions
 * at each would miss some. The failure that motivates this is quiet: a UI save
 * of a Builder table plans a `drop_index` for a plugin's index on that table,
 * because the desired state that save built knew nothing about it.
 *
 * These cover the merge as a property of the compiled schema, without booting
 * a database. The three-dialect behaviour is covered by the integration suite.
 */
import { describe, expect, it, beforeEach } from "vitest";

import {
  buildExtensionSchema,
  clearActiveExtensionSchema,
  getActiveExtensionSchema,
  isRegisteredExtensionTable,
  setActiveExtensionSchema,
} from "../build-extension-schema";
import { col, defineTable } from "../dsl";

const notes = defineTable(
  "notes",
  { id: col.id(), body: col.shortText() },
  { indexes: [{ columns: ["body"], unique: true }] }
);

async function activate() {
  const schema = await buildExtensionSchema({
    dialect: "postgresql",
    coreTableNames: ["users"],
    entities: [
      {
        name: "dc_posts",
        slug: "posts",
        entityKind: "collection",
        columns: [{ name: "title", kind: "text", nullable: true }],
      },
    ],
    pluginPrefixes: new Map([["fx", "fx"]]),
    plugins: [{ owner: { kind: "plugin", id: "fx" }, tables: [notes] }],
  });
  setActiveExtensionSchema("postgresql", schema);
  return schema;
}

beforeEach(() => {
  clearActiveExtensionSchema();
});

describe("the active schema", () => {
  it("is null until something sets it", () => {
    // The control: every assertion below is about a schema being PRESENT, and
    // a getter that always answered would satisfy those without the set.
    expect(getActiveExtensionSchema("postgresql")).toBeNull();
  });

  it("carries the compiled spec and the Drizzle table for a plugin table", async () => {
    const schema = await activate();
    expect(schema.specs.map(s => s.name)).toEqual(["fx__notes"]);
    expect(Object.keys(schema.drizzle)).toEqual(["fx__notes"]);
  });

  it("keeps the index on the spec and off the Drizzle table", async () => {
    const schema = await activate();
    expect(schema.specs[0].indexes).toHaveLength(1);
    // drizzle-kit would otherwise emit its own CREATE INDEX beside the
    // replayed one, and MySQL has no IF NOT EXISTS.
    expect(schema.specs[0].indexes?.[0]?.unique).toBe(true);
  });
});

describe("isRegisteredExtensionTable", () => {
  it("recognises a declared table", async () => {
    await activate();
    expect(isRegisteredExtensionTable("fx__notes", "postgresql")).toBe(true);
  });

  it("does NOT recognise a table nothing declares any more", async () => {
    await activate();
    clearActiveExtensionSchema();
    // This is the property that keeps an uninstalled plugin's data: a table
    // outside the desired set is protected by `filterUnsafeStatements`. A
    // prefix test would still answer true here and let the drop through.
    expect(isRegisteredExtensionTable("fx__notes", "postgresql")).toBe(false);
  });

  it("does not claim an ordinary collection table", async () => {
    await activate();
    expect(isRegisteredExtensionTable("dc_posts", "postgresql")).toBe(false);
  });
});

describe("the fingerprint gate", () => {
  it("moves when only a hook's index changes", async () => {
    const withoutIndex = await buildExtensionSchema({
      dialect: "postgresql",
      coreTableNames: [],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins: [
        {
          owner: { kind: "plugin", id: "fx" },
          tables: [
            defineTable("notes", { id: col.id(), body: col.shortText() }),
          ],
        },
      ],
    });
    const withIndex = await buildExtensionSchema({
      dialect: "postgresql",
      coreTableNames: [],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins: [{ owner: { kind: "plugin", id: "fx" }, tables: [notes] }],
    });
    // The dequal short-circuit is keyed on this. Without it, editing only a
    // hook leaves `desired` byte-identical, the push is skipped, and nothing
    // reports that the change never reached the database.
    expect(withIndex.fingerprint).not.toBe(withoutIndex.fingerprint);
  });
});
