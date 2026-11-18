/**
 * Which entities a migration file changes the field types of, read from the snapshots on either
 * side of it and the renames its statements make (`fileTypeChangesOf`): no database.
 *
 * What separates the correct reading from plausible broken ones: a rename is paired only by the
 * file's own statement (without it the old field is a drop and the new one an add, which no type
 * change judges); an entity the file adds, or one a snapshot records no fields for, is not judged;
 * each entity's table is the one the migrate commands spell, and a translated entity's values are
 * read from its companion.
 */
import { describe, expect, it } from "vitest";

import type {
  EntitySettingsRecord,
  RecordedEntitySettings,
} from "../../../migrate-create/entity-settings";
import { mysqlLiveStatements } from "../../../pipeline/sql-templates/mysql-live-restate";
import {
  type FileTypeChangeSource,
  fileTypeChangesOf,
} from "../file-type-changes";

const declared = (
  settings: Record<string, unknown>,
  source: RecordedEntitySettings["source"] = "code"
): RecordedEntitySettings => ({ source, settings: settings as never });

const record = (
  parts: Partial<EntitySettingsRecord> = {}
): EntitySettingsRecord => ({
  collections: {},
  singles: {},
  fieldGroups: {},
  ...parts,
});

const TEXT = { name: "heading", type: "text" };
const SELECT = {
  name: "heading",
  type: "select",
  options: [{ label: "A", value: "a" }],
};

const source = (
  before: EntitySettingsRecord | undefined,
  target: EntitySettingsRecord | undefined,
  statements: string[] = [],
  dialect: FileTypeChangeSource["dialect"] = "postgresql"
): FileTypeChangeSource => ({
  filename: "20261118_change.sql",
  before,
  target,
  statements,
  dialect,
});

const posts = (field: object, extra: Record<string, unknown> = {}) =>
  declared({ slug: "posts", fields: [field], ...extra });

describe("fileTypeChangesOf", () => {
  it("finds a field whose type the file changes, on the entity's table, naming the file", () => {
    const found = fileTypeChangesOf(
      source(
        record({ collections: { posts: posts(TEXT) } }),
        record({ collections: { posts: posts(SELECT) } })
      )
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: "collection",
      slug: "posts",
      input: {
        label: "Collection 'posts' (migration 20261118_change.sql)",
        table: "dc_posts",
        builtBy: "codeFirst",
        previous: [TEXT],
        next: [SELECT],
      },
    });
  });

  it("reads a Builder entity's columns as the Builder makes them", () => {
    const [found] = fileTypeChangesOf(
      source(
        record({
          collections: { posts: declared({ fields: [TEXT] }, "builder") },
        }),
        record({
          collections: { posts: declared({ fields: [SELECT] }, "builder") },
        })
      )
    );

    expect(found?.input.builtBy).toBe("collection");
  });

  it("pairs a field the file renames by its statement, and not without it", () => {
    const before = record({ collections: { posts: posts(TEXT) } });
    const target = record({
      collections: { posts: posts({ ...SELECT, name: "title" }) },
    });

    const renamed = fileTypeChangesOf(
      source(before, target, [
        'ALTER TABLE "dc_posts" RENAME COLUMN "heading" TO "title"',
      ])
    );
    const unrenamed = fileTypeChangesOf(source(before, target));

    expect(renamed).toHaveLength(1);
    expect(renamed[0]?.input.renamed).toEqual(new Map([["heading", "title"]]));
    // A drop and an add: no type change to judge.
    expect(unrenamed).toEqual([]);
  });

  it("reads a rename on MySQL as MySQL writes it", () => {
    const found = fileTypeChangesOf(
      source(
        record({ collections: { posts: posts(TEXT) } }),
        record({ collections: { posts: posts({ ...SELECT, name: "title" }) } }),
        ["ALTER TABLE `dc_posts` RENAME COLUMN `heading` TO `title`"],
        "mysql"
      )
    );

    expect(found[0]?.input.renamed).toEqual(new Map([["heading", "title"]]));
  });

  it("reads the run `migrate:create` writes on MySQL to rename a column a check may use", () => {
    // The statements a file holds for the rename on MySQL: a prepared run, not a plain rename.
    const run =
      mysqlLiveStatements({
        type: "rename_column",
        tableName: "dc_posts",
        fromColumn: "heading",
        toColumn: "title",
        fromType: "varchar(255)",
        toType: "varchar(255)",
      }) ?? [];
    expect(run.join("\n")).toMatch(/^SET @nextly_ddl/);

    const found = fileTypeChangesOf(
      source(
        record({ collections: { posts: posts(TEXT) } }),
        record({ collections: { posts: posts({ ...SELECT, name: "title" }) } }),
        run,
        "mysql"
      )
    );

    expect(found[0]?.input.renamed).toEqual(new Map([["heading", "title"]]));
  });

  it("leaves out a rename on another table", () => {
    const found = fileTypeChangesOf(
      source(
        record({ collections: { posts: posts(TEXT) } }),
        record({ collections: { posts: posts({ ...SELECT, name: "title" }) } }),
        ['ALTER TABLE "dc_pages" RENAME COLUMN "heading" TO "title"']
      )
    );

    expect(found).toEqual([]);
  });

  it("judges nothing where a snapshot records no entities, or an entity has no recorded fields", () => {
    const changed = record({ collections: { posts: posts(SELECT) } });

    expect(fileTypeChangesOf(source(undefined, changed))).toEqual([]);
    expect(
      fileTypeChangesOf(
        source(record({ collections: { posts: posts(TEXT) } }), undefined)
      )
    ).toEqual([]);
    expect(
      fileTypeChangesOf(
        source(
          record({ collections: { posts: declared({ slug: "posts" }) } }),
          changed
        )
      )
    ).toEqual([]);
  });

  it("judges nothing for an entity the file adds or removes, or one whose types it keeps", () => {
    expect(
      fileTypeChangesOf(
        source(record(), record({ collections: { posts: posts(SELECT) } }))
      )
    ).toEqual([]);
    expect(
      fileTypeChangesOf(
        source(record({ collections: { posts: posts(TEXT) } }), record())
      )
    ).toEqual([]);
    expect(
      fileTypeChangesOf(
        source(
          record({ collections: { posts: posts(TEXT) } }),
          record({
            collections: { posts: posts({ ...TEXT, label: "Heading" }) },
          })
        )
      )
    ).toEqual([]);
  });

  it("names a Single's and a field group's tables, and a collection's own table name", () => {
    const found = fileTypeChangesOf(
      source(
        record({
          collections: { posts: posts(TEXT, { dbName: "articles" }) },
          singles: { home: declared({ fields: [TEXT] }) },
          fieldGroups: { meta: declared({ fields: [TEXT] }) },
        }),
        record({
          collections: { posts: posts(SELECT, { dbName: "articles" }) },
          singles: { home: declared({ fields: [SELECT] }) },
          fieldGroups: { meta: declared({ fields: [SELECT] }) },
        })
      )
    );

    expect(
      found.map(({ kind, input }) => [kind, input.table, input.label])
    ).toEqual([
      [
        "collection",
        "dc_articles",
        "Collection 'posts' (migration 20261118_change.sql)",
      ],
      [
        "single",
        "single_home",
        "Single 'home' (migration 20261118_change.sql)",
      ],
      [
        "fieldGroup",
        "comp_meta",
        "Field group 'meta' (migration 20261118_change.sql)",
      ],
    ]);
  });

  it("reads a field translated before the file from the entity's companion", () => {
    const [found] = fileTypeChangesOf(
      source(
        record({
          collections: {
            posts: posts({ ...TEXT, localized: true }, { localized: true }),
          },
        }),
        record({
          collections: {
            posts: posts({ ...SELECT, localized: true }, { localized: true }),
          },
        })
      )
    );

    expect(found?.input.translationsTable).toBe("dc_posts_locales");
    expect(found?.input.translatedBefore).toEqual(new Set(["heading"]));
  });
});
