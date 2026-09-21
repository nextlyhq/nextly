/**
 * Who may drop what.
 *
 * The migration guard judges a file WHOLE, before its first statement runs.
 * Filtering statements instead would be worse than useless: a file with some
 * removed would be recorded as applied, so the ledger would claim a migration
 * ran that partly did not.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  assertNoForeignDrops,
  pushMayDropTable,
  tablesDroppedBy,
} from "../drop-guard";
import type { OwnerRecord } from "../owner-registry";

const owner = (over: Partial<OwnerRecord>): OwnerRecord => ({
  tableName: "x",
  ownerKind: "plugin",
  ownerId: "auth",
  migratedBy: "plugin:auth",
  ownerVersion: null,
  schemaVersion: null,
  state: "active",
  ...over,
});

const OWNERS = new Map<string, OwnerRecord>([
  ["auth__identities", owner({ tableName: "auth__identities" })],
  [
    "b__widgets",
    owner({ tableName: "b__widgets", ownerId: "b", migratedBy: "plugin:b" }),
  ],
  [
    "app_notes",
    owner({
      tableName: "app_notes",
      ownerKind: "app",
      ownerId: "app",
      migratedBy: "app",
    }),
  ],
  [
    "dc_posts",
    owner({
      tableName: "dc_posts",
      ownerKind: "collection",
      ownerId: "posts",
      migratedBy: "app",
    }),
  ],
]);

describe("tablesDroppedBy", () => {
  it("finds the table in each DROP spelling", () => {
    expect(
      tablesDroppedBy([
        "DROP TABLE auth__identities",
        'DROP TABLE IF EXISTS "app_notes"',
        "drop table `b__widgets`;",
      ])
    ).toEqual(["auth__identities", "app_notes", "b__widgets"]);
  });

  it("attributes a SQLite rebuild twin to the real table", () => {
    // A rebuild builds `__new_dc_posts` and renames it over the original, so
    // a statement naming the twin is really about `dc_posts`. Without this the
    // intermediate drop is attributed to a table nobody owns and waved
    // through — the one case where waving through is wrong.
    expect(tablesDroppedBy(["DROP TABLE __new_dc_posts"])).toEqual([
      "dc_posts",
    ]);
  });

  it("ignores statements that drop nothing", () => {
    // The control: an extractor that returned a table for every statement
    // would refuse every migration that mentioned one.
    expect(
      tablesDroppedBy([
        "CREATE TABLE app_notes (id TEXT)",
        "ALTER TABLE app_notes ADD COLUMN x TEXT",
        "DROP INDEX idx_app_notes_x",
      ])
    ).toEqual([]);
  });
});

describe("assertNoForeignDrops", () => {
  const check = (statements: string[], stream: string) =>
    assertNoForeignDrops({ statements, stream, owners: OWNERS, source: "t" });

  it("refuses an app migration dropping a plugin's table", () => {
    expect(() => check(["DROP TABLE auth__identities"], "app")).toThrow(
      NextlyError
    );
  });

  it("allows a plugin's own migration to drop its own table", () => {
    // The discriminator. A guard that refused every drop would pass the test
    // above and make an uninstall impossible.
    expect(() =>
      check(["DROP TABLE auth__identities"], "plugin:auth")
    ).not.toThrow();
  });

  it("refuses one plugin dropping another plugin's table", () => {
    expect(() => check(["DROP TABLE b__widgets"], "plugin:auth")).toThrow(
      NextlyError
    );
  });

  it("allows the app to drop its own table", () => {
    expect(() => check(["DROP TABLE app_notes"], "app")).not.toThrow();
  });

  it("leaves an unclaimed table alone", () => {
    // Today's behaviour, unchanged: absence means nobody has claimed it, and
    // tables created before this registry existed are the ordinary case.
    expect(() => check(["DROP TABLE legacy_thing"], "app")).not.toThrow();
  });

  it("refuses the whole file, naming both owners", () => {
    try {
      check(
        ["CREATE TABLE fine (id TEXT)", "DROP TABLE auth__identities"],
        "app"
      );
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as NextlyError).logContext).toMatchObject({
        table: "auth__identities",
        droppedBy: "app",
        belongsTo: "plugin:auth",
      });
    }
  });
});

describe("pushMayDropTable", () => {
  it("never lets dev push drop a plugin-migrated table", () => {
    // A plugin table removed from config is exactly when its data is most at
    // risk: the plugin is being uninstalled, and that is a decision for
    // `plugin:uninstall` rather than a side effect of a reload.
    expect(pushMayDropTable("auth__identities", OWNERS)).toBe(false);
  });

  it("still lets push manage app and entity tables", () => {
    expect(pushMayDropTable("app_notes", OWNERS)).toBe(true);
    expect(pushMayDropTable("dc_posts", OWNERS)).toBe(true);
  });

  it("leaves an unclaimed table to today's rules", () => {
    expect(pushMayDropTable("ui_created_thing", OWNERS)).toBe(true);
  });

  it("recognises a rebuild twin as its real table", () => {
    expect(pushMayDropTable("__new_auth__identities", OWNERS)).toBe(false);
  });
});
