/**
 * A SQLite rebuild that keeps every column still drops the old table, and
 * every index, foreign key and check on it goes with that table. Only what
 * the block puts back survives: the twin's named constraints and the indexes
 * created on the table right after the rename. Each one it leaves out is
 * judged as a drop of it by name is, so a rebuild cannot take what the
 * direct `DROP INDEX` or `DROP CONSTRAINT` would be refused.
 *
 * On PostgreSQL and MySQL the block is read as the drop of the table it is,
 * and PostgreSQL's `ALTER TABLE t * ...` is read clause by clause like
 * `ALTER TABLE t ...`.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import type { TableSpec } from "../../pipeline/diff/types";
import { sqliteTableRebuildStatements } from "../../pipeline/sql-templates/sqlite-rebuild";
import { assertNoForeignDrops, type TableElements } from "../drop-guard";
import type { OwnerRecord } from "../owner-registry";

import { liveShape } from "./live-shape";

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

/** `fx__notes` is plugin fx's; `users` is core's, with no row. */
const owners = new Map<string, OwnerRecord>([
  ["fx__notes", record({ tableName: "fx__notes" })],
]);

/** On `fx__notes`, plugin `other` recorded an index, a foreign key and a check. */
const otherElements: OwnerRecord[] = (
  [
    ["index", "fx__notes_other_idx"],
    ["fk", "fx__notes_other_fk"],
    ["check", "fx__notes_other_ck"],
  ] as const
).map(([elementKind, elementName]) =>
  record({
    tableName: "fx__notes",
    elementKind,
    elementName,
    ownerId: "other",
    migratedBy: "plugin:other",
  })
);

const elementOwners: OwnerRecord[] = [...owners.values(), ...otherElements];

function elements(
  over: Partial<Record<keyof TableElements, string[]>> = {}
): TableElements {
  return {
    index: new Set(over.index ?? []),
    fk: new Set(over.fk ?? []),
    check: new Set(over.check ?? []),
  };
}

/** The tables as the database holds them. */
const liveColumns = new Map([
  ["users", new Set(["id", "email"])],
  ["fx__notes", new Set(["id", "label", "user_id"])],
]);
/** `fx__notes`'s columns, key and the rest of its shape in the database. */
const notesShape = liveShape({ id: "TEXT", label: "TEXT", user_id: "TEXT" });
const liveElements = new Map([
  [
    "users",
    {
      ...elements({ index: ["users_email_unique"] }),
      shape: liveShape({ id: "TEXT", email: "TEXT" }),
    },
  ],
  [
    "fx__notes",
    {
      ...elements({
        index: ["fx__notes_other_idx"],
        fk: ["fx__notes_other_fk"],
        check: ["fx__notes_other_ck"],
      }),
      shape: notesShape,
    },
  ],
]);

function guard(
  statements: string[],
  stream: string,
  dialect: SupportedDialect = "sqlite",
  extra: { liveElements?: typeof liveElements } = { liveElements }
): void {
  assertNoForeignDrops({
    statements,
    stream,
    owners,
    elementOwners,
    dialect,
    source: "001",
    liveColumns,
    liveTables: new Set(["users", "fx__notes"]),
    liveIndexTables: new Map([
      ["users_email_unique", "users"],
      ["fx__notes_other_idx", "fx__notes"],
    ]),
    ...extra,
  });
}

/** The refusal's log context, or a failure when nothing was refused. */
function refusal(run: () => void): Record<string, unknown> {
  try {
    run();
  } catch (error) {
    expect(NextlyError.is(error)).toBe(true);
    expect((error as NextlyError).code).toBe("DROP_OF_FOREIGN_TABLE");
    return (error as NextlyError).logContext ?? {};
  }
  return expect.unreachable("must be refused");
}

/** Core `users`, as the pipeline would rebuild it to add `check`. */
function usersRebuild(withIndex: boolean): string[] {
  return sqliteTableRebuildStatements({
    name: "users",
    columns: [
      { name: "id", type: "text", nullable: false, primaryKey: true },
      { name: "email", type: "text", nullable: false },
    ],
    indexes: withIndex
      ? [{ name: "users_email_unique", columns: ["email"], unique: true }]
      : [],
    foreignKeys: [],
    checks: [{ name: "users_email_fx", sql: `"email" <> ''` }],
  });
}

/** `fx__notes`, as the pipeline would rebuild it, with `other`'s elements or not. */
function notesSpec(
  keep: { index?: boolean; fk?: boolean; check?: boolean } = {
    index: true,
    fk: true,
    check: true,
  }
): TableSpec {
  return {
    name: "fx__notes",
    columns: [
      { name: "id", type: "text", nullable: false, primaryKey: true },
      { name: "label", type: "text", nullable: true },
      { name: "user_id", type: "text", nullable: true },
    ],
    indexes: keep.index
      ? [{ name: "fx__notes_other_idx", columns: ["label"], unique: false }]
      : [],
    foreignKeys: keep.fk
      ? [
          {
            name: "fx__notes_other_fk",
            columns: ["user_id"],
            referencesTable: "users",
            referencesColumns: ["id"],
            onDelete: "cascade",
            onUpdate: "no action",
          },
        ]
      : [],
    checks: [
      { name: "fx__notes_label_fx", sql: `"label" <> ''` },
      ...(keep.check
        ? [{ name: "fx__notes_other_ck", sql: `"label" <> 'x'` }]
        : []),
    ],
  };
}

describe("a SQLite rebuild that keeps every column", () => {
  it("is refused when it leaves out a core table's own index", () => {
    expect(
      refusal(() => guard(usersRebuild(false), "plugin:fx"))
    ).toMatchObject({
      table: "users",
      element: "users_email_unique",
      droppedBy: "plugin:fx",
      belongsTo: "core",
    });
    // The control: the direct drop of the same index.
    expect(
      refusal(() => guard(["DROP INDEX users_email_unique"], "plugin:fx"))
    ).toMatchObject({ element: "users_email_unique", belongsTo: "core" });
  });

  it("is approved when it puts the core table's index back", () => {
    expect(() => guard(usersRebuild(true), "plugin:fx")).not.toThrow();
  });

  it.each([
    ["index", "fx__notes_other_idx", { fk: true, check: true }],
    ["foreign key", "fx__notes_other_fk", { index: true, check: true }],
    ["check", "fx__notes_other_ck", { index: true, fk: true }],
  ] as const)(
    "is refused when its owner leaves out another plugin's %s",
    (_kind, element, keep) => {
      expect(
        refusal(() =>
          guard(sqliteTableRebuildStatements(notesSpec(keep)), "plugin:fx")
        )
      ).toMatchObject({
        table: "fx__notes",
        element,
        droppedBy: "plugin:fx",
        belongsTo: "plugin:other",
      });
    }
  );

  it("is approved when it puts back every element another stream holds", () => {
    expect(() =>
      guard(sqliteTableRebuildStatements(notesSpec()), "plugin:fx")
    ).not.toThrow();
    // `other` may leave its own elements out of fx's table.
    expect(() =>
      guard(sqliteTableRebuildStatements(notesSpec({})), "plugin:other")
    ).not.toThrow();
  });

  it("refuses the direct drops of the same elements", () => {
    // The controls for the rebuild cases above.
    expect(
      refusal(() => guard(["DROP INDEX fx__notes_other_idx"], "plugin:fx"))
    ).toMatchObject({
      element: "fx__notes_other_idx",
      belongsTo: "plugin:other",
    });
    for (const name of ["fx__notes_other_fk", "fx__notes_other_ck"]) {
      expect(
        refusal(() =>
          guard(
            [`ALTER TABLE fx__notes DROP CONSTRAINT ${name}`],
            "plugin:fx",
            "postgresql"
          )
        )
      ).toMatchObject({ element: name, belongsTo: "plugin:other" });
    }
  });

  describe("puts an element back only under its name and kind", () => {
    const create = (body: string) =>
      `CREATE TABLE "__new_fx__notes" ("id" TEXT PRIMARY KEY, "label" TEXT, "user_id" TEXT, ${body})`;
    const rest = [
      'INSERT INTO "__new_fx__notes" ("id", "label", "user_id") SELECT "id", "label", "user_id" FROM "fx__notes"',
      'DROP TABLE "fx__notes"',
      'ALTER TABLE "__new_fx__notes" RENAME TO "fx__notes"',
    ];
    const fk =
      'CONSTRAINT "fx__notes_other_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id")';
    const check = `CONSTRAINT "fx__notes_other_ck" CHECK ("label" <> 'x')`;
    const index =
      'CREATE INDEX IF NOT EXISTS "fx__notes_other_idx" ON "fx__notes" ("label")';

    it("approves a hand-written block that puts back all three", () => {
      expect(() =>
        guard([create(`${fk}, ${check}`), ...rest, index], "plugin:fx")
      ).not.toThrow();
      // A foreign key declared on its column counts as well.
      expect(() =>
        guard(
          [
            `CREATE TABLE "__new_fx__notes" ("id" TEXT PRIMARY KEY, "label" TEXT, "user_id" TEXT CONSTRAINT "fx__notes_other_fk" REFERENCES "users" ("id"), ${check})`,
            ...rest,
            index,
          ],
          "plugin:fx"
        )
      ).not.toThrow();
    });

    it.each([
      [
        "an inline UNIQUE under the index's name",
        [
          create(
            `${fk}, ${check}, CONSTRAINT "fx__notes_other_idx" UNIQUE ("label")`
          ),
          ...rest,
        ],
        "fx__notes_other_idx",
      ],
      [
        "a check under the foreign key's name",
        [
          create(`CONSTRAINT "fx__notes_other_fk" CHECK (1), ${check}`),
          ...rest,
          index,
        ],
        "fx__notes_other_fk",
      ],
      [
        "an unnamed check",
        [create(`${fk}, CHECK ("label" <> 'x')`), ...rest, index],
        "fx__notes_other_ck",
      ],
      [
        "the index created on another table",
        [
          create(`${fk}, ${check}`),
          ...rest,
          'CREATE INDEX "fx__notes_other_idx" ON "users" ("email")',
        ],
        "fx__notes_other_idx",
      ],
      [
        "the index created after another statement",
        [create(`${fk}, ${check}`), ...rest, "SELECT 1", index],
        "fx__notes_other_idx",
      ],
    ])("refuses %s", (_shape, statements, element) => {
      expect(refusal(() => guard(statements, "plugin:fx"))).toMatchObject({
        table: "fx__notes",
        element,
        belongsTo: "plugin:other",
      });
    });
  });

  it("is read as the drop of the table when its live elements were not read", () => {
    expect(
      refusal(() =>
        guard(usersRebuild(true), "plugin:fx", "sqlite", {
          liveElements: new Map(),
        })
      )
    ).toMatchObject({ table: "users", belongsTo: "core" });
    // Read as that drop, the block is its holder's to run, as a plain
    // DROP TABLE of its own table is.
    expect(() =>
      guard(sqliteTableRebuildStatements(notesSpec()), "plugin:fx", "sqlite", {
        liveElements: new Map(),
      })
    ).not.toThrow();
  });
});

describe("a rebuild-shaped block on PostgreSQL", () => {
  const block = [
    'CREATE TABLE "__new_fx__notes" ("id" TEXT, "label" TEXT, "user_id" TEXT)',
    'INSERT INTO "__new_fx__notes" ("id", "label", "user_id") SELECT "id", "label", "user_id" FROM "fx__notes"',
    'DROP TABLE "fx__notes"',
    'ALTER TABLE "__new_fx__notes" RENAME TO "fx__notes"',
  ];

  it("is the drop of the table it is", () => {
    expect(refusal(() => guard(block, "app", "postgresql"))).toMatchObject({
      table: "fx__notes",
      droppedBy: "app",
      belongsTo: "plugin:fx",
    });
    // The control: the app's plain drop of the table.
    expect(
      refusal(() => guard(['DROP TABLE "fx__notes"'], "app", "postgresql"))
    ).toMatchObject({ table: "fx__notes", belongsTo: "plugin:fx" });
  });

  it("keeps the table on SQLite, where the pipeline writes it", () => {
    // Plugin `other`, whose elements on the table the block leaves out:
    // on SQLite it keeps fx's table and takes only what is its own, while
    // on PostgreSQL the same block is the drop of fx's table. The live
    // table here has no primary key, as the twin declares none.
    expect(() =>
      guard(block, "plugin:other", "sqlite", {
        liveElements: new Map([
          [
            "fx__notes",
            {
              ...elements(),
              shape: liveShape(
                { id: "TEXT", label: "TEXT", user_id: "TEXT" },
                { primaryKey: [] }
              ),
            },
          ],
        ]),
      })
    ).not.toThrow();
    expect(
      refusal(() => guard(block, "plugin:other", "postgresql"))
    ).toMatchObject({ table: "fx__notes", belongsTo: "plugin:fx" });
  });
});

describe("PostgreSQL's ALTER TABLE t * (the table and its descendants)", () => {
  it.each([
    ["ALTER TABLE users * DROP COLUMN email", { column: "email" }],
    ["ALTER TABLE IF EXISTS ONLY users * DROP email", { column: "email" }],
    [
      "ALTER TABLE users * DROP CONSTRAINT users_email_key",
      { element: "users_email_key" },
    ],
    ["ALTER TABLE users * RENAME COLUMN email TO mail", { column: "email" }],
  ])("reads the clause after the *: %s", (statement, taken) => {
    expect(
      refusal(() => guard([statement], "plugin:fx", "postgresql"))
    ).toMatchObject({ table: "users", belongsTo: "core", ...taken });
  });

  it("lets the table's holder alter its own table that way", () => {
    expect(() =>
      guard(
        ["ALTER TABLE fx__notes * DROP COLUMN label"],
        "plugin:fx",
        "postgresql"
      )
    ).not.toThrow();
  });
});
