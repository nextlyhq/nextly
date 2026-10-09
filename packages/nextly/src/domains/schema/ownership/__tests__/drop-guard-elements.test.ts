/**
 * Who may drop or rename an index, a foreign key or a check.
 *
 * Judged as a column is: an owner row naming the element decides, then what
 * the stream's own migrations contributed, then whoever holds the table — a
 * table's own indexes and constraints carry no element row. A drop of another
 * owner's unique index or constraint is refused before anything runs: the
 * migration would otherwise be recorded as applied with the constraint gone,
 * and nothing on a later production run puts it back.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import type { ContributedElements } from "../../pipeline/diff/types";
import { assertNoForeignDrops, indexesNamedWithoutTable } from "../drop-guard";
import type { OwnerRecord } from "../owner-registry";

function record(over: Partial<OwnerRecord>): OwnerRecord {
  return {
    tableName: "unused",
    ownerKind: "plugin",
    ownerId: "fx",
    migratedBy: "plugin:fx",
    ownerVersion: "1.0.0",
    schemaVersion: 1,
    state: "active",
    ...over,
  };
}

/** `app_notes` is the app's table; `fx__notes` is the plugin's. */
const owners = new Map<string, OwnerRecord>([
  [
    "app_notes",
    record({
      tableName: "app_notes",
      ownerKind: "app",
      ownerId: "app",
      migratedBy: "app",
    }),
  ],
  ["fx__notes", record({ tableName: "fx__notes" })],
]);

/**
 * On the app's `dc_posts`, the plugin contributed the unique index
 * `uq_dc_posts_slug_fx`, the foreign key `fk_dc_posts_fx` and the check
 * `ck_dc_posts_fx` — each recorded as the plugin's element.
 */
const elementOwners: OwnerRecord[] = [
  ...owners.values(),
  record({
    tableName: "dc_posts",
    elementKind: "index",
    elementName: "uq_dc_posts_slug_fx",
  }),
  record({
    tableName: "dc_posts",
    elementKind: "fk",
    elementName: "fk_dc_posts_fx",
  }),
  record({
    tableName: "dc_posts",
    elementKind: "check",
    elementName: "ck_dc_posts_fx",
  }),
];

/** Where each index named without its table is, as the database has it. */
const live = new Map([
  ["uq_dc_posts_slug_fx", "dc_posts"],
  ["idx_app_notes_title", "app_notes"],
  ["idx_fx__notes_label", "fx__notes"],
]);

function guard(
  statements: string[],
  stream: string,
  dialect: SupportedDialect,
  extra: {
    liveIndexTables?: ReadonlyMap<string, string>;
    ownedElements?: Record<string, ContributedElements>;
  } = { liveIndexTables: live }
): void {
  assertNoForeignDrops({
    statements,
    stream,
    owners,
    elementOwners,
    dialect,
    source: "001",
    liveTables: new Set(["app_notes", "fx__notes", "dc_posts"]),
    ...extra,
  });
}

/** The refusal `run` throws, or undefined when it does not throw. */
function refusalOf(run: () => void): NextlyError | undefined {
  try {
    run();
  } catch (error) {
    if (NextlyError.is(error)) return error;
    throw error;
  }
  return undefined;
}

describe("an element another stream's row records", () => {
  it.each<[SupportedDialect, string, string]>([
    ["postgresql", "DROP INDEX uq_dc_posts_slug_fx", "uq_dc_posts_slug_fx"],
    [
      "postgresql",
      "DROP INDEX CONCURRENTLY IF EXISTS public.uq_dc_posts_slug_fx",
      "uq_dc_posts_slug_fx",
    ],
    [
      "sqlite",
      'DROP INDEX IF EXISTS "uq_dc_posts_slug_fx"',
      "uq_dc_posts_slug_fx",
    ],
    [
      "mysql",
      "DROP INDEX uq_dc_posts_slug_fx ON dc_posts",
      "uq_dc_posts_slug_fx",
    ],
    [
      "mysql",
      "ALTER TABLE dc_posts DROP INDEX uq_dc_posts_slug_fx",
      "uq_dc_posts_slug_fx",
    ],
    [
      "postgresql",
      "ALTER INDEX uq_dc_posts_slug_fx RENAME TO uq_other",
      "uq_dc_posts_slug_fx",
    ],
    [
      "mysql",
      "ALTER TABLE dc_posts RENAME INDEX uq_dc_posts_slug_fx TO uq_other",
      "uq_dc_posts_slug_fx",
    ],
    [
      "postgresql",
      "ALTER TABLE dc_posts DROP CONSTRAINT IF EXISTS fk_dc_posts_fx",
      "fk_dc_posts_fx",
    ],
    [
      "mysql",
      "ALTER TABLE dc_posts DROP FOREIGN KEY fk_dc_posts_fx",
      "fk_dc_posts_fx",
    ],
    [
      "mysql",
      "ALTER TABLE dc_posts DROP CHECK ck_dc_posts_fx",
      "ck_dc_posts_fx",
    ],
    [
      "postgresql",
      "ALTER TABLE dc_posts RENAME CONSTRAINT ck_dc_posts_fx TO ck_other",
      "ck_dc_posts_fx",
    ],
    // Behind a clause the app is entitled to, in the same statement.
    [
      "postgresql",
      "ALTER TABLE dc_posts ADD COLUMN extra text, DROP CONSTRAINT ck_dc_posts_fx",
      "ck_dc_posts_fx",
    ],
  ])("is refused to the app on %s: %s", (dialect, statement, element) => {
    const refusal = refusalOf(() => guard([statement], "app", dialect));
    expect(refusal?.code).toBe("DROP_OF_FOREIGN_TABLE");
    expect(refusal?.logContext).toMatchObject({
      table: "dc_posts",
      element,
      belongsTo: "plugin:fx",
      source: "001",
    });
  });

  it("is the recording stream's own to drop", () => {
    // The control: the same statements, run by the stream the rows name.
    for (const [dialect, statement] of [
      ["postgresql", "DROP INDEX uq_dc_posts_slug_fx"],
      ["mysql", "ALTER TABLE dc_posts DROP FOREIGN KEY fk_dc_posts_fx"],
      ["postgresql", "ALTER TABLE dc_posts DROP CONSTRAINT ck_dc_posts_fx"],
    ] as const) {
      expect(() => guard([statement], "plugin:fx", dialect)).not.toThrow();
    }
  });
});

describe("an element no row records", () => {
  it("belongs to its table's holder", () => {
    // The app's own index on its own table, taken by the plugin.
    const byPlugin = refusalOf(() =>
      guard(["DROP INDEX idx_app_notes_title"], "plugin:fx", "postgresql")
    );
    expect(byPlugin?.logContext).toMatchObject({
      table: "app_notes",
      element: "idx_app_notes_title",
      belongsTo: "app",
    });
    // The plugin's own index on its own table, taken by the app.
    const byApp = refusalOf(() =>
      guard(
        ["ALTER TABLE fx__notes DROP CONSTRAINT fx__notes_label_key"],
        "app",
        "postgresql"
      )
    );
    expect(byApp?.logContext).toMatchObject({
      table: "fx__notes",
      belongsTo: "plugin:fx",
    });
    // Controls: each holder dropping its own.
    expect(() =>
      guard(["DROP INDEX idx_app_notes_title"], "app", "postgresql")
    ).not.toThrow();
    expect(() =>
      guard(["DROP INDEX idx_fx__notes_label"], "plugin:fx", "sqlite")
    ).not.toThrow();
  });

  it("is the stream's own when its earlier migrations contributed it", () => {
    const run = (ownedElements?: Record<string, ContributedElements>) =>
      refusalOf(() =>
        guard(
          ["ALTER TABLE app_notes DROP CONSTRAINT ck_app_notes_fx"],
          "plugin:fx",
          "postgresql",
          {
            liveIndexTables: live,
            ...(ownedElements ? { ownedElements } : {}),
          }
        )
      );
    expect(run()?.code).toBe("DROP_OF_FOREIGN_TABLE");
    expect(
      run({
        app_notes: {
          columns: [],
          indexes: [],
          foreignKeys: [],
          checks: ["ck_app_notes_fx"],
        },
      })
    ).toBeUndefined();
  });

  it("takes nothing when the database does not have it", () => {
    // Read live and not found: the drop removes nothing.
    expect(() =>
      guard(["DROP INDEX IF EXISTS idx_gone"], "plugin:fx", "postgresql")
    ).not.toThrow();
  });

  it("is refused to a plugin when where it is cannot be read", () => {
    // No live reading: an index named without its table may be on any
    // table, and a plugin holds only what its records say.
    const refusal = refusalOf(() =>
      guard(["DROP INDEX idx_app_notes_title"], "plugin:fx", "postgresql", {})
    );
    expect(refusal?.code).toBe("DROP_OF_FOREIGN_TABLE");
    expect(() =>
      guard(["DROP INDEX idx_app_notes_title"], "app", "postgresql", {})
    ).not.toThrow();
  });

  it("is the list's own on a table the list created", () => {
    expect(() =>
      guard(
        [
          "CREATE TABLE fx__scratch (id text)",
          "ALTER TABLE fx__scratch DROP CONSTRAINT fx__scratch_pkey",
        ],
        "app",
        "postgresql"
      )
    ).not.toThrow();
  });
});

describe("an index dropped by an ALTER TABLE clause", () => {
  it("is judged on the table the clause names, not by its name elsewhere", () => {
    // `uq_dc_posts_slug_fx` is the plugin's on `dc_posts`; the same name on
    // the app's own `app_notes` is the app's to drop, read live or not.
    for (const extra of [{ liveIndexTables: live }, {}]) {
      expect(() =>
        guard(
          ["ALTER TABLE app_notes DROP INDEX uq_dc_posts_slug_fx"],
          "app",
          "mysql",
          extra
        )
      ).not.toThrow();
    }
    // The plugin dropping two of its own table's indexes in one statement.
    expect(() =>
      guard(
        ["ALTER TABLE fx__notes DROP INDEX a, DROP INDEX b"],
        "plugin:fx",
        "mysql",
        {}
      )
    ).not.toThrow();
  });
});

describe("indexesNamedWithoutTable", () => {
  it("names the indexes a list drops or renames without their table", () => {
    expect(
      indexesNamedWithoutTable(
        [
          "DROP INDEX a, public.b",
          "ALTER INDEX IF EXISTS c RENAME TO d",
          "ALTER TABLE t DROP CONSTRAINT e",
        ],
        "postgresql"
      )
    ).toEqual(["a", "b", "c"]);
    // MySQL's always names its table, so nothing needs reading — in the
    // statement's own form, and as clauses of an ALTER TABLE.
    expect(indexesNamedWithoutTable(["DROP INDEX a ON t"], "mysql")).toEqual(
      []
    );
    expect(
      indexesNamedWithoutTable(
        ["ALTER TABLE t DROP INDEX a, DROP INDEX b"],
        "mysql"
      )
    ).toEqual([]);
  });
});
