/**
 * A migration file's field type changes judged on the values the database holds, before the file
 * runs (`refuseFileTypeChanges`), on SQLite, PostgreSQL and MySQL.
 *
 * The files are the ones `migrate:create` writes (`generateMigration`, from `defineCollection`
 * declarations, so each snapshot records the fields): the first file's statements make the table,
 * its rows are written, and the next file is judged as `nextly migrate` would judge it before its
 * first statement.
 *
 * What separates the correct judgement from a plausible broken one: a type change that keeps its
 * column writes no statement, so a judgement that reads statements alone refuses nothing over
 * "Hello"; and the same file goes ahead over values the new type reads, so a refusal of every type
 * change is told apart too.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  describe,
  expect,
  it,
  onTestFinished,
} from "vitest";

import { defineCollection, number, select, text } from "../../../../../config";
import { makeTestContext } from "../../../../../database/__tests__/integration/helpers/test-db";
import { toMinimalEntities } from "../../../migrate-create/config-entities";
import { generateMigration } from "../../../migrate-create/generate";
import type { SnapshotFile } from "../../../migrate-create/snapshot-io";
import type { RenameCandidate } from "../../../pipeline/pushschema-pipeline-interfaces";
import { parseSqlSections } from "../../../migrate/sql-sections";
import { splitSqlStatements } from "../../../migrate/split-sql";
import { resolveCollectionTableName } from "../../../utils/resolve-table-name";
import {
  fileTypeChangeRefusals,
  refuseFileTypeChanges,
} from "../file-type-changes";

interface Connection {
  db: unknown;
  dialect: SupportedDialect;
  run: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
}

/** A written migration: its name, UP statements as the runner splits them, and its snapshot. */
interface Written {
  filename: string;
  statements: string[];
  snapshot: SnapshotFile;
}

function cases(open: () => { connection: Connection; slug: string }) {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  /**
   * `migrate:create` over the collection with `field` as its one field, after the files written
   * before it; a rename candidate is accepted where `rename` says so.
   */
  async function create(
    slug: string,
    dialect: SupportedDialect,
    field: () => unknown,
    step: number,
    rename = false
  ): Promise<Written> {
    dir ??= await mkdtemp(join(tmpdir(), "nextly-file-type-changes-"));
    const result = await generateMigration({
      name: `step_${step}`,
      dialect,
      migrationsDir: dir,
      collections: toMinimalEntities(
        [defineCollection({ slug, fields: [field()] as never })],
        e => resolveCollectionTableName(e.slug, e.dbName)
      ),
      singles: [],
      components: [],
      nonInteractive: true,
      decideRenames: async (candidates: readonly RenameCandidate[]) =>
        candidates.map(candidate => ({ candidate, accepted: rename })),
      now: new Date(Date.UTC(2026, 10, 18, 12, step)),
    });
    if (result === null) throw new Error("no migration was written");
    const { upSql } = parseSqlSections(await readFile(result.sqlPath, "utf-8"));
    return {
      filename: result.sqlPath.split(/[\\/]/).pop() ?? "",
      statements: splitSqlStatements(upSql, dialect),
      snapshot: JSON.parse(
        await readFile(result.snapshotPath, "utf-8")
      ) as SnapshotFile,
    };
  }

  /** The first file applied, its table holding `values` in `heading` by row id. */
  async function holding(
    field: () => unknown,
    values: Record<string, string>
  ): Promise<{ connection: Connection; slug: string; first: Written }> {
    const { connection, slug } = open();
    const q = (n: string) =>
      connection.dialect === "mysql" ? `\`${n}\`` : `"${n}"`;
    const table = resolveCollectionTableName(slug);
    await connection.run(`DROP TABLE IF EXISTS ${q(table)}`);
    const first = await create(slug, connection.dialect, field, 1);
    for (const statement of first.statements) await connection.run(statement);
    for (const [id, value] of Object.entries(values)) {
      await connection.run(
        `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("heading")}, ${q("created_at")}, ${q("updated_at")}) VALUES ('${id}', 'T', '${id}', '${value}', '2026-11-18 00:00:00', '2026-11-18 00:00:00')`
      );
    }
    return { connection, slug, first };
  }

  /** The judgement of `next` as `nextly migrate` asks it, after `first`. */
  function judge(connection: Connection, first: Written, next: Written) {
    return refuseFileTypeChanges(connection.db, {
      filename: next.filename,
      before: first.snapshot.entities,
      target: next.snapshot.entities,
      statements: next.statements,
      dialect: connection.dialect,
    });
  }

  const TEXT = () => text({ name: "heading" });
  const CHOICE = () =>
    select({ name: "heading", options: [{ label: "A", value: "a" }] });

  it("refuses a file whose type change keeps its column over a value the new type cannot read, naming the file", async () => {
    const { connection, slug, first } = await holding(TEXT, {
      r1: "a",
      r2: "Hello",
    });
    const next = await create(slug, connection.dialect, CHOICE, 2);
    // No statement changes the column: only the snapshots say the type changed.
    expect(next.statements.join("\n")).not.toMatch(/heading/i);

    const refused = judge(connection, first, next);

    await expect(refused).rejects.toMatchObject({
      publicData: {
        errors: [
          expect.objectContaining({
            path: "fields.heading",
            code: "TYPE_CHANGE_LOSES_VALUES",
            message: expect.stringContaining(next.filename),
          }),
        ],
      },
    });
  });

  it("lets the same file go ahead where every value is one the new type reads", async () => {
    const { connection, slug, first } = await holding(TEXT, {
      r1: "a",
      r2: "a",
    });
    const next = await create(slug, connection.dialect, CHOICE, 2);

    await expect(judge(connection, first, next)).resolves.toBeUndefined();
  });

  it("refuses a file changing a text into a number over a value no number reads", async () => {
    const { connection, slug, first } = await holding(TEXT, {
      r1: "5",
      r2: "abc",
    });
    const next = await create(
      slug,
      connection.dialect,
      () => number({ name: "heading" }),
      2
    );

    await expect(judge(connection, first, next)).rejects.toMatchObject({
      publicData: {
        errors: [expect.objectContaining({ path: "fields.heading" })],
      },
    });
  });

  it("lets a text become a number where every value is a number's own writing", async () => {
    const { connection, slug, first } = await holding(TEXT, {
      r1: "5",
      r2: "12",
    });
    const next = await create(
      slug,
      connection.dialect,
      () => number({ name: "heading" }),
      2
    );

    await expect(judge(connection, first, next)).resolves.toBeUndefined();
  });

  it("judges a renamed field's values under its new name", async () => {
    const { connection, slug, first } = await holding(TEXT, {
      r1: "Hello",
    });
    const next = await create(
      slug,
      connection.dialect,
      () => select({ name: "summary", options: [{ label: "A", value: "a" }] }),
      2,
      true
    );
    // The file renames the column, so the old values come to the new field.
    expect(next.statements.join("\n")).toMatch(/RENAME/i);

    await expect(judge(connection, first, next)).rejects.toMatchObject({
      publicData: {
        errors: [
          expect.objectContaining({
            path: "fields.summary",
            code: "TYPE_CHANGE_LOSES_VALUES",
          }),
        ],
      },
    });
  });

  it("lists each refusal with its entity, for a run that reports rather than refuses", async () => {
    const { connection, slug, first } = await holding(TEXT, {
      r1: "a",
      r2: "Hello",
    });
    const next = await create(slug, connection.dialect, CHOICE, 2);
    const listed = await fileTypeChangeRefusals(connection.db, {
      filename: next.filename,
      before: first.snapshot.entities,
      target: next.snapshot.entities,
      statements: next.statements,
      dialect: connection.dialect,
    });

    expect(listed).toEqual([
      expect.objectContaining({
        entity: { kind: "collection", slug },
        path: "heading",
        code: "TYPE_CHANGE_LOSES_VALUES",
      }),
    ]);
    // Listed, and nothing more: the values are untouched.
    await expect(judge(connection, first, next)).rejects.toBeDefined();
  });

  it("judges a translated field renamed in the translation file written beside the migration", async () => {
    const opened = open();
    const { connection } = opened;
    // A table of its own, apart from the other cases' (its translations table keys into it), and
    // short: MySQL names the translations table's foreign key after it, in at most 64 characters.
    const slug = opened.slug.replace(/ftc_posts$/, "ftl");
    const q = (n: string) =>
      connection.dialect === "mysql" ? `\`${n}\`` : `"${n}"`;
    const table = resolveCollectionTableName(slug);
    const dropBoth = async () => {
      await connection.run(`DROP TABLE IF EXISTS ${q(`${table}_locales`)}`);
      await connection.run(`DROP TABLE IF EXISTS ${q(table)}`);
    };
    await dropBoth();
    onTestFinished(dropBoth);
    dir ??= await mkdtemp(join(tmpdir(), "nextly-file-type-changes-"));
    const migrationsDir = dir;
    /** A run of `migrate:create` over the translated collection with `field`: every file it wrote, in run order. */
    const run = async (field: () => unknown, step: number) => {
      const before = new Set(await readdir(migrationsDir));
      const result = await generateMigration({
        name: `step_${step}`,
        dialect: connection.dialect,
        migrationsDir,
        defaultLocale: "en",
        collections: toMinimalEntities(
          [
            defineCollection({
              slug,
              localized: true,
              fields: [field()] as never,
            }),
          ],
          e => resolveCollectionTableName(e.slug, e.dbName)
        ),
        singles: [],
        components: [],
        nonInteractive: true,
        autoAcceptRenames: true,
        now: new Date(Date.UTC(2026, 10, 18, 12, step)),
      });
      if (result === null) throw new Error("no migration was written");
      const written = (await readdir(migrationsDir))
        .filter(f => f.endsWith(".sql") && !before.has(f))
        .sort();
      const statementsOf = async (name: string) =>
        splitSqlStatements(
          parseSqlSections(await readFile(join(migrationsDir, name), "utf-8"))
            .upSql,
          connection.dialect
        );
      const main = result.sqlPath.split(/[\\/]/).pop() ?? "";
      return {
        filename: main,
        all: (await Promise.all(written.map(statementsOf))).flat(),
        main: await statementsOf(main),
        snapshot: JSON.parse(
          await readFile(result.snapshotPath, "utf-8")
        ) as SnapshotFile,
      };
    };
    const first = await run(
      () => text({ name: "heading", localized: true }),
      1
    );
    for (const statement of first.all) await connection.run(statement);
    await connection.run(
      `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("created_at")}, ${q("updated_at")}) VALUES ('r1', 'T', 'r1', '2026-11-18 00:00:00', '2026-11-18 00:00:00')`
    );
    await connection.run(
      `INSERT INTO ${q(`${table}_locales`)} (${q("_parent")}, ${q("_locale")}, ${q("heading")}) VALUES ('r1', 'en', 'Hello')`
    );
    const next = await run(
      () =>
        select({
          name: "summary",
          localized: true,
          options: [{ label: "A", value: "a" }],
        }),
      2
    );
    const judgedOn = (statements: string[]) =>
      refuseFileTypeChanges(connection.db, {
        filename: next.filename,
        before: first.snapshot.entities,
        target: next.snapshot.entities,
        statements,
        dialect: connection.dialect,
      });
    // The rename is in the translation file, not the migration itself.
    expect(next.main.join("\n")).not.toMatch(/RENAME/i);
    expect(next.all.join("\n")).toMatch(/RENAME/i);

    await expect(judgedOn(next.all)).rejects.toMatchObject({
      publicData: {
        errors: [
          expect.objectContaining({
            path: "fields.summary",
            code: "TYPE_CHANGE_LOSES_VALUES",
          }),
        ],
      },
    });
    // The migration's own statements alone pair nothing: why every file of the change is given.
    await expect(judgedOn(next.main)).resolves.toBeUndefined();
  });

  it("judges nothing for a file with no snapshot before it", async () => {
    const { connection, slug } = await holding(TEXT, { r1: "Hello" });
    const next = await create(slug, connection.dialect, CHOICE, 2);

    await expect(
      refuseFileTypeChanges(connection.db, {
        filename: next.filename,
        before: undefined,
        target: next.snapshot.entities,
        statements: next.statements,
        dialect: connection.dialect,
      })
    ).resolves.toBeUndefined();
  });
}

describe("a migration file's type changes judged on the database (sqlite)", () => {
  let sqlite: Database.Database;
  let connection: Connection;
  beforeAll(() => {
    sqlite = new Database(":memory:");
    connection = {
      db: drizzleSqlite({ client: sqlite }),
      dialect: "sqlite",
      run: sql => Promise.resolve(sqlite.exec(sql)),
      close: () => Promise.resolve(),
    };
  });
  afterAll(() => sqlite?.close());

  cases(() => ({ connection, slug: "ftc_posts" }));
});

const SERVERS: Array<{
  dialect: "postgresql" | "mysql";
  open: (url: string) => Connection;
}> = [
  {
    dialect: "postgresql",
    open: url => {
      const pool = new Pool({ connectionString: url });
      return {
        db: drizzlePg({ client: pool }),
        dialect: "postgresql",
        run: sql => pool.query(sql),
        close: () => pool.end(),
      };
    },
  },
  {
    dialect: "mysql",
    open: url => {
      const pool: MysqlPool = createPool({ uri: url });
      return {
        db: drizzleMysql({ client: pool }),
        dialect: "mysql",
        run: sql => pool.promise().query(sql),
        close: () => new Promise<void>(done => pool.end(() => done())),
      };
    },
  },
];

for (const server of SERVERS) {
  const context = makeTestContext(server.dialect);
  describe.skipIf(!context.url)(
    `a migration file's type changes judged on the database (${server.dialect})`,
    () => {
      // A per-file prefix keeps this file's table apart from any other on the worker's database.
      const slug = `${context.prefix}_ftc_posts`;
      let connection: Connection;
      beforeAll(() => {
        connection = server.open(context.url ?? "");
      });
      afterAll(async () => {
        const table = resolveCollectionTableName(slug);
        await connection.run(
          `DROP TABLE IF EXISTS ${server.dialect === "mysql" ? `\`${table}\`` : `"${table}"`}`
        );
        await connection.close();
      });

      cases(() => ({ connection, slug }));
    }
  );
}
