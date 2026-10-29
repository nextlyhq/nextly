/**
 * A Schema Builder collection keeps its foreign keys, and gets the key of a
 * relationship added to it.
 *
 * A Builder table is created by the Builder's own DDL, with each
 * relationship's key; every later save goes through the push pipeline, as the
 * Builder's save does (`source: "ui"`, the entity Builder-owned). That
 * pipeline described no key, so:
 *
 * - a relationship added to an existing Builder collection got no key, on
 *   any dialect;
 * - on SQLite, which holds a key only in `CREATE TABLE` and changes a column's
 *   type by rebuilding the table, a rebuild dropped the table's own key, and a
 *   rebuild of its parent was refused outright, because drizzle-kit, reading
 *   the whole database, saw the child's key as one to drop.
 *
 * The SQLite cases also check that no delete action fires during a rebuild:
 * the child cascades on delete, so a rebuild that dropped the parent with
 * foreign keys enforced would take the child's rows with it.
 *
 * Against real databases, the Builder's DDL generator and the real pipeline:
 * SQLite in memory with foreign keys enforced, and PostgreSQL and MySQL where
 * their URLs are set, each in tables of this file's own prefix.
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { createPool, type Pool as MysqlPool } from "mysql2";
import { Pool } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { getDialectTables } from "../../../../database/index";
import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db";
import { clearCachedSnapshot } from "../../../../init/schema-snapshot-cache";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { getColumnDescriptor } from "../../services/field-column-descriptor";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { introspectLiveSnapshot } from "../diff/introspect-live";
import { freshPushSchema } from "../fresh-push";
import { previewDesiredSchema } from "../preview";
import { PushSchemaPipeline } from "../pushschema-pipeline";
import {
  noopClassifier,
  noopMigrationJournal,
  noopNotifier,
  noopPreCleanupExecutor,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../pushschema-pipeline-stubs";
import { RegexRenameDetector } from "../rename-detector";
import type { DesiredSchema } from "../types";

/** Two Builder collections: authors, and posts that point at them. */
interface Pair {
  /** The authors' slug; the Builder keys a relationship to `dc_<slug>`. */
  authorsSlug: string;
  authors: string;
  posts: string;
}

const pairNamed = (stem: string): Pair => ({
  authorsSlug: `${stem}_authors`,
  authors: `dc_${stem}_authors`,
  posts: `dc_${stem}_posts`,
});

/**
 * A many-to-one to the authors, deleted with its author. Named in camelCase,
 * so its column (`lead_author`) is not spelled like the field: the runtime
 * table keys its columns by field name and the spec by column name.
 */
const authorField = (pair: Pair) => ({
  name: "leadAuthor",
  type: "relationship",
  options: {
    target: pair.authorsSlug,
    relationType: "manyToOne",
    onDelete: "cascade",
  },
});

const authorFields = (rank: "text" | "number") => [
  { name: "name", type: "text" },
  { name: "rank", type: rank },
];

/**
 * A relationship from one author to another, emptied when that author goes:
 * added to the authors, it changes the table the posts cascade from.
 */
const mentorField = (pair: Pair) => ({
  name: "mentor",
  type: "relationship",
  options: {
    target: pair.authorsSlug,
    relationType: "manyToOne",
    onDelete: "set null",
  },
});
/**
 * A one-to-one to the authors. The Builder's DDL makes its column UNIQUE,
 * inline, which no spec describes: introspection skips the index backing it.
 */
const profileField = (pair: Pair) => ({
  name: "profile",
  type: "relationship",
  options: {
    target: pair.authorsSlug,
    relationType: "oneToOne",
    onDelete: "set null",
  },
});

/** The posts' profile as some other relationship: many-to-one, or renamed. */
const profileAs = (
  pair: Pair,
  overrides: { name?: string; relationType?: string }
) => ({
  ...profileField(pair),
  ...(overrides.name !== undefined ? { name: overrides.name } : {}),
  options: {
    ...profileField(pair).options,
    ...(overrides.relationType !== undefined
      ? { relationType: overrides.relationType }
      : {}),
  },
});

const postFields = (
  pair: Pair,
  score: "text" | "number",
  withAuthor = true,
  withProfile = false
) => [
  { name: "title", type: "text" },
  { name: "score", type: score },
  ...(withAuthor ? [authorField(pair)] : []),
  ...(withProfile ? [profileField(pair)] : []),
];

interface Target {
  db: unknown;
  dialect: SupportedDialect;
  /** MySQL's pushSchema needs it. */
  databaseName?: string;
}

/** The Builder's own DDL for one table, one statement at a time. */
function builderStatements(
  dialect: SupportedDialect,
  table: string,
  fields: unknown[]
): string[] {
  return new DynamicCollectionSchemaService(undefined, dialect)
    .generateMigrationSQL(table, fields as never)
    .split("--> statement-breakpoint")
    .map(part =>
      part
        .split("\n")
        .filter(line => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(statement => statement.length > 0);
}

/** The desired schema a Schema Builder save of both collections applies. */
function desiredFor(
  pair: Pair,
  authors: unknown[],
  posts: unknown[]
): DesiredSchema {
  return {
    collections: {
      authors: {
        slug: pair.authorsSlug,
        tableName: pair.authors,
        fields: authors as never,
        builderOwned: true,
      },
      posts: {
        slug: `${pair.authorsSlug}_posts`,
        tableName: pair.posts,
        fields: posts as never,
        builderOwned: true,
      },
    },
    singles: {},
    components: {},
  };
}

/**
 * `desired` with the posts' fields as the registry records them before the save, as a Schema
 * Builder save states them.
 */
function recordingPosts(
  desired: DesiredSchema,
  recordedFields: readonly string[]
): DesiredSchema {
  return {
    ...desired,
    collections: {
      ...desired.collections,
      posts: { ...desired.collections.posts, recordedFields },
    },
  };
}

/**
 * The posts' author column, added the way an apply that stopped before the key leaves it: MySQL
 * commits each schema statement, so the column can land without the key that follows it.
 */
function authorColumnWithoutKey(dialect: SupportedDialect, pair: Pair): string {
  const column = getColumnDescriptor(
    authorField(pair) as never,
    dialect,
    "collection"
  );
  if (!column) throw new Error("the relationship has no column");
  const quote = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  return `ALTER TABLE ${quote(pair.posts)} ADD COLUMN ${quote(column.name)} ${column.dialectType}`;
}

/**
 * One Schema Builder save, as the Builder's save applies it. With
 * `confirmRenames`, a dropped column and an added one of the same type are
 * paired as a rename and the author confirms it, as the Builder's prompt does.
 */
function save(
  target: Target,
  desired: DesiredSchema,
  { confirmRenames = false }: { confirmRenames?: boolean } = {}
) {
  return new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor(target.dialect, target.db),
    renameDetector: confirmRenames
      ? new RegexRenameDetector()
      : noopRenameDetector,
    classifier: noopClassifier,
    promptDispatcher: confirmRenames
      ? {
          dispatch: ({ candidates }) =>
            Promise.resolve({
              confirmedRenames: [...candidates],
              resolutions: [],
              proceed: true,
            }),
        }
      : noopPromptDispatcher,
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: noopPreCleanupExecutor,
    migrationJournal: noopMigrationJournal,
    notifier: noopNotifier,
  }).apply({
    desired,
    db: target.db,
    dialect: target.dialect,
    source: "ui",
    promptChannel: "browser",
    ...(target.databaseName !== undefined
      ? { databaseName: target.databaseName }
      : {}),
  });
}

/** A table's keys, as the diff reads them. */
async function keysOf(target: Target, table: string) {
  const live = await introspectLiveSnapshot(target.db, target.dialect, [table]);
  return (live.tables[0]?.foreignKeys ?? []).map(fk => ({
    columns: fk.columns,
    referencesTable: fk.referencesTable,
    onDelete: fk.onDelete,
  }));
}

const postKeys = (target: Target, pair: Pair) => keysOf(target, pair.posts);

const keyTo = (pair: Pair) => ({
  columns: ["lead_author"],
  referencesTable: pair.authors,
  onDelete: "cascade",
});

/** The posts' column names as the database has them. */
const postColumns = async (target: Target, pair: Pair) =>
  (await introspectLiveSnapshot(target.db, target.dialect, [pair.posts])).tables
    .find(table => table.name === pair.posts)
    ?.columns.map(column => column.name) ?? [];

/** The posts' author relationship renamed to `writer`, the save answering the rename. */
const postsWithAuthorRenamed = (pair: Pair) =>
  recordingPosts(
    desiredFor(pair, authorFields("text"), [
      ...postFields(pair, "text", false),
      { ...authorField(pair), name: "writer" },
    ]),
    ["title", "score", "leadAuthor"]
  );

describe("a Schema Builder collection's foreign keys (sqlite)", () => {
  const pair = pairNamed("bfk");
  let sqlite: Database.Database;
  let target: Target;

  beforeEach(async () => {
    clearCachedSnapshot();
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzleSqlite({ client: sqlite });
    target = { db, dialect: "sqlite" };
    await freshPushSchema("sqlite", db, getDialectTables("sqlite"));
  });
  afterEach(() => {
    clearCachedSnapshot();
    sqlite.close();
  });

  function createTables(postsBornWithAuthor: boolean) {
    for (const statement of [
      ...builderStatements("sqlite", pair.authors, authorFields("text")),
      ...builderStatements(
        "sqlite",
        pair.posts,
        postFields(pair, "text", postsBornWithAuthor)
      ),
    ]) {
      sqlite.exec(statement);
    }
  }

  function seed() {
    sqlite
      .prepare(
        `INSERT INTO "${pair.authors}" (id, title, slug, name, rank) VALUES ('a1', 'A', 'a', 'Ada', '1')`
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO "${pair.posts}" (id, title, slug, score, lead_author) VALUES ('p1', 'P', 'p', '5', 'a1')`
      )
      .run();
  }

  const columnType = (table: string, column: string) =>
    (
      sqlite
        .prepare(`SELECT name, type FROM pragma_table_info(?)`)
        .all(table) as Array<{
        name: string;
        type: string;
      }>
    )
      .find(row => row.name === column)
      ?.type.toLowerCase();

  it("gets the key of a relationship added to it after it was created", async () => {
    createTables(false);
    sqlite
      .prepare(
        `INSERT INTO "${pair.posts}" (id, title, slug, score) VALUES ('p1', 'P', 'p', '5')`
      )
      .run();
    expect(await postKeys(target, pair)).toEqual([]);

    const result = await save(
      target,
      desiredFor(pair, authorFields("text"), postFields(pair, "text"))
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(await postKeys(target, pair)).toEqual([keyTo(pair)]);
    // The row the table held before is still there, with no author yet.
    expect(
      sqlite.prepare(`SELECT id, lead_author FROM "${pair.posts}"`).all()
    ).toEqual([{ id: "p1", lead_author: null }]);
  });

  // An earlier apply added the relationship's column and stopped before its key. Where the
  // registry still records the fields from before, the change adds the relationship and this apply
  // keys it; where it records the relationship, the column is one from before keys were created
  // this way, and is left without one rather than keyed unasked.
  it.each([
    { recorded: ["title", "score"], keyed: true },
    { recorded: ["title", "score", "leadAuthor"], keyed: false },
  ])(
    "keys a keyless relationship column only when the change adds it (recorded: $recorded)",
    async ({ recorded, keyed }) => {
      createTables(false);
      sqlite.exec(authorColumnWithoutKey("sqlite", pair));
      expect(await postKeys(target, pair)).toEqual([]);

      const result = await save(
        target,
        recordingPosts(
          desiredFor(pair, authorFields("text"), postFields(pair, "text")),
          recorded
        )
      );

      expect(result.error).toBeUndefined();
      expect(await postKeys(target, pair)).toEqual(keyed ? [keyTo(pair)] : []);
    }
  );

  // The keys are planned before the save's renames are answered, so the renamed relationship's
  // new column reads as added. Its old column had no key, and the rename adds none.
  it("keeps a renamed relationship without a key when its column had none", async () => {
    createTables(false);
    sqlite.exec(authorColumnWithoutKey("sqlite", pair));

    const result = await save(target, postsWithAuthorRenamed(pair), {
      confirmRenames: true,
    });

    expect(result.error).toBeUndefined();
    // The premise: the column was renamed, not dropped and re-added.
    expect(await postColumns(target, pair)).toContain("writer");
    expect(await postColumns(target, pair)).not.toContain("lead_author");
    expect(await postKeys(target, pair)).toEqual([]);
  });

  it("keeps a child's rows and key when a type change rebuilds the parent", async () => {
    createTables(true);
    seed();
    expect(await postKeys(target, pair)).toEqual([keyTo(pair)]);

    const result = await save(
      target,
      desiredFor(pair, authorFields("number"), postFields(pair, "text"))
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    // The rebuild ran: SQLite changes a column's type only by rebuilding.
    expect(columnType(pair.authors, "rank")).not.toBe("text");
    // No delete action fired: the child row survived the parent's rebuild.
    expect(
      sqlite.prepare(`SELECT id, lead_author FROM "${pair.posts}"`).all()
    ).toEqual([{ id: "p1", lead_author: "a1" }]);
    expect(await postKeys(target, pair)).toEqual([keyTo(pair)]);
    expect(sqlite.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  });

  it("keeps a table's own key when a type change rebuilds it", async () => {
    createTables(true);
    seed();

    const result = await save(
      target,
      desiredFor(pair, authorFields("text"), postFields(pair, "number"))
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(columnType(pair.posts, "score")).not.toBe("text");
    expect(await postKeys(target, pair)).toEqual([keyTo(pair)]);
    expect(sqlite.prepare(`SELECT id FROM "${pair.posts}"`).all()).toEqual([
      { id: "p1" },
    ]);
    // The key is enforced, not merely listed: a post naming no author is
    // refused, and deleting the author still cascades.
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO "${pair.posts}" (id, title, slug, score, lead_author) VALUES ('p2', 'Q', 'q', 1, 'nobody')`
        )
        .run()
    ).toThrow(/FOREIGN KEY/);
    sqlite.prepare(`DELETE FROM "${pair.authors}" WHERE id = 'a1'`).run();
    expect(sqlite.prepare(`SELECT id FROM "${pair.posts}"`).all()).toEqual([]);
  });

  it("keeps every row and key when a relationship is added to the parent", async () => {
    createTables(true);
    seed();

    const result = await save(
      target,
      desiredFor(
        pair,
        [...authorFields("text"), mentorField(pair)],
        postFields(pair, "text")
      )
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(await keysOf(target, pair.authors)).toEqual([
      {
        columns: ["mentor"],
        referencesTable: pair.authors,
        onDelete: "set null",
      },
    ]);
    // The parent's own rows, and the child's that cascade from it: no delete
    // action fired while the parent changed.
    expect(
      sqlite.prepare(`SELECT id, mentor FROM "${pair.authors}"`).all()
    ).toEqual([{ id: "a1", mentor: null }]);
    expect(
      sqlite.prepare(`SELECT id, lead_author FROM "${pair.posts}"`).all()
    ).toEqual([{ id: "p1", lead_author: "a1" }]);
    expect(await postKeys(target, pair)).toEqual([keyTo(pair)]);
    expect(sqlite.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  });
});

/**
 * What else a SQLite rebuild of a Builder table would lose: the UNIQUE its own
 * DDL gives a one-to-one relationship's column, and the triggers an app or a
 * plugin migration put on it. drizzle-kit rebuilds the table for both changes
 * below, a relationship added (its key) and a column's type changed, from a
 * runtime definition that holds neither.
 */
describe("what a SQLite rebuild of a Schema Builder table keeps (sqlite)", () => {
  const pair = pairNamed("brk");
  let sqlite: Database.Database;
  let target: Target;

  beforeEach(async () => {
    clearCachedSnapshot();
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzleSqlite({ client: sqlite });
    target = { db, dialect: "sqlite" };
    await freshPushSchema("sqlite", db, getDialectTables("sqlite"));
  });
  afterEach(() => {
    clearCachedSnapshot();
    sqlite.close();
  });

  /** Posts with a one-to-one profile, born with or without a lead author. */
  function createTables(postsBornWithAuthor: boolean) {
    for (const statement of [
      ...builderStatements("sqlite", pair.authors, authorFields("text")),
      ...builderStatements(
        "sqlite",
        pair.posts,
        postFields(pair, "text", postsBornWithAuthor, true)
      ),
    ]) {
      sqlite.exec(statement);
    }
    for (const id of ["a1", "a2"]) {
      sqlite
        .prepare(
          `INSERT INTO "${pair.authors}" (id, title, slug, name, rank) VALUES (?, 'A', ?, 'Ada', '1')`
        )
        .run(id, id);
    }
    insertPost("p1", "a1");
  }

  function insertPost(id: string, profile: string) {
    sqlite
      .prepare(
        `INSERT INTO "${pair.posts}" (id, title, slug, score, profile) VALUES (?, 'P', ?, '5', ?)`
      )
      .run(id, id, profile);
  }

  /** The table's stored CREATE statement, which a rebuild replaces. */
  const storedSql = (table: string) =>
    (
      sqlite
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`
        )
        .get(table) as { sql: string }
    ).sql;

  // Each change, with whether the posts table is born with the lead author
  // the first one adds.
  const REBUILDS = [
    {
      change: "a relationship added to it",
      bornWithAuthor: false,
      desired: () =>
        desiredFor(
          pair,
          authorFields("text"),
          postFields(pair, "text", true, true)
        ),
    },
    {
      change: "a column's type changed",
      bornWithAuthor: true,
      desired: () =>
        desiredFor(
          pair,
          authorFields("text"),
          postFields(pair, "number", true, true)
        ),
    },
  ];

  it.each(REBUILDS)(
    "keeps a one-to-one column unique through a rebuild for $change",
    async ({ bornWithAuthor, desired }) => {
      createTables(bornWithAuthor);
      const before = storedSql(pair.posts);

      const result = await save(target, desired());

      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      // The premise: the table was rebuilt, so its definition is drizzle-kit's.
      expect(storedSql(pair.posts)).not.toBe(before);
      expect(() => insertPost("p2", "a1")).toThrow(/UNIQUE/);
      // The control: another author is still accepted.
      insertPost("p3", "a2");
      expect(
        sqlite.prepare(`SELECT id, profile FROM "${pair.posts}"`).all()
      ).toEqual([
        { id: "p1", profile: "a1" },
        { id: "p3", profile: "a2" },
      ]);
    }
  );

  it("changes another table while this one holds a one-to-one, and leaves this one alone", async () => {
    createTables(true);
    const authorsBefore = storedSql(pair.authors);
    const before = storedSql(pair.posts);

    const result = await save(
      target,
      desiredFor(
        pair,
        authorFields("number"),
        postFields(pair, "text", true, true)
      )
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    // The authors' rank changed type, so drizzle-kit rebuilt them; the posts,
    // whose UNIQUE it no longer sees as one to drop, it left as they were.
    expect(storedSql(pair.authors)).not.toBe(authorsBefore);
    expect(storedSql(pair.posts)).toBe(before);
    expect(() => insertPost("p2", "a1")).toThrow(/UNIQUE/);
  });

  it.each(REBUILDS)(
    "refuses a rebuild for $change while the table has a trigger, and changes nothing",
    async ({ bornWithAuthor, desired }) => {
      createTables(bornWithAuthor);
      sqlite.exec(
        `CREATE TRIGGER "${pair.posts}_touch" AFTER INSERT ON "${pair.posts}" ` +
          `BEGIN UPDATE "${pair.authors}" SET name = 'touched'; END`
      );
      const before = storedSql(pair.posts);

      const result = await save(target, desired());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("PRECONDITION_FAILED");
      expect(result.error?.message).toContain(
        `rebuilding ${pair.posts} would drop triggers its schema does not track`
      );
      expect(storedSql(pair.posts)).toBe(before);
      expect(
        sqlite
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?`
          )
          .all(pair.posts)
      ).toEqual([{ name: `${pair.posts}_touch` }]);
    }
  );

  it("lets a one-to-one changed to many-to-one take duplicates once its table is rebuilt", async () => {
    createTables(true);
    const before = storedSql(pair.posts);

    const result = await save(
      target,
      desiredFor(pair, authorFields("text"), [
        ...postFields(pair, "number", true),
        profileAs(pair, { relationType: "manyToOne" }),
      ])
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(storedSql(pair.posts)).not.toBe(before);
    // The cardinality the author asked for: two posts may share a profile.
    insertPost("p2", "a1");
  });

  it("keeps a renamed one-to-one column unique through a rebuild", async () => {
    createTables(true);
    sqlite.exec(`DROP TRIGGER IF EXISTS "${pair.posts}_touch"`);

    const result = await save(
      target,
      desiredFor(pair, authorFields("text"), [
        ...postFields(pair, "number", true),
        profileAs(pair, { name: "mainProfile" }),
      ]),
      { confirmRenames: true }
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    const columns = (
      sqlite
        .prepare(`SELECT name FROM pragma_table_info(?)`)
        .all(pair.posts) as Array<{ name: string }>
    ).map(column => column.name);
    // The premise: the column was renamed, not dropped and re-added.
    expect(columns).toContain("main_profile");
    expect(columns).not.toContain("profile");
    expect(
      sqlite.prepare(`SELECT id, main_profile FROM "${pair.posts}"`).all()
    ).toEqual([{ id: "p1", main_profile: "a1" }]);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO "${pair.posts}" (id, title, slug, score, main_profile) VALUES ('p2', 'P', 'p2', 5, 'a1')`
        )
        .run()
    ).toThrow(/UNIQUE/);
  });

  it("refuses a rename and a rebuild of a table with a trigger before the rename runs", async () => {
    // The trigger refusal reads every table this apply approves a rebuild of
    // before anything writes: a check made once drizzle-kit's statements are
    // known would come after the rename had already landed, untransacted.
    // The authors: a plain column renamed and another's type changed, so no
    // key or check changes and only the type change approves the rebuild.
    createTables(true);
    sqlite.exec(
      `CREATE TRIGGER "${pair.authors}_touch" AFTER INSERT ON "${pair.authors}" ` +
        `BEGIN UPDATE "${pair.posts}" SET title = 'touched'; END`
    );
    const before = storedSql(pair.authors);

    const result = await save(
      target,
      desiredFor(
        pair,
        [
          { name: "fullName", type: "text" },
          { name: "rank", type: "number" },
        ],
        postFields(pair, "text", true, true)
      ),
      { confirmRenames: true }
    );

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain(
      `rebuilding ${pair.authors} would drop triggers its schema does not track`
    );
    // Nothing ran: not the rename, not the rebuild.
    expect(storedSql(pair.authors)).toBe(before);
  });
});

/**
 * The same added relationship on the server dialects, which take a key with a
 * statement of its own; and the next preview plans nothing for it, so the key
 * the save created is the key the diff expects.
 */
const SERVERS: Array<{
  dialect: "postgresql" | "mysql";
  open: (url: string) => {
    target: Target;
    run: (sql: string) => Promise<unknown>;
    close: () => Promise<void>;
  };
}> = [
  {
    dialect: "postgresql",
    open: url => {
      const pool = new Pool({ connectionString: url });
      return {
        target: { db: drizzlePg({ client: pool }), dialect: "postgresql" },
        run: statement => pool.query(statement),
        close: () => pool.end(),
      };
    },
  },
  {
    dialect: "mysql",
    open: url => {
      const pool: MysqlPool = createPool({ uri: url });
      return {
        target: {
          db: drizzleMysql({ client: pool }),
          dialect: "mysql",
          databaseName: new URL(url).pathname.slice(1),
        },
        run: statement => pool.promise().query(statement),
        close: () => new Promise<void>(done => pool.end(() => done())),
      };
    },
  },
];

for (const server of SERVERS) {
  const context = makeTestContext(server.dialect);
  describe.skipIf(!context.url)(
    `a Schema Builder collection's foreign keys (${server.dialect})`,
    () => {
      const pair = pairNamed(`${context.prefix}_bfk`);
      const quote = (name: string) =>
        server.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      let connection: ReturnType<(typeof server)["open"]>;

      const dropTables = async () => {
        await connection.run(`DROP TABLE IF EXISTS ${quote(pair.posts)}`);
        await connection.run(`DROP TABLE IF EXISTS ${quote(pair.authors)}`);
      };

      beforeAll(async () => {
        connection = server.open(context.url ?? "");
        await dropTables();
      });
      beforeEach(() => {
        clearCachedSnapshot();
      });
      afterAll(async () => {
        await dropTables();
        await connection.close();
        clearCachedSnapshot();
      });

      it("gets the key of a relationship added to it after it was created", async () => {
        for (const statement of [
          ...builderStatements(
            server.dialect,
            pair.authors,
            authorFields("text")
          ),
          ...builderStatements(
            server.dialect,
            pair.posts,
            postFields(pair, "text", false)
          ),
        ]) {
          await connection.run(statement);
        }
        expect(await postKeys(connection.target, pair)).toEqual([]);

        const desired = desiredFor(
          pair,
          authorFields("text"),
          postFields(pair, "text")
        );
        const result = await save(connection.target, desired);

        expect(result.error).toBeUndefined();
        expect(result.success).toBe(true);
        expect(await postKeys(connection.target, pair)).toEqual([keyTo(pair)]);
        // Enforced: a post naming no author is refused.
        await expect(
          connection.run(
            `INSERT INTO ${quote(pair.posts)} (id, title, slug, score, lead_author) VALUES ('p2', 'Q', 'q', '1', 'nobody')`
          )
        ).rejects.toThrow();
        // And the next diff expects exactly that key.
        const preview = await previewDesiredSchema({
          desired,
          db: connection.target.db,
          dialect: server.dialect,
        });
        expect(
          preview.operations.filter(op => op.type.endsWith("foreign_key"))
        ).toEqual([]);
      });

      // As on SQLite: keyed only when the registry does not record the relationship yet.
      it.each([
        { recorded: ["title", "score"], keyed: true },
        { recorded: ["title", "score", "leadAuthor"], keyed: false },
      ])(
        "keys a keyless relationship column only when the change adds it (recorded: $recorded)",
        async ({ recorded, keyed }) => {
          await dropTables();
          for (const statement of [
            ...builderStatements(
              server.dialect,
              pair.authors,
              authorFields("text")
            ),
            ...builderStatements(
              server.dialect,
              pair.posts,
              postFields(pair, "text", false)
            ),
            authorColumnWithoutKey(server.dialect, pair),
          ]) {
            await connection.run(statement);
          }
          expect(await postKeys(connection.target, pair)).toEqual([]);

          const result = await save(
            connection.target,
            recordingPosts(
              desiredFor(pair, authorFields("text"), postFields(pair, "text")),
              recorded
            )
          );

          expect(result.error).toBeUndefined();
          expect(await postKeys(connection.target, pair)).toEqual(
            keyed ? [keyTo(pair)] : []
          );
        }
      );

      // As on SQLite: the rename adds no key its old column never had.
      it("keeps a renamed relationship without a key when its column had none", async () => {
        await dropTables();
        for (const statement of [
          ...builderStatements(
            server.dialect,
            pair.authors,
            authorFields("text")
          ),
          ...builderStatements(
            server.dialect,
            pair.posts,
            postFields(pair, "text", false)
          ),
          authorColumnWithoutKey(server.dialect, pair),
        ]) {
          await connection.run(statement);
        }

        const result = await save(
          connection.target,
          postsWithAuthorRenamed(pair),
          { confirmRenames: true }
        );

        expect(result.error).toBeUndefined();
        expect(await postColumns(connection.target, pair)).toContain("writer");
        expect(await postColumns(connection.target, pair)).not.toContain(
          "lead_author"
        );
        expect(await postKeys(connection.target, pair)).toEqual([]);
      });

      it("keeps a one-to-one column unique when a relationship is added", async () => {
        // drizzle-kit takes a save that adds a key on these dialects too, and
        // its runtime tables declare no UNIQUE; the constraint must survive.
        await dropTables();
        for (const statement of [
          ...builderStatements(
            server.dialect,
            pair.authors,
            authorFields("text")
          ),
          ...builderStatements(
            server.dialect,
            pair.posts,
            postFields(pair, "text", false, true)
          ),
        ]) {
          await connection.run(statement);
        }
        for (const id of ["a1", "a2"]) {
          await connection.run(
            `INSERT INTO ${quote(pair.authors)} (id, title, slug, name, ${quote("rank")}) VALUES ('${id}', 'A', '${id}', 'Ada', '1')`
          );
        }
        const insertPost = (id: string, profile: string) =>
          connection.run(
            `INSERT INTO ${quote(pair.posts)} (id, title, slug, score, profile) VALUES ('${id}', 'P', '${id}', '5', '${profile}')`
          );
        await insertPost("p1", "a1");

        const result = await save(
          connection.target,
          desiredFor(
            pair,
            authorFields("text"),
            postFields(pair, "text", true, true)
          )
        );

        expect(result.error).toBeUndefined();
        expect(result.success).toBe(true);
        expect(await postKeys(connection.target, pair)).toContainEqual(
          keyTo(pair)
        );
        await expect(insertPost("p2", "a1")).rejects.toThrow();
        await insertPost("p3", "a2");
      });

      // PostgreSQL only: on MySQL drizzle-kit never drops a live UNIQUE, so a
      // one-to-one changed to many-to-one keeps it there whatever this keeps;
      // nothing plans its removal on any dialect yet.
      it.skipIf(server.dialect === "mysql")(
        "lets a one-to-one changed to many-to-one take duplicates when a relationship is added",
        async () => {
          await dropTables();
          for (const statement of [
            ...builderStatements(
              server.dialect,
              pair.authors,
              authorFields("text")
            ),
            ...builderStatements(
              server.dialect,
              pair.posts,
              postFields(pair, "text", false, true)
            ),
          ]) {
            await connection.run(statement);
          }
          await connection.run(
            `INSERT INTO ${quote(pair.authors)} (id, title, slug, name, ${quote("rank")}) VALUES ('a1', 'A', 'a1', 'Ada', '1')`
          );
          const insertPost = (id: string) =>
            connection.run(
              `INSERT INTO ${quote(pair.posts)} (id, title, slug, score, profile) VALUES ('${id}', 'P', '${id}', '5', 'a1')`
            );
          await insertPost("p1");

          const result = await save(
            connection.target,
            desiredFor(pair, authorFields("text"), [
              ...postFields(pair, "text", true),
              profileAs(pair, { relationType: "manyToOne" }),
            ])
          );

          expect(result.error).toBeUndefined();
          expect(result.success).toBe(true);
          // The cardinality the author asked for: two posts may share a profile.
          await insertPost("p2");
        }
      );
    }
  );
}
