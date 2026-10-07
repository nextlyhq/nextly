/**
 * The two migration guards.
 *
 * Both exist because the failure they prevent is silent. A drift error on an
 * app-owned table blocks a migration that was never wrong; a production run
 * that skips plugin tables reports success and leaves a query to discover it.
 */
import { describe, expect, it, beforeEach } from "vitest";

import { snapshotComparableTables } from "../../pipeline/managed-tables";
import {
  buildExtensionSchema,
  clearActiveExtensionSchema,
  setActiveExtensionSchema,
} from "../build-extension-schema";
import { col, defineTable } from "../dsl";

beforeEach(() => {
  clearActiveExtensionSchema();
});

describe("snapshot scope", () => {
  const live = ["dc_posts", "app_notes", "unrelated_thing"];

  it("keeps an app table the migration snapshots name", () => {
    // `app_notes` matches no managed prefix, so it used to be filtered out of
    // `live` while sitting in both `before` and `target` — and reconcileFile,
    // finding live equal to neither, threw drift on the next migration.
    expect(
      snapshotComparableTables(live, new Set(["dc_posts", "app_notes"]))
    ).toEqual(["dc_posts", "app_notes"]);
  });

  it("still excludes a table no snapshot names", () => {
    // The control: the scope must not become "everything live", or an
    // unrelated table in the same database starts reporting drift.
    expect(snapshotComparableTables(live, new Set(["dc_posts"]))).toEqual([
      "dc_posts",
    ]);
  });

  it("keeps managed tables with no declaration at all", () => {
    expect(snapshotComparableTables(live)).toEqual(["dc_posts"]);
  });
});

describe("plugin tables in production", () => {
  async function activate(owner: "plugin" | "app") {
    const schema = await buildExtensionSchema({
      dialect: "sqlite",
      coreTableNames: [],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins:
        owner === "plugin"
          ? [
              {
                owner: { kind: "plugin", id: "fx" },
                tables: [defineTable("notes", { id: col.id() })],
              },
            ]
          : [],
      ...(owner === "app"
        ? {
            app: {
              owner: { kind: "app" as const },
              tables: [defineTable("app_notes", { id: col.id() })],
            },
          }
        : {}),
    });
    setActiveExtensionSchema("sqlite", schema);
    return schema;
  }

  it("records a plugin owner for a plugin's table", async () => {
    const schema = await activate("plugin");
    expect(schema.owners.get("fx__notes")).toEqual({
      kind: "plugin",
      id: "fx",
    });
  });

  it("records an app owner for an app table, which migrations DO carry", async () => {
    // The discriminator: the refusal must fire for plugin tables and not for
    // app ones, so an owner check that always said "plugin" would pass the
    // test above and fail here.
    const schema = await activate("app");
    expect(schema.owners.get("app_notes")).toEqual({ kind: "app" });
    expect(
      [...schema.owners.values()].some(owner => owner.kind === "plugin")
    ).toBe(false);
  });
});
