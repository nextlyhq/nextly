/**
 * A field change that keeps its entity but removes one of its columns or tables never takes with it
 * an element another owner built there. Removing a field, moving it into a group, turning
 * translation on, or removing a many-to-many's join table is refused before anything runs where a
 * plugin's index is built on the column, or its column is on the table, naming the field, the
 * plugin, the element, its kind and its table; the table, the element, the definition, the registry
 * and the migrations folder are left as they were. An element elsewhere on a table the change keeps
 * does not stop it, and keeps its values. A plugin's foreign key pointing at the removed column, or
 * at the removed join table, refuses it the same way, naming the key, and so does a key no record
 * names that points at a removed column, wherever it is: on a table in another schema or database,
 * or on columns the change removes too. A plugin's key on its own column, like its column, is not
 * taken for drift on any dialect. A record of other owners' elements that cannot be read refuses the
 * change, never counting them as none.
 *
 * The Schema Builder makes the collection and the field group; the plugin's elements are then made by
 * their DDL and recorded in the owner rows, as a development push writes them. The rows are the test's:
 * a schema hook cannot add to an entity the Builder made, and no migration run writes element rows for
 * an entity's table. Then the Builder's save. On SQLite, PostgreSQL and MySQL, because what
 * a drop takes with it differs between them: PostgreSQL drops an index on a dropped column
 * silently, MySQL narrows or drops it, SQLite refuses part-way.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import { createAdapter } from "../../../../database/factory";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { NextlyError } from "../../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { _resetEnvCache } from "../../../../shared/lib/env";
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";
import {
  readForeignKeyColumns,
  readIndexNames,
} from "../../pipeline/live-table-facts";
import { junctionTableNameFor } from "../../services/field-column-descriptor";
import { fieldGroupTableNameFor } from "../../../field-groups/services/field-group-storage-names";
import { ownerRowsToRecord } from "../kept-elements";
import { SchemaOwnersRepository } from "../schema-owners-repository";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

const POSTS = "fco_posts";
const POSTS_TABLE = `dc_${POSTS}`;
const TAGS = "fco_tags";
const CARDS = "fco_cards";
const CARDS_TABLE = fieldGroupTableNameFor("current", CARDS);

const PLUGIN = "@t/fco-indexer";
const MARKER = "marker";

type Field = Record<string, unknown>;

const TAGS_FIELD: Field = {
  name: "tags",
  type: "relationship",
  options: { target: TAGS, relationType: "manyToMany" },
};
const LINKS_TABLE = junctionTableNameFor(POSTS_TABLE, TAGS_FIELD as never);

/** POSTS as the Builder makes it: `code`, which the plugin indexes; `note`, which nothing builds on. */
const POSTS_FIELDS: Field[] = [
  { name: "code", type: "text" },
  { name: "note", type: "text" },
  { name: "meta", type: "group", fields: [{ name: "summary", type: "text" }] },
  TAGS_FIELD,
];
/** A field the plugin's foreign key can point at: unique, and a number, which MySQL can key. */
const SERIAL_FIELD: Field = { name: "serial", type: "number", unique: true };
/** A number field a key can stand on, pointing at SERIAL_FIELD. */
const PARENT_FIELD: Field = { name: "parent_serial", type: "number" };
const CARDS_FIELDS: Field[] = [
  { name: "code", type: "text" },
  { name: "note", type: "text" },
];

/** An element of the plugin's on another owner's table. */
interface Built {
  table: string;
  kind: "index" | "column";
  /** The index's name, or the column's. */
  name: string;
  /** An index's columns. */
  columns?: string[];
  /**
   * The leading characters an index keys a text column by on MySQL, which indexes a TEXT column
   * only by a prefix: a plugin indexing a Builder text field there writes one.
   */
  prefix?: number;
}

let instance: TestNextly | undefined;
let basePath: string;
let dropDatabase: (() => Promise<void>) | undefined;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-others-elements-"));
  // The schema dialog applies its change, and writes its migration, in development only.
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  try {
    await instance?.destroy();
    await dropDatabase?.();
  } finally {
    instance = undefined;
    dropDatabase = undefined;
    vi.unstubAllEnvs();
    _resetEnvCache();
    await rm(basePath, { recursive: true, force: true });
  }
});

/** A database of the test's own: a SQLite file in its folder, or a scratch database. */
async function databaseFor(dialect: TestDialect): Promise<string> {
  if (dialect === "sqlite") return `file:${join(basePath, "app.db")}`;
  const scratch = await createScratchDatabase(dialect, "fco");
  dropDatabase = scratch.drop;
  return scratch.url;
}

async function start(dialect: TestDialect, url: string): Promise<TestNextly> {
  // The app's own dialect and database, which the Builder's files are written for.
  vi.stubEnv("DB_DIALECT", dialect);
  vi.stubEnv("DATABASE_URL", url);
  _resetEnvCache();
  const adapter = await createAdapter({ type: dialect, url } as Parameters<
    typeof createAdapter
  >[0]);
  instance = await createTestNextly({
    adapter: adapter as never,
    basePath,
    db: DB,
    localization: LOCALIZATION,
  });
  return instance;
}

/** TAGS, POSTS and CARDS, made by the Builder as a person makes them. */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  const t = await start(dialect, await databaseFor(dialect));
  for (const [name, fields] of [
    [TAGS, [{ name: "name", type: "text" }]],
    [POSTS, POSTS_FIELDS],
  ] as const) {
    await dispatchCollections(
      {} as ServiceContainer,
      "createCollection",
      {},
      { name, label: name, fields }
    );
  }
  await dispatchComponents(
    "createComponent",
    {},
    { slug: CARDS, label: "Card", fields: CARDS_FIELDS }
  );
  clearRegistryRowCache();
  return t;
}

/**
 * Every file in the migrations folder, by its path there and its contents: a save that writes,
 * replaces or removes one changes this. A folder not made yet holds none; any other failure to
 * read it is thrown, never taken for an empty folder.
 */
async function filesWritten(): Promise<Array<[string, string]>> {
  const folder = join(basePath, "migrations");
  const names = await readdir(folder, { recursive: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [] as string[];
      throw error;
    }
  );
  const files: Array<[string, string]> = [];
  for (const name of [...names].sort()) {
    const content = await readFile(join(folder, name), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        // A folder within it, such as the snapshots' `meta`, is listed too.
        if (error.code === "EISDIR") return undefined;
        throw error;
      }
    );
    if (content !== undefined) files.push([name, content]);
  }
  return files;
}

async function stored(t: TestNextly): Promise<Field[]> {
  const row = await t
    .getService("collectionRegistryService")
    .getCollectionBySlug(POSTS);
  // The stored fields, read as plain records the save takes back as they are.
  return (row?.fields ?? []).map(field => ({ ...field }) as Field);
}

async function schemaVersionOf(
  t: TestNextly,
  registry: "dynamic_collections" | "dynamic_field_groups",
  slug: string
): Promise<number> {
  const [row] = await t.adapter.executeQuery<{ v: number | string | null }>(
    `SELECT schema_version AS v FROM ${registry} WHERE slug = '${slug}'`
  );
  return Number(row?.v ?? 1);
}

/** The schema dialog's save of POSTS; what it refused with, or undefined. */
async function savePosts(
  t: TestNextly,
  fields: Field[],
  extra: Record<string, unknown> = {}
): Promise<unknown> {
  return dispatchCollections(
    {} as ServiceContainer,
    "applySchemaChanges",
    { collectionName: POSTS },
    {
      fields,
      confirmed: true,
      schemaVersion: await schemaVersionOf(t, "dynamic_collections", POSTS),
      ...extra,
    }
  ).then(
    () => undefined,
    (error: unknown) => error
  );
}

/** The field group's schema dialog save of CARDS; what it refused with, or undefined. */
async function saveCards(
  t: TestNextly,
  fields: Field[],
  extra: Record<string, unknown> = {}
): Promise<unknown> {
  return dispatchComponents(
    "applyComponentSchemaChanges",
    { slug: CARDS },
    {
      fields,
      confirmed: true,
      schemaVersion: await schemaVersionOf(t, "dynamic_field_groups", CARDS),
      ...extra,
    }
  ).then(
    () => undefined,
    (error: unknown) => error
  );
}

/** A refusal naming the field, the plugin, the element's kind and its table. */
function expectNamesTheElement(
  refused: unknown,
  parts: { field: string; kind: string; table: string }
): void {
  expect(NextlyError.is(refused), String(refused)).toBe(true);
  const message = (refused as NextlyError).publicMessage;
  for (const part of [parts.field, PLUGIN, parts.kind, parts.table]) {
    expect(message).toContain(part);
  }
  expect(message).toContain("Its owner removes it first");
}

const without = (fields: Field[], name: string): Field[] =>
  fields.filter(field => field.name !== name);

/** The dialog's confirmation that the person drops `name`'s values with it. */
const dropping = (name: string) => ({
  resolutions: { [name]: { action: "confirm_drop" } },
});

describe.each(getConfiguredTestDialects())(
  "a field change keeps what another owner built on the entity's tables (%s)",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    const columnsOf = async (t: TestNextly, table: string) =>
      (
        await t.adapter.executeQuery<{ name: string }>(
          dialect === "mysql"
            ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
            : dialect === "sqlite"
              ? `SELECT name FROM pragma_table_info('${table}')`
              : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
        )
      )
        .map(row => row.name)
        .sort();

    const indexesOf = async (t: TestNextly, table: string) =>
      [
        ...(await readIndexNames(t.adapter.getDrizzle(), dialect, table)),
      ].sort();

    /** Records each element as the plugin's, in the rows a development push writes for an entity's table. */
    async function record(
      t: TestNextly,
      elements: readonly {
        table: string;
        kind: "index" | "column" | "fk";
        name: string;
      }[]
    ): Promise<void> {
      await new SchemaOwnersRepository(
        (t.adapter as unknown as DrizzleAdapter).getDrizzle(),
        dialect
      ).upsert(
        ownerRowsToRecord(
          elements.map(element => ({
            table: element.table,
            elementKind: element.kind,
            elementName: element.name,
            owner: { kind: "plugin", id: PLUGIN },
          })),
          new Set(),
          []
        )
      );
    }

    /** Makes each element by its DDL, and records it as the plugin's (`record`). */
    async function build(t: TestNextly, ...elements: Built[]): Promise<void> {
      for (const element of elements) {
        await t.adapter.executeQuery(
          element.kind === "index"
            ? `CREATE INDEX ${q(element.name)} ON ${q(element.table)} (${(
                element.columns ?? []
              )
                .map(column =>
                  dialect === "mysql" && element.prefix !== undefined
                    ? `${q(column)}(${element.prefix})`
                    : q(column)
                )
                .join(", ")})`
            : `ALTER TABLE ${q(element.table)} ADD COLUMN ${q(element.name)} ${dialect === "mysql" ? "varchar(64)" : "text"}`
        );
      }
      await record(t, elements);
    }

    /**
     * The plugin's own column on POSTS, with a foreign key on it pointing at
     * `references`, and records both. MySQL takes the key as a constraint of its own; SQLite adds
     * one only with its column.
     */
    async function buildKey(
      t: TestNextly,
      key: {
        name: string;
        column: string;
        type: string;
        references: { table: string; column: string };
      }
    ): Promise<void> {
      const add = `ALTER TABLE ${q(POSTS_TABLE)} ADD COLUMN ${q(key.column)} ${key.type}`;
      const target = `${q(key.references.table)} (${q(key.references.column)})`;
      await t.adapter.executeQuery(
        dialect === "mysql"
          ? `${add}, ADD CONSTRAINT ${q(key.name)} FOREIGN KEY (${q(key.column)}) REFERENCES ${target}`
          : `${add} CONSTRAINT ${q(key.name)} REFERENCES ${target}`
      );
      await record(t, [
        { table: POSTS_TABLE, kind: "column", name: key.column },
        { table: POSTS_TABLE, kind: "fk", name: key.name },
      ]);
    }

    /** The columns of `table` that carry a foreign key. */
    const keyedColumnsOf = async (t: TestNextly, table: string) =>
      [
        ...(
          await readForeignKeyColumns(t.adapter.getDrizzle(), dialect, table)
        ).keys(),
      ].sort();

    const codeIndex = (table: string): Built => ({
      table,
      kind: "index",
      name: `fco_idx_${table}_code`,
      columns: ["code"],
      prefix: 64,
    });
    const marker = (table: string): Built[] => [
      { table, kind: "column", name: MARKER },
      {
        table,
        kind: "index",
        name: `fco_idx_${table}_marker`,
        columns: [MARKER],
      },
    ];

    /** The Builder's definition file, byte for byte; one that is not there is thrown. */
    const definitionFile = async () =>
      (await readFile(join(basePath, "ui-schema.json"))).toString("base64");

    /** What a refusal must leave as it was. */
    async function stateOf(t: TestNextly, table: string) {
      return {
        definition: await definitionFile(),
        columns: await columnsOf(t, table),
        indexes: await indexesOf(t, table),
        fields: JSON.stringify(await stored(t)),
        files: await filesWritten(),
      };
    }

    it("refuses removing a field whose column a plugin's index is built on, changing nothing", async () => {
      const t = await boot(dialect);
      await build(t, codeIndex(POSTS_TABLE));
      const before = await stateOf(t, POSTS_TABLE);

      const refused = await savePosts(
        t,
        without(await stored(t), "code"),
        dropping("code")
      );

      expectNamesTheElement(refused, {
        field: "code",
        kind: "index",
        table: POSTS_TABLE,
      });
      expect(await stateOf(t, POSTS_TABLE)).toEqual(before);
    });

    it("refuses moving that field into a group, changing nothing", async () => {
      const t = await boot(dialect);
      await build(t, codeIndex(POSTS_TABLE));
      const fields = await stored(t);
      const before = await stateOf(t, POSTS_TABLE);
      const code = fields.find(field => field.name === "code");
      const moved = without(fields, "code").map(field =>
        field.name === "meta"
          ? { ...field, fields: [...((field.fields as Field[]) ?? []), code] }
          : field
      );

      const refused = await savePosts(t, moved, {
        hints: { moves: [{ from: ["code"], to: ["meta", "code"] }] },
      });

      expectNamesTheElement(refused, {
        field: "code",
        kind: "index",
        table: POSTS_TABLE,
      });
      expect(await stateOf(t, POSTS_TABLE)).toEqual(before);
    });

    it("refuses turning translation on where it moves that field's column, changing nothing", async () => {
      const t = await boot(dialect);
      await build(t, codeIndex(POSTS_TABLE));
      const before = await stateOf(t, POSTS_TABLE);

      const refused = await savePosts(t, await stored(t), { localized: true });

      expectNamesTheElement(refused, {
        field: "code",
        kind: "index",
        table: POSTS_TABLE,
      });
      expect(await stateOf(t, POSTS_TABLE)).toEqual(before);
    });

    it("refuses removing a field group's field whose column in its shared table a plugin's index is built on", async () => {
      const t = await boot(dialect);
      await build(t, codeIndex(CARDS_TABLE));
      const registryRow = () =>
        t.adapter.executeQuery(
          `SELECT fields, schema_version FROM dynamic_field_groups WHERE slug = '${CARDS}'`
        );
      const before = {
        columns: await columnsOf(t, CARDS_TABLE),
        indexes: await indexesOf(t, CARDS_TABLE),
        files: await filesWritten(),
        registry: await registryRow(),
        definition: await definitionFile(),
      };

      const refused = await saveCards(
        t,
        without(CARDS_FIELDS, "code"),
        dropping("code")
      );

      expectNamesTheElement(refused, {
        field: "code",
        kind: "index",
        table: CARDS_TABLE,
      });
      expect({
        columns: await columnsOf(t, CARDS_TABLE),
        indexes: await indexesOf(t, CARDS_TABLE),
        files: await filesWritten(),
        registry: await registryRow(),
        definition: await definitionFile(),
      }).toEqual(before);
    });

    it("refuses removing a many-to-many whose join table holds a plugin's column, changing nothing", async () => {
      const t = await boot(dialect);
      await build(t, { table: LINKS_TABLE, kind: "column", name: MARKER });
      const files = await filesWritten();

      const refused = await savePosts(
        t,
        without(await stored(t), "tags"),
        dropping("tags")
      );

      expectNamesTheElement(refused, {
        field: "tags",
        kind: "column",
        table: LINKS_TABLE,
      });
      expect(await columnsOf(t, LINKS_TABLE)).toContain(MARKER);
      expect(await filesWritten()).toEqual(files);
    });

    it("refuses removing a field whose column a plugin's foreign key points at, changing nothing", async () => {
      const t = await boot(dialect);
      // A unique number, which a key can point at on every dialect: MySQL keys no TEXT column.
      expect(
        await savePosts(t, [...(await stored(t)), SERIAL_FIELD])
      ).toBeUndefined();
      await buildKey(t, {
        name: "fco_fk_parent_serial",
        column: "parent_serial",
        type: dialect === "mysql" ? "int" : "integer",
        references: { table: POSTS_TABLE, column: "serial" },
      });
      const before = await stateOf(t, POSTS_TABLE);
      // The fixture's control: the plugin's key stands on its own column, not on `serial`.
      expect(await keyedColumnsOf(t, POSTS_TABLE)).toContain("parent_serial");
      expect(await keyedColumnsOf(t, POSTS_TABLE)).not.toContain("serial");

      const refused = await savePosts(
        t,
        without(await stored(t), "serial"),
        dropping("serial")
      );

      expectNamesTheElement(refused, {
        field: "serial",
        kind: "fk",
        table: POSTS_TABLE,
      });
      expect(await stateOf(t, POSTS_TABLE)).toEqual(before);
      expect(await keyedColumnsOf(t, POSTS_TABLE)).toContain("parent_serial");
    });

    it("refuses removing a many-to-many whose join table a plugin's foreign key points at, changing nothing", async () => {
      const t = await boot(dialect);
      await buildKey(t, {
        name: "fco_fk_link",
        column: "link_ref",
        // The join table's id, as the Builder makes it.
        type: dialect === "mysql" ? "varchar(36)" : "text",
        references: { table: LINKS_TABLE, column: "id" },
      });
      const before = await stateOf(t, POSTS_TABLE);
      const links = await columnsOf(t, LINKS_TABLE);

      const refused = await savePosts(
        t,
        without(await stored(t), "tags"),
        dropping("tags")
      );

      expectNamesTheElement(refused, {
        field: "tags",
        kind: "fk",
        table: POSTS_TABLE,
      });
      expect((refused as NextlyError).publicMessage).toContain(LINKS_TABLE);
      expect(await columnsOf(t, LINKS_TABLE)).toEqual(links);
      expect(await stateOf(t, POSTS_TABLE)).toEqual(before);
      expect(await keyedColumnsOf(t, POSTS_TABLE)).toContain("link_ref");
    });

    it("refuses removing a many-to-many whose join table a key on a removed plugin's own table points at, where only the table is recorded, changing nothing", async () => {
      const t = await boot(dialect);
      const notes = "fco_removed_notes";
      const id = dialect === "mysql" ? "varchar(36)" : "text";
      // The plugin is in no configuration: its table stays, recorded as the plugin's, with the key
      // its migration gave it and no row of its own for the key.
      await t.adapter.executeQuery(
        `CREATE TABLE ${q(notes)} (${q("id")} ${id} PRIMARY KEY, ${q("link_ref")} ${id}, CONSTRAINT ${q("fco_fk_removed")} FOREIGN KEY (${q("link_ref")}) REFERENCES ${q(LINKS_TABLE)} (${q("id")}))`
      );
      await new SchemaOwnersRepository(
        (t.adapter as unknown as DrizzleAdapter).getDrizzle(),
        dialect
      ).upsert([
        {
          tableName: notes,
          elementKind: "table",
          elementName: "",
          ownerKind: "plugin",
          ownerId: "@t/fco-removed",
          migratedBy: "plugin:@t/fco-removed",
          ownerVersion: "1.0.0",
          schemaVersion: 1,
          state: "orphaned",
        },
      ]);
      const before = await stateOf(t, POSTS_TABLE);
      const links = await columnsOf(t, LINKS_TABLE);

      const refused = await savePosts(
        t,
        without(await stored(t), "tags"),
        dropping("tags")
      );

      expect(NextlyError.is(refused), String(refused)).toBe(true);
      const message = (refused as NextlyError).publicMessage;
      for (const part of ["tags", "@t/fco-removed", "fk", notes, LINKS_TABLE]) {
        expect(message).toContain(part);
      }
      expect(await columnsOf(t, LINKS_TABLE)).toEqual(links);
      expect(await stateOf(t, POSTS_TABLE)).toEqual(before);
      expect(await keyedColumnsOf(t, notes)).toContain("link_ref");
    });

    it("applies a save that removes another field where a plugin's foreign key stands on its own column, keeping the key", async () => {
      const t = await boot(dialect);
      await buildKey(t, {
        name: "fco_fk_link",
        column: "link_ref",
        type: dialect === "mysql" ? "varchar(36)" : "text",
        references: { table: LINKS_TABLE, column: "id" },
      });

      expect(
        await savePosts(t, without(await stored(t), "note"), dropping("note"))
      ).toBeUndefined();

      expect(await columnsOf(t, POSTS_TABLE)).not.toContain("note");
      expect(await columnsOf(t, POSTS_TABLE)).toContain("link_ref");
      expect(await keyedColumnsOf(t, POSTS_TABLE)).toContain("link_ref");
    });

    // SQLite cannot add a key to a column a table already has, so such a key is made only with the
    // column, never between two fields the Builder made; nor has it schemas or other databases.
    it.skipIf(dialect === "sqlite")(
      "refuses removing two fields a key no record names joins, changing nothing",
      async () => {
        const t = await boot(dialect);
        expect(
          await savePosts(t, [...(await stored(t)), SERIAL_FIELD, PARENT_FIELD])
        ).toBeUndefined();
        await t.adapter.executeQuery(
          `ALTER TABLE ${q(POSTS_TABLE)} ADD CONSTRAINT ${q("fco_fk_self")} FOREIGN KEY (${q("parent_serial")}) REFERENCES ${q(POSTS_TABLE)} (${q("serial")})`
        );
        const before = await stateOf(t, POSTS_TABLE);

        const refused = await savePosts(
          t,
          without(without(await stored(t), "serial"), "parent_serial"),
          {
            resolutions: {
              serial: { action: "confirm_drop" },
              parent_serial: { action: "confirm_drop" },
            },
          }
        );

        expect(NextlyError.is(refused), String(refused)).toBe(true);
        const message = (refused as NextlyError).publicMessage;
        for (const part of ["serial", "fk", "fco_fk_self", POSTS_TABLE]) {
          expect(message).toContain(part);
        }
        expect(await stateOf(t, POSTS_TABLE)).toEqual(before);
      }
    );

    it.skipIf(dialect === "sqlite")(
      "refuses removing a field a key on a table in another schema or database points at, changing nothing",
      async () => {
        const t = await boot(dialect);
        expect(
          await savePosts(t, [...(await stored(t)), SERIAL_FIELD])
        ).toBeUndefined();
        // PostgreSQL: a schema the search path does not reach. MySQL: another database.
        const elsewhere =
          dialect === "postgresql"
            ? { name: "fco_elsewhere", drop: async () => {} }
            : await createScratchDatabase("mysql", "fcx").then(scratch => ({
                name: new URL(scratch.url).pathname.slice(1),
                drop: scratch.drop,
              }));
        try {
          if (dialect === "postgresql") {
            await t.adapter.executeQuery(`CREATE SCHEMA ${q(elsewhere.name)}`);
          }
          const [here] = await t.adapter.executeQuery<{ db: string }>(
            dialect === "mysql"
              ? "SELECT DATABASE() AS db"
              : "SELECT current_schema() AS db"
          );
          const refs = `${q(elsewhere.name)}.${q("fco_refs")}`;
          await t.adapter.executeQuery(
            `CREATE TABLE ${refs} (${q("id")} integer PRIMARY KEY, ${q("serial_ref")} ${dialect === "mysql" ? "int" : "integer"}, CONSTRAINT ${q("fco_fk_elsewhere")} FOREIGN KEY (${q("serial_ref")}) REFERENCES ${q(here?.db ?? "")}.${q(POSTS_TABLE)} (${q("serial")}))`
          );
          const before = await stateOf(t, POSTS_TABLE);

          const refused = await savePosts(
            t,
            without(await stored(t), "serial"),
            dropping("serial")
          );

          expect(NextlyError.is(refused), String(refused)).toBe(true);
          const message = (refused as NextlyError).publicMessage;
          for (const part of [
            "serial",
            "fk",
            "fco_fk_elsewhere",
            `${elsewhere.name}.fco_refs`,
          ]) {
            expect(message).toContain(part);
          }
          expect(await stateOf(t, POSTS_TABLE)).toEqual(before);
        } finally {
          // The referencing table first: MySQL drops no table another database's key points at.
          // The second database is dropped even where that fails.
          try {
            await t.adapter.executeQuery(
              `DROP TABLE IF EXISTS ${q(elsewhere.name)}.${q("fco_refs")}`
            );
          } finally {
            await elsewhere.drop();
          }
        }
      }
    );

    // PostgreSQL names a table whose name needs quotes with them; the owner record keeps it bare.
    it.skipIf(dialect !== "postgresql")(
      "refuses removing a many-to-many whose join table a key on a plugin's mixed-case table points at",
      async () => {
        const t = await boot(dialect);
        const audit = "FcoAuditLog";
        await t.adapter.executeQuery(
          `CREATE TABLE ${q(audit)} (${q("id")} text PRIMARY KEY, ${q("link_ref")} text, CONSTRAINT ${q("fco_fk_audit")} FOREIGN KEY (${q("link_ref")}) REFERENCES ${q(LINKS_TABLE)} (${q("id")}))`
        );
        await record(t, [{ table: audit, kind: "fk", name: "fco_fk_audit" }]);
        const links = await columnsOf(t, LINKS_TABLE);

        const refused = await savePosts(
          t,
          without(await stored(t), "tags"),
          dropping("tags")
        );

        expectNamesTheElement(refused, {
          field: "tags",
          kind: "fk",
          table: audit,
        });
        expect(await columnsOf(t, LINKS_TABLE)).toEqual(links);
      }
    );

    // SQLite resolves a key's parent by name in any ASCII case, and keeps it as written.
    it.skipIf(dialect !== "sqlite")(
      "refuses removing a field a plugin's key points at when the key spells the table in another case",
      async () => {
        const t = await boot(dialect);
        expect(
          await savePosts(t, [...(await stored(t)), SERIAL_FIELD])
        ).toBeUndefined();
        await buildKey(t, {
          name: "fco_fk_upper",
          column: "upper_serial",
          type: "integer",
          references: { table: POSTS_TABLE.toUpperCase(), column: "serial" },
        });
        const before = await stateOf(t, POSTS_TABLE);

        const refused = await savePosts(
          t,
          without(await stored(t), "serial"),
          dropping("serial")
        );

        expectNamesTheElement(refused, {
          field: "serial",
          kind: "fk",
          table: POSTS_TABLE,
        });
        expect(await stateOf(t, POSTS_TABLE)).toEqual(before);
      }
    );

    /**
     * The plugin's own column, with its index, on the collection's table and on the field group's
     * shared table, each holding a value, and one row of each entity for it to be in.
     */
    async function plantMarkers(t: TestNextly): Promise<void> {
      await build(t, ...marker(POSTS_TABLE), ...marker(CARDS_TABLE));
      await t.nextly.create({
        collection: POSTS,
        data: { code: "c", note: "n" },
      } as never);
      await t.adapter.executeQuery(
        `INSERT INTO ${q(CARDS_TABLE)} (${["id", "_parent_id", "_parent_table", "_parent_field", "code", "note"].map(q).join(", ")}) VALUES ('card-1', 'entry-1', '${POSTS_TABLE}', 'card', 'c', 'n')`
      );
      // Past the runtime model, which knows only the entities' own columns.
      for (const table of [POSTS_TABLE, CARDS_TABLE]) {
        await t.adapter.executeQuery(
          `UPDATE ${q(table)} SET ${q(MARKER)} = 'kept by the plugin'`
        );
      }
    }

    /** The plugin's index and its column's values on both tables, as the database has them. */
    async function markersOf(t: TestNextly) {
      const of = async (table: string) => ({
        table,
        indexes: (await indexesOf(t, table)).filter(name =>
          name.includes(MARKER)
        ),
        values: (
          await t.adapter.executeQuery<{ v: unknown }>(
            `SELECT ${q(MARKER)} AS v FROM ${q(table)}`
          )
        ).map(row => row.v),
      });
      return [await of(POSTS_TABLE), await of(CARDS_TABLE)];
    }

    const moved = (fields: Field[], name: string): Field[] =>
      without(fields, name).map(field =>
        field.name === "meta"
          ? {
              ...field,
              fields: [
                ...((field.fields as Field[]) ?? []),
                fields.find(each => each.name === name),
              ],
            }
          : field
      );

    // Nothing of the plugin's is built on a column any of these removes.
    it.each([
      {
        change: "removing a field of the collection",
        gone: { table: POSTS_TABLE, column: "note" },
        save: async (t: TestNextly) =>
          savePosts(t, without(await stored(t), "note"), dropping("note")),
      },
      {
        change: "moving a field of the collection into a group",
        gone: { table: POSTS_TABLE, column: "note" },
        save: async (t: TestNextly) =>
          savePosts(t, moved(await stored(t), "note"), {
            hints: { moves: [{ from: ["note"], to: ["meta", "note"] }] },
          }),
      },
      {
        change: "turning translation on for the collection",
        gone: { table: POSTS_TABLE, column: "note" },
        save: async (t: TestNextly) =>
          savePosts(t, await stored(t), { localized: true }),
      },
      {
        change: "removing a field of the field group",
        gone: { table: CARDS_TABLE, column: "note" },
        save: (t: TestNextly) =>
          saveCards(t, without(CARDS_FIELDS, "note"), dropping("note")),
      },
    ])(
      "applies $change where the plugin's column and index are elsewhere on the table, keeping them and their values",
      async ({ save, gone }) => {
        const t = await boot(dialect);
        await plantMarkers(t);
        const before = await markersOf(t);
        for (const each of before) {
          expect(each.indexes, each.table).toHaveLength(1);
          expect(each.values, each.table).toEqual(["kept by the plugin"]);
        }
        expect(await columnsOf(t, gone.table)).toContain(gone.column);

        expect(await save(t)).toBeUndefined();

        expect(await columnsOf(t, gone.table)).not.toContain(gone.column);
        expect(await markersOf(t)).toEqual(before);
      }
    );

    it("refuses a removal where the record of other owners' elements cannot be read, changing nothing", async () => {
      const t = await boot(dialect);
      await build(t, ...marker(POSTS_TABLE));
      const before = await stateOf(t, POSTS_TABLE);
      await t.adapter.executeQuery(`DROP TABLE nextly_schema_owners`);
      await t.adapter.executeQuery(
        `CREATE TABLE nextly_schema_owners (unrelated integer)`
      );

      const refused = await savePosts(
        t,
        without(await stored(t), "note"),
        dropping("note")
      );

      expect(NextlyError.is(refused), String(refused)).toBe(true);
      expect((refused as NextlyError).publicMessage).toContain(
        "could not be read"
      );
      expect(await stateOf(t, POSTS_TABLE)).toEqual(before);
    });
  }
);
