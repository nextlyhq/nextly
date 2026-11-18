import { describe, expect, it } from "vitest";

import type { NextlySchemaSnapshot } from "../../pipeline/diff/types";
import {
  droppedTranslations,
  translationsDropsPlaced,
} from "../dropped-translations";
import type { EntitySettingsRecord, SettingsObject } from "../entity-settings";

/** A previous record holding one translated collection, `notes`, with these fields. */
function recordOf(fields: SettingsObject[]): EntitySettingsRecord {
  return {
    collections: {
      notes: { source: "builder", settings: { localized: true, fields } },
    },
    singles: {},
    fieldGroups: {},
  };
}

/** A previous snapshot whose `dc_notes` the snapshot records as translated, with `localizedColumns`. */
function snapshotOf(
  localizedColumns: string[] | undefined
): NextlySchemaSnapshot {
  return {
    tables: [
      {
        name: "dc_notes",
        columns: [{ name: "id", type: "text", nullable: false }],
        localized: true,
        ...(localizedColumns === undefined ? {} : { localizedColumns }),
      },
      {
        name: "dc_plain",
        columns: [{ name: "id", type: "text", nullable: false }],
      },
    ],
  } as NextlySchemaSnapshot;
}

const dropping = (...tables: string[]) =>
  tables.map(tableName => ({ type: "drop_table" as const, tableName }));

describe("the translations table of a dropped table", () => {
  it("drops it first, CASCADE on PostgreSQL only, and leaves an untranslated table's alone", () => {
    for (const [dialect, drop] of [
      ["postgresql", 'DROP TABLE IF EXISTS "dc_notes_locales" CASCADE'],
      ["sqlite", 'DROP TABLE IF EXISTS "dc_notes_locales"'],
      ["mysql", "DROP TABLE IF EXISTS `dc_notes_locales`"],
    ] as const) {
      const { up } = droppedTranslations({
        operations: dropping("dc_notes", "dc_plain"),
        previous: snapshotOf(["body"]),
        previousEntities: recordOf([
          { name: "body", type: "text", localized: true },
        ]),
        dialect,
        defaultLocale: "en",
      });
      expect(up).toEqual([{ table: "dc_notes", statement: drop }]);
    }
  });

  it("makes it again in the DOWN with the columns the snapshot recorded", () => {
    const { down } = droppedTranslations({
      operations: dropping("dc_notes"),
      previous: snapshotOf(["body"]),
      previousEntities: recordOf([
        { name: "body", type: "text", localized: true },
        { name: "summary", type: "text", localized: true },
      ]),
      dialect: "sqlite",
      defaultLocale: "en",
    });
    expect(down).toHaveLength(1);
    expect(down[0]).toMatch(/^CREATE TABLE IF NOT EXISTS "dc_notes_locales"/);
    expect(down[0]).toContain('"body"');
    // Recorded as not in the translations table, so not made there.
    expect(down[0]).not.toContain('"summary"');
  });

  it("makes again a translations table the snapshot records with no column, after its last translated field became shared", () => {
    const { down } = droppedTranslations({
      operations: dropping("dc_notes"),
      previous: snapshotOf([]),
      previousEntities: recordOf([{ name: "body", type: "text" }]),
      dialect: "sqlite",
      defaultLocale: "en",
    });
    expect(down).toHaveLength(1);
    expect(down[0]).toMatch(/^CREATE TABLE IF NOT EXISTS "dc_notes_locales"/);
    expect(down[0]).toContain('"_parent"');
    expect(down[0]).not.toContain('"body"');
  });

  it("makes it from the recorded fields where the snapshot does not record its columns", () => {
    const { down } = droppedTranslations({
      operations: dropping("dc_notes"),
      previous: snapshotOf(undefined),
      previousEntities: recordOf([{ name: "body", type: "text" }]),
      dialect: "sqlite",
      defaultLocale: "en",
    });
    expect(down).toHaveLength(1);
    expect(down[0]).toContain('"body"');
  });

  it("drops it but makes none where the snapshot records no declaration of the entity", () => {
    const { up, down } = droppedTranslations({
      operations: dropping("dc_notes"),
      previous: snapshotOf(["body"]),
      previousEntities: undefined,
      dialect: "sqlite",
      defaultLocale: "en",
    });
    // Dropped where it stands; made again by the runtime's own check at the next start.
    expect(up.map(d => d.statement)).toEqual([
      'DROP TABLE IF EXISTS "dc_notes_locales"',
    ]);
    expect(down).toEqual([]);
  });
});

describe("the translations table of a dropped field group", () => {
  it("is found under the table name its record keeps, not one made from its slug", () => {
    const { down } = droppedTranslations({
      operations: dropping("comp_custom_cards"),
      previous: {
        tables: [
          {
            name: "comp_custom_cards",
            columns: [{ name: "id", type: "text", nullable: false }],
            localized: true,
            localizedColumns: ["caption"],
          },
        ],
      } as NextlySchemaSnapshot,
      previousEntities: {
        collections: {},
        singles: {},
        fieldGroups: {
          cards: {
            source: "builder",
            settings: {
              tableName: "comp_custom_cards",
              localized: true,
              fields: [{ name: "caption", type: "text", localized: true }],
            },
          },
        },
      },
      dialect: "sqlite",
      defaultLocale: "en",
    });
    expect(down).toHaveLength(1);
    expect(down[0]).toMatch(
      /^CREATE TABLE IF NOT EXISTS "comp_custom_cards_locales"/
    );
  });
});

describe("where a translations table's drop goes in the file", () => {
  it("goes right before its table's drop, after the guards the file leads with", () => {
    const guard =
      'SELECT CASE WHEN EXISTS (SELECT 1 FROM "dc_posts" WHERE "tags" IS NOT NULL) THEN 1 END';
    const placed = translationsDropsPlaced(
      [
        guard,
        'DROP TABLE "dc_notes"',
        'ALTER TABLE "dc_posts" DROP COLUMN "tags"',
      ],
      [
        {
          table: "dc_notes",
          statement: 'DROP TABLE IF EXISTS "dc_notes_locales"',
        },
      ],
      "sqlite"
    );
    // A guard that refuses stops the file before any translations table is dropped.
    expect(placed).toEqual([
      guard,
      'DROP TABLE IF EXISTS "dc_notes_locales"',
      'DROP TABLE "dc_notes"',
      'ALTER TABLE "dc_posts" DROP COLUMN "tags"',
    ]);
  });
});
