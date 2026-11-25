/**
 * Which of a plugin's recorded elements `nextly migrate` leaves out of the database's side of a
 * migration file's comparison, and each reason one is kept in it.
 */
import { describe, expect, it } from "vitest";

import type {
  NextlySchemaSnapshot,
  TableSpec,
} from "../../pipeline/diff/types";
import { ownerRowsToRecord, type ContributedElement } from "../kept-elements";
import { withoutRecordedPluginElements } from "../recorded-drift";

const PLUGIN = { kind: "plugin", id: "@test/plugin" } as const;

const column = (name: string) => ({ name, type: "text", nullable: true });

/** `posts` as the database has it: the app's column and the plugin's parts. */
const livePosts = (): TableSpec => ({
  name: "dc_posts",
  columns: [column("id"), column("title"), column("marker")],
  indexes: [
    { name: "title_idx", columns: ["title"], unique: false },
    { name: "marker_idx", columns: ["marker"], unique: false },
  ],
  foreignKeys: [],
  checks: [],
});

const snapshot = (...tables: TableSpec[]): NextlySchemaSnapshot => ({ tables });

/** What the app's history describes of `posts`: without the plugin's parts. */
const described = (): TableSpec => ({
  ...livePosts(),
  columns: [column("id"), column("title")],
  indexes: [{ name: "title_idx", columns: ["title"], unique: false }],
});

/** The plugin's column and index on `dc_posts`, as a push records them. */
const ROWS = (
  elements: ContributedElement[] = [
    {
      table: "dc_posts",
      elementKind: "column",
      elementName: "marker",
      owner: PLUGIN,
    },
    {
      table: "dc_posts",
      elementKind: "index",
      elementName: "marker_idx",
      owner: PLUGIN,
    },
  ]
) => ownerRowsToRecord(elements, new Set(), []);

const leftOut = (
  overrides: Partial<Parameters<typeof withoutRecordedPluginElements>[0]> = {}
) =>
  withoutRecordedPluginElements({
    live: snapshot(livePosts()),
    rows: ROWS(),
    before: snapshot(described()),
    target: snapshot(described()),
    statements: ['ALTER TABLE "dc_posts" ADD COLUMN "extra" text'],
    dialect: "postgresql",
    ...overrides,
  }).tables[0]!;

const namesOf = (table: TableSpec) => ({
  columns: table.columns.map(each => each.name),
  indexes: (table.indexes ?? []).map(each => each.name),
});

const KEPT_WHOLE = {
  columns: ["id", "title", "marker"],
  indexes: ["title_idx", "marker_idx"],
};

describe("withoutRecordedPluginElements", () => {
  it("leaves out the column and index a plugin's rows name exactly", () => {
    expect(namesOf(leftOut())).toEqual({
      columns: ["id", "title"],
      indexes: ["title_idx"],
    });
  });

  it("leaves out a foreign key and a check, and no element of another kind that has their name", () => {
    const live: TableSpec = {
      ...livePosts(),
      foreignKeys: [
        {
          name: "marker_fk",
          columns: ["marker"],
          referencesTable: "dc_notes",
          referencesColumns: ["id"],
        },
      ] as never,
      checks: [{ name: "marker_check", expression: "marker <> ''" }] as never,
    };
    const rows = ROWS([
      {
        table: "dc_posts",
        elementKind: "fk",
        elementName: "marker_fk",
        owner: PLUGIN,
      },
      {
        table: "dc_posts",
        elementKind: "check",
        elementName: "marker_check",
        owner: PLUGIN,
      },
    ]);
    const table = leftOut({ live: snapshot(live), rows });
    expect(table.foreignKeys).toEqual([]);
    expect(table.checks).toEqual([]);
    expect(namesOf(table)).toEqual(KEPT_WHOLE);
  });

  it("keeps an index no row names, though the column it stands on is left out", () => {
    const rows = ROWS([
      {
        table: "dc_posts",
        elementKind: "column",
        elementName: "marker",
        owner: PLUGIN,
      },
    ]);
    expect(namesOf(leftOut({ rows }))).toEqual({
      columns: ["id", "title"],
      indexes: ["title_idx", "marker_idx"],
    });
  });

  it.each([
    ["no rows", { rows: [] }],
    [
      "the app's rows",
      {
        rows: ROWS().map(row => ({
          ...row,
          ownerKind: "app" as const,
          ownerId: "app",
        })),
      },
    ],
    [
      "rows of another table",
      { rows: ROWS().map(row => ({ ...row, tableName: "dc_other" })) },
    ],
    [
      "rows of another kind",
      {
        rows: ROWS().map(row => ({
          ...row,
          elementKind:
            row.elementKind === "column"
              ? ("index" as const)
              : ("column" as const),
        })),
      },
    ],
    [
      "rows that spell the name in another case",
      {
        rows: ROWS().map(row => ({
          ...row,
          elementName: row.elementName?.toUpperCase(),
        })),
      },
    ],
    [
      "a table row",
      { rows: ROWS().map(row => ({ ...row, elementKind: "table" as const })) },
    ],
  ])("keeps the parts with %s", (_what, overrides) => {
    expect(namesOf(leftOut(overrides))).toEqual(KEPT_WHOLE);
  });

  it.each([
    ["before it", { before: snapshot(livePosts()) }],
    ["after it", { target: snapshot(livePosts()) }],
    [
      "in another case",
      {
        before: snapshot({
          ...described(),
          columns: [...described().columns, column("MARKER")],
          indexes: [
            ...(described().indexes ?? []),
            { name: "MARKER_IDX", columns: ["MARKER"], unique: false },
          ],
        }),
      },
    ],
  ])("keeps the parts the file's snapshot describes %s", (_when, overrides) => {
    expect(namesOf(leftOut(overrides))).toEqual(KEPT_WHOLE);
  });

  it.each([
    [
      "a block of four statements",
      [
        'CREATE TABLE "__new_dc_posts" ("id" text, "title" text)',
        'INSERT INTO "__new_dc_posts" ("id", "title") SELECT "id", "title" FROM "dc_posts"',
        'DROP TABLE "dc_posts"',
        'ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts"',
      ],
    ],
    [
      "statements between them",
      [
        'CREATE TABLE "__new_dc_posts" ("id" text, "title" text)',
        "PRAGMA defer_foreign_keys=ON",
        'INSERT INTO "__new_dc_posts" ("id", "title") SELECT "id", "title" FROM "dc_posts"',
        'DROP TABLE "dc_posts"',
        "SELECT 1",
        'ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts"',
      ],
    ],
  ])(
    "keeps the parts of a table the file rebuilds in %s",
    (_how, statements) => {
      expect(namesOf(leftOut({ statements, dialect: "sqlite" }))).toEqual(
        KEPT_WHOLE
      );
    }
  );

  it("leaves the parts out of a table another table's rebuild does not touch", () => {
    const statements = [
      'CREATE TABLE "__new_dc_notes" ("id" text)',
      'INSERT INTO "__new_dc_notes" ("id") SELECT "id" FROM "dc_notes"',
      'DROP TABLE "dc_notes"',
      'ALTER TABLE "__new_dc_notes" RENAME TO "dc_notes"',
    ];
    expect(namesOf(leftOut({ statements, dialect: "sqlite" }))).toEqual({
      columns: ["id", "title"],
      indexes: ["title_idx"],
    });
  });

  it.each([
    ["the file does not describe the table before it", { before: snapshot() }],
    ["the file does not describe the table after it", { target: snapshot() }],
  ])("keeps the parts where %s", (_why, overrides) => {
    expect(namesOf(leftOut(overrides))).toEqual(KEPT_WHOLE);
  });

  it("keeps the part a statement names, in any case, and leaves the other out", () => {
    const table = leftOut({
      statements: ['ALTER TABLE "dc_posts" DROP COLUMN "Marker"'],
    });
    expect(namesOf(table)).toEqual({
      columns: ["id", "title", "marker"],
      indexes: ["title_idx"],
    });
  });

  it("does not take a longer name for the part's", () => {
    expect(
      namesOf(
        leftOut({
          statements: ['ALTER TABLE "dc_posts" ADD COLUMN "marker_note" text'],
        })
      )
    ).toEqual({ columns: ["id", "title"], indexes: ["title_idx"] });
  });
});
