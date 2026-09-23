/**
 * Never drop a table on behalf of an owner that does not own it.
 *
 * An app migration dropping a plugin's table is the case that matters: it is
 * refused before any statement runs, so the ledger records nothing applied
 * and the database is untouched.
 */
import { describe, expect, it } from "vitest";

import type { OwnerRecord } from "../owner-registry";
import {
  assertNoForeignDrops,
  pushMayDropTable,
  tablesDroppedBy,
} from "../drop-guard";

function owner(migratedBy: string): OwnerRecord {
  return {
    tableName: "unused",
    ownerKind: "plugin",
    ownerId: "some-plugin",
    migratedBy,
    ownerVersion: "1.0.0",
    schemaVersion: 1,
    state: "active",
  };
}

describe("tablesDroppedBy", () => {
  it("extracts dropped tables, quoted, qualified, and IF EXISTS forms", () => {
    expect(
      tablesDroppedBy([
        'DROP TABLE "auth__identities"',
        "DROP TABLE IF EXISTS `b__x`",
        "DROP TABLE cms.tenants",
        "ALTER TABLE t ADD COLUMN c INT",
        "CREATE TABLE t2 (id INT)",
      ])
    ).toEqual(["auth__identities", "b__x", "tenants"]);
  });

  it("resolves a SQLite rebuild twin to the table it rebuilds", () => {
    expect(tablesDroppedBy(["DROP TABLE __new_dc_posts"])).toEqual([
      "dc_posts",
    ]);
  });
});

describe("assertNoForeignDrops", () => {
  const owners = new Map<string, OwnerRecord>([
    ["auth__identities", { ...owner("plugin:auth"), ownerId: "auth" }],
    ["b__x", { ...owner("plugin:b"), ownerId: "b" }],
  ]);

  it("refuses an app migration dropping a plugin's table, before execution", () => {
    expect(() =>
      assertNoForeignDrops({
        statements: [
          "CREATE TABLE app_notes (id INT)",
          'DROP TABLE "auth__identities"',
        ],
        stream: "app",
        owners,
        source: "0007_cleanup.sql",
      })
    ).toThrow(/different owner/i);
  });

  it("allows the owning plugin's own drop", () => {
    expect(() =>
      assertNoForeignDrops({
        statements: ["DROP TABLE auth__identities"],
        stream: "plugin:auth",
        owners,
        source: "plugin:auth/002_down",
      })
    ).not.toThrow();
  });

  it("refuses one plugin dropping another plugin's table", () => {
    expect(() =>
      assertNoForeignDrops({
        statements: ["DROP TABLE b__x"],
        stream: "plugin:a",
        owners,
        source: "plugin:a/003",
      })
    ).toThrow(/different owner/i);
  });

  it("keeps today's behaviour for a table no owner row claims", () => {
    expect(() =>
      assertNoForeignDrops({
        statements: ["DROP TABLE legacy_orders"],
        stream: "app",
        owners,
        source: "0008.sql",
      })
    ).not.toThrow();
  });

  it("names the table and both owners in the refusal", () => {
    try {
      assertNoForeignDrops({
        statements: ["DROP TABLE b__x"],
        stream: "plugin:a",
        owners,
        source: "plugin:a/003",
      });
      expect.unreachable("must throw");
    } catch (error) {
      const context = JSON.stringify(error);
      expect(context).toContain("b__x");
      expect(context).toContain("plugin:a");
      expect(context).toContain("plugin:b");
    }
  });
});

describe("pushMayDropTable", () => {
  const owners = new Map<string, OwnerRecord>([
    ["auth__identities", owner("plugin:auth")],
    ["app_notes", owner("app")],
    ["dc_posts", owner("app")],
  ]);

  it("never lets dev push drop a plugin-migrated table", () => {
    expect(pushMayDropTable("auth__identities", owners)).toBe(false);
  });

  it("keeps app- and core-owned and unowned tables on today's behaviour", () => {
    expect(pushMayDropTable("app_notes", owners)).toBe(true);
    expect(pushMayDropTable("dc_posts", owners)).toBe(true);
    expect(pushMayDropTable("never_registered", owners)).toBe(true);
  });

  it("resolves rebuild twins through the owner lookup", () => {
    expect(pushMayDropTable("__new_auth__identities", owners)).toBe(false);
  });
});
