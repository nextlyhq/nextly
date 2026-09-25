/**
 * Never drop a table on behalf of an owner that does not own it.
 *
 * An app migration dropping a plugin's table is the case that matters: it is
 * refused before any statement runs, so the ledger records nothing applied
 * and the database is untouched.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import type { Operation } from "../../pipeline/diff/types";
import { generateSQL } from "../../pipeline/sql-templates";
import {
  assertNoForeignDrops,
  dropsPluginMigratedTable,
  pushMayDropTable,
  tablesDroppedBy,
} from "../drop-guard";
import type { OwnerRecord } from "../owner-registry";

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

const dialects: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

describe("tablesDroppedBy", () => {
  it("extracts dropped tables, quoted, qualified, and IF EXISTS forms", () => {
    // SQLite accepts both double quotes and backticks, so one list covers
    // every quoting form.
    expect(
      tablesDroppedBy(
        [
          'DROP TABLE "auth__identities"',
          "DROP TABLE IF EXISTS `b__x`",
          "DROP TABLE cms.tenants",
          "ALTER TABLE t ADD COLUMN c INT",
          "CREATE TABLE t2 (id INT)",
        ],
        "sqlite"
      )
    ).toEqual(["auth__identities", "b__x", "tenants"]);
  });

  it.each(dialects)(
    "resolves a SQLite rebuild twin to the table it rebuilds on %s",
    dialect => {
      expect(tablesDroppedBy(["DROP TABLE __new_dc_posts"], dialect)).toEqual([
        "dc_posts",
      ]);
    }
  );
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
        dialect: "postgresql",
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
        dialect: "postgresql",
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
        dialect: "postgresql",
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
        dialect: "postgresql",
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
        dialect: "postgresql",
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

describe("dropsPluginMigratedTable", () => {
  const pluginMigrated = new Set(["auth__identities"]);

  it("recognises a quoted drop, the way the templates render one", () => {
    // The raw capture kept the quotes, so `"auth__identities"` never matched
    // the bare name in the set and dev push dropped the plugin's table.
    expect(
      dropsPluginMigratedTable(
        'DROP TABLE "auth__identities" CASCADE',
        pluginMigrated,
        "postgresql"
      )
    ).toBe(true);
    expect(
      dropsPluginMigratedTable(
        "DROP TABLE `auth__identities`",
        pluginMigrated,
        "mysql"
      )
    ).toBe(true);
  });

  it("withholds a drop it cannot read", () => {
    expect(
      dropsPluginMigratedTable(
        "DROP TABLE x /*!, auth__identities */",
        pluginMigrated,
        "mysql"
      )
    ).toBe(true);
  });

  it.each(dialects)(
    "does not withhold a statement that only mentions a drop in a string on %s",
    dialect => {
      // Reading string contents as code refused this, and dev push withheld
      // a legitimate INSERT without saying so.
      expect(
        dropsPluginMigratedTable(
          "INSERT INTO fx__notes VALUES ('how to drop table auth__identities')",
          pluginMigrated,
          dialect
        )
      ).toBe(false);
    }
  );

  it("leaves every other statement to dev push", () => {
    expect(
      dropsPluginMigratedTable(
        'DROP TABLE "app_notes" CASCADE',
        pluginMigrated,
        "postgresql"
      )
    ).toBe(false);
    expect(
      dropsPluginMigratedTable(
        'ALTER TABLE "auth__identities" DROP COLUMN "x"',
        pluginMigrated,
        "postgresql"
      )
    ).toBe(false);
  });
});

/**
 * The stricter reader refuses what it cannot read, so everything Nextly
 * itself writes has to stay readable: a refusal of Nextly's own output would
 * block every migration that drops a table.
 */
describe("the DROP statements Nextly generates", () => {
  // The operations whose SQL contains a DROP, rendered by the same templates
  // migrate:create, the down generator and plugin module generation use.
  const operations: Operation[] = [
    { type: "drop_table", tableName: "app_notes" },
    { type: "drop_table", tableName: "__new_app_notes" },
    {
      type: "drop_column",
      tableName: "app_notes",
      columnName: "body",
      columnType: "text",
    },
    {
      type: "drop_index",
      tableName: "app_notes",
      index: { name: "idx_app_notes_title", columns: ["title"], unique: false },
    },
    {
      type: "drop_check",
      tableName: "app_notes",
      check: { name: "ck_app_notes_title", sql: "length(title) > 0" },
    },
  ];

  it.each(dialects)("reads every template drop on %s", dialect => {
    const dropped = operations.flatMap(op => {
      let sql: string;
      try {
        sql = generateSQL(op, dialect);
      } catch {
        // An operation the dialect refuses to render emits nothing to read.
        return [];
      }
      return tablesDroppedBy(sql.split(";\n"), dialect);
    });
    // Both drop_table ops, the twin resolved to its table; the column, index
    // and check drops name no table.
    expect(dropped).toEqual(["app_notes", "app_notes"]);
  });

  // The shapes built by string in the collection, field-group, user-ext and
  // i18n services, and drizzle-kit's own output with its breakpoint marker,
  // each read with the dialect that emits it.
  const doubleQuoted = [
    'DROP TABLE IF EXISTS "dc_posts" CASCADE',
    'DROP TABLE IF EXISTS "dc_posts";',
    'DROP TABLE "dc_posts_locales";',
    'DROP TABLE "dc_posts" CASCADE;--> statement-breakpoint',
    'DROP TABLE "__new_dc_posts";--> statement-breakpoint',
  ];
  const backticked = [
    "DROP TABLE IF EXISTS `dc_posts`;",
    "DROP TABLE IF EXISTS `dc_posts` CASCADE;",
    "DROP TABLE `dc_posts_locales`;",
    "DROP TABLE `__new_dc_posts`;--> statement-breakpoint",
  ];
  const doubleQuotedRead = [
    "dc_posts",
    "dc_posts",
    "dc_posts_locales",
    "dc_posts",
    "dc_posts",
  ];
  const backtickedRead = [
    "dc_posts",
    "dc_posts",
    "dc_posts_locales",
    "dc_posts",
  ];

  it.each<[SupportedDialect, string[], string[]]>([
    ["postgresql", doubleQuoted, doubleQuotedRead],
    ["mysql", backticked, backtickedRead],
    [
      "sqlite",
      [...doubleQuoted, ...backticked],
      [...doubleQuotedRead, ...backtickedRead],
    ],
  ])(
    "reads the hand-rendered drops the services and the kit emit on %s",
    (dialect, statements, expected) => {
      expect(tablesDroppedBy(statements, dialect)).toEqual(expected);
    }
  );
});
