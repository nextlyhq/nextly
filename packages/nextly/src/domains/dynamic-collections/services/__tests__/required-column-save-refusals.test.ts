/**
 * A collection or Single save that makes columns required over rows that would break them is
 * refused naming the entity, every such field and its count, before a statement is written.
 *
 * Driven through `refusalsForCollectionSave`, the precondition both saves ask before their ALTER,
 * against a real SQLite database, so the counts are the database's own. A field already required,
 * a column holding no null, a column the table does not have yet and an empty table are the
 * controls.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import type { RequiredColumnEntity } from "../../../schema/required-column-refusal";
import { DynamicCollectionSchemaService } from "../dynamic-collection-schema-service";
import { refusalsForCollectionSave } from "../save-preconditions";

const text = (name: string, required: boolean): FieldDefinition =>
  ({ name, type: "text", required }) as unknown as FieldDefinition;

const relationship = (name: string, required = true): FieldDefinition =>
  ({
    name,
    type: "relationship",
    required,
    options: { target: "authors", relationType: "manyToOne" },
  }) as unknown as FieldDefinition;

let sqlite: Database.Database;
const schema = new DynamicCollectionSchemaService(undefined, "sqlite");

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(
    `CREATE TABLE dc_posts (id TEXT, summary TEXT, sub_title TEXT, body TEXT)`
  );
  sqlite.exec(
    `INSERT INTO dc_posts VALUES ('1', NULL, NULL, 'b'), ('2', NULL, 's', NULL), ('3', 'x', 's', NULL)`
  );
  sqlite.exec(`CREATE TABLE single_home (id TEXT, tagline TEXT)`);
  sqlite.exec(`INSERT INTO single_home VALUES ('1', NULL)`);
  sqlite.exec(`CREATE TABLE dc_empty (id TEXT, summary TEXT)`);
});
afterEach(() => sqlite.close());

/** The save's refusals, as `refusalsForCollectionSave` returns them to the caller. */
async function refusals(args: {
  entity: RequiredColumnEntity;
  tableName: string;
  oldFields: FieldDefinition[];
  newFields: FieldDefinition[];
  /** The value an added column gives existing rows; the generator's own unless a test says. */
  backfill?: (field: FieldDefinition) => string | null;
}) {
  const columns = sqlite
    .prepare(`SELECT name FROM pragma_table_info('${args.tableName}')`)
    .all() as { name: string }[];
  const found = await refusalsForCollectionSave({
    adapter: {
      executeQuery: <T>(q: string) =>
        Promise.resolve(sqlite.prepare(q).all() as T[]),
    },
    dialect: "sqlite",
    tableName: args.tableName,
    oldFields: args.oldFields,
    newFields: args.newFields,
    rename: schema.detectFieldRename(args.oldFields, args.newFields),
    addedColumnBackfill:
      args.backfill ?? (field => schema.addedColumnBackfill(field)),
    presentColumns: new Set(columns.map(c => c.name)),
    requiredColumns: { db: drizzle({ client: sqlite }), entity: args.entity },
  });
  return found.map(r => r.error);
}

const posts: RequiredColumnEntity = { kind: "collection", slug: "posts" };

describe("a schema save making columns required over rows holding no value", () => {
  it("names the collection, every field and its count", async () => {
    expect(
      await refusals({
        entity: posts,
        tableName: "dc_posts",
        oldFields: [text("summary", false), text("subTitle", false)],
        newFields: [text("summary", true), text("subTitle", true)],
      })
    ).toEqual([
      {
        path: "fields.summary",
        code: "REQUIRED_COLUMN_HAS_NULLS",
        message:
          "Collection 'posts': field 'summary' cannot become required while 2 rows hold no value in it. Give those rows a value first, or keep the field optional.",
      },
      {
        path: "fields.subTitle",
        code: "REQUIRED_COLUMN_HAS_NULLS",
        message:
          "Collection 'posts': field 'subTitle' cannot become required while 1 row holds no value in it. Give that row a value first, or keep the field optional.",
      },
    ]);
  });

  it("names a Single, and a required field added with no value to give its rows, with the count", async () => {
    expect(
      await refusals({
        entity: { kind: "single", slug: "home" },
        tableName: "single_home",
        oldFields: [text("tagline", false)],
        newFields: [text("tagline", true), text("headline", true)],
        // A column the ALTER generator gives existing rows no value in, as a contributed field
        // type's or a relationship's can be.
        backfill: field =>
          field.name === "headline" ? null : schema.addedColumnBackfill(field),
      })
    ).toEqual([
      {
        path: "fields.tagline",
        code: "REQUIRED_COLUMN_HAS_NULLS",
        message:
          "Single 'home': field 'tagline' cannot become required while 1 row holds no value in it. Give that row a value first, or keep the field optional.",
      },
      {
        path: "fields.headline",
        code: "REQUIRED_COLUMN_HAS_NULLS",
        message:
          "Single 'home': field 'headline' cannot be added as required without a default while 1 row exists, which would hold no value in it. Give it a default, or add it as optional.",
      },
    ]);
  });

  // A required relationship's column is NOT NULL like any other required field's
  // (`getColumnDescriptor`), so making one required, or adding one as required, over rows holding
  // no value is refused the same way rather than left to the database.
  it("refuses a relationship made required, or added as required, over rows holding none", async () => {
    sqlite.exec(`ALTER TABLE dc_posts ADD COLUMN editor TEXT`);
    expect(
      await refusals({
        entity: posts,
        tableName: "dc_posts",
        oldFields: [relationship("editor", false)],
        newFields: [relationship("editor"), relationship("author")],
      })
    ).toEqual([
      {
        path: "fields.editor",
        code: "REQUIRED_COLUMN_HAS_NULLS",
        message:
          "Collection 'posts': field 'editor' cannot become required while 3 rows hold no value in it. Give those rows a value first, or keep the field optional.",
      },
      {
        path: "fields.author",
        code: "REQUIRED_COLUMN_HAS_NULLS",
        message:
          "Collection 'posts': field 'author' cannot be added as required without a default while 3 rows exist, which would hold no value in it. Give it a default, or add it as optional.",
      },
    ]);
  });

  it("counts a renamed field under the column the table still has", async () => {
    expect(
      await refusals({
        entity: posts,
        tableName: "dc_posts",
        oldFields: [text("summary", false)],
        newFields: [text("abstract", true)],
      })
    ).toEqual([
      {
        path: "fields.abstract",
        code: "REQUIRED_COLUMN_HAS_NULLS",
        message:
          "Collection 'posts': field 'abstract' cannot become required while 2 rows hold no value in it. Give those rows a value first, or keep the field optional.",
      },
    ]);
  });

  // A count that fails cannot say the save is safe, so the save is refused before anything runs,
  // naming the table and the field, rather than left to the database.
  it("refuses, naming the table and the field, when the rows cannot be counted", async () => {
    const save = refusalsForCollectionSave({
      adapter: {
        executeQuery: <T>(q: string) =>
          Promise.resolve(sqlite.prepare(q).all() as T[]),
      },
      dialect: "sqlite",
      tableName: "dc_gone",
      oldFields: [text("summary", false)],
      newFields: [text("summary", true)],
      rename: schema.detectFieldRename(
        [text("summary", false)],
        [text("summary", true)]
      ),
      addedColumnBackfill: field => schema.addedColumnBackfill(field),
      presentColumns: new Set(["summary"]),
      requiredColumns: { db: drizzle({ client: sqlite }), entity: posts },
    });
    await expect(save).rejects.toMatchObject({
      publicData: {
        errors: [
          {
            path: "fields.summary",
            code: "REQUIRED_COLUMN_UNCOUNTED",
            message:
              "Table 'dc_gone': the rows that would break making 'summary' required could not be counted, so that change was refused before it ran. Check that the database can be reached and the table read, then try again.",
          },
        ],
      },
    });
  });

  it("refuses nothing when no row is in the way", async () => {
    // The controls: a column holding no null (`sub_title` after the first row is filled), a field
    // already required (`body`), a column the table does not have yet (`ghost`, left to the ALTER
    // generator), a field whose type gives the rows a value (a checkbox), and an empty table.
    sqlite.exec(`UPDATE dc_posts SET sub_title = 's'`);
    expect(
      await refusals({
        entity: posts,
        tableName: "dc_posts",
        oldFields: [
          text("subTitle", false),
          text("body", true),
          text("ghost", false),
        ],
        newFields: [
          text("subTitle", true),
          text("body", true),
          text("ghost", true),
          {
            name: "done",
            type: "checkbox",
            required: true,
          } as unknown as FieldDefinition,
        ],
      })
    ).toEqual([]);
    expect(
      await refusals({
        entity: posts,
        tableName: "dc_empty",
        oldFields: [text("summary", false)],
        newFields: [text("summary", true), relationship("author")],
      })
    ).toEqual([]);
  });
});
