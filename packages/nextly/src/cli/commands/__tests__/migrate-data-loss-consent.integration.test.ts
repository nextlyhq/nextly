/**
 * `nextly migrate` and `migrate:down` refuse a migration file, or a down
 * section, that deletes data unless the consent covers every deletion in it,
 * on PostgreSQL, MySQL and SQLite. The statements decide, never a header mark,
 * so a hand-written file is judged as a generated one is.
 *
 * Each refusal is made before anything changes: the schema, the rows and the
 * ledger are as they were. The consent is the one `--accept-data-loss` and
 * `NEXTLY_ACCEPT_DATA_LOSS` resolve to (`resolveDataLossConsent`).
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureSchemaEventsTable } from "../../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import {
  NO_CONSENT,
  resolveDataLossConsent,
  type DataLossConsent,
} from "../../../domains/schema/migrate/data-loss-consent";
import { marksNoTransaction } from "../../../domains/schema/migrate/split-sql";
import { parseSqlSections } from "../../../domains/schema/migrate/sql-sections";
import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "../../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import { withMigrateLock } from "../../../domains/schema/pipeline/locks";
import { NextlyError } from "../../../errors/nextly-error";
import { createLogger } from "../../utils/logger";
import { migrateCore, previewMigrate } from "../migrate";
import { downDatabaseDeps, migrateDownCore } from "../migrate-down";

/** Every table a lock keeps its row in: not part of what a run leaves behind. */
const LOCK_TABLES = new Set([
  "nextly_schema_lock",
  "nextly_field_group_lock",
  "nextly_migrate_lock",
]);

const logger = createLogger({ quiet: true });

/** The consent `--accept-data-loss=<targets>` gives. */
function consentFor(targets: string): DataLossConsent {
  return resolveDataLossConsent({ flag: targets, env: {} });
}

describe.each(LOCK_DIALECTS)("a migration that deletes data on %s", dialect => {
  const P = `mdl_${randomBytes(3).toString("hex")}`;
  const posts = `${P}_posts`;
  let seq = 0;
  let world: LockWorld;
  let adapter: DrizzleAdapter;
  let migrationsDir: string;

  beforeEach(async () => {
    world = await lockWorld(dialect, { fresh: true });
    adapter = await world.connect();
    migrationsDir = mkdtempSync(join(tmpdir(), "nextly-data-loss-"));
    // Nextly's own tables, then a table with rows the files below delete.
    await migrate();
    file(
      [
        `CREATE TABLE ${posts} (id integer PRIMARY KEY, title varchar(64), summary varchar(64))`,
        `INSERT INTO ${posts} (id, title, summary) VALUES (1, 'a', 'x'), (2, 'b', 'y')`,
      ],
      [`DROP TABLE ${posts}`]
    );
    expect((await migrate()).applied).toBe(1);
  }, 120_000);

  afterEach(async () => {
    await adapter.disconnect();
    rmSync(migrationsDir, { recursive: true, force: true });
    await world.dispose();
  }, 60_000);

  function migrate(
    consent: DataLossConsent = NO_CONSENT,
    extra: {
      interactive?: boolean;
      answer?: boolean;
      asked?: string[];
      /** Every line the run prints as a warning, the listing included. */
      printed?: string[];
    } = {}
  ) {
    return migrateCore({
      extensionSchema: undefined,
      dialect,
      db: adapter.getDrizzle(),
      adapter: adapter as never,
      migrationsDir,
      logger:
        extra.printed === undefined
          ? logger
          : {
              ...logger,
              warn: (line: string) => {
                extra.printed?.push(line);
              },
            },
      lockMode: "wait",
      lockWaitMs: 30_000,
      consent,
      interactive: extra.interactive ?? false,
      askToDelete: question => {
        extra.asked?.push(question);
        return Promise.resolve(extra.answer ?? false);
      },
      ensureLedger: () => ensureSchemaEventsTable(adapter),
    });
  }

  async function migrateDown(consent: DataLossConsent = NO_CONSENT) {
    return migrateDownCore({
      ...(await downDatabaseDeps({ adapter, dialect })),
      nodeEnv: "test",
      logger,
      options: { step: 1, yes: true, consent },
      fileExists: () => Promise.resolve(true),
      readDownSql: filename => {
        const content = readFileSync(join(migrationsDir, filename), "utf8");
        return Promise.resolve({
          sql: parseSqlSections(content).downSql,
          transaction: !marksNoTransaction(content),
        });
      },
      withLock: withMigrateLock,
    });
  }

  /** A hand-written migration file, with no header mark, after the ones before it. */
  function file(up: string[], down: string[]): string {
    seq += 1;
    const name = `20261102_${String(seq).padStart(6, "0")}_${P}`;
    const statements = (list: string[]) => list.map(s => `${s};`).join("\n");
    writeFileSync(
      join(migrationsDir, `${name}.sql`),
      `-- Migration: ${name}\n\n-- UP\n${statements(up)}\n\n-- DOWN\n${statements(down)}\n`,
      "utf8"
    );
    return `${name}.sql`;
  }

  async function databaseState() {
    const tables: Record<string, number> = {};
    for (const name of (await adapter.listTables()).sort()) {
      if (LOCK_TABLES.has(name)) continue;
      const rows = await adapter.executeQuery<{ n: unknown }>(
        `SELECT COUNT(*) AS n FROM ${name}`
      );
      tables[name] = Number(rows[0]?.n ?? 0);
    }
    const columns = await adapter.executeQuery<{ c: unknown }>(
      dialect === "sqlite"
        ? `SELECT name AS c FROM pragma_table_info('${posts}')`
        : `SELECT column_name AS c FROM information_schema.columns WHERE table_name = '${posts}'`
    );
    const ledger = (
      await new SchemaEventsRepository(
        adapter.getDrizzle(),
        dialect
      ).listFileApplies()
    )
      .map(row => `${row.filename}:${row.status}`)
      .sort();
    return {
      tables,
      columns: columns.map(r => String(r.c).toLowerCase()).sort(),
      ledger,
    };
  }

  /** The refusal a run ended with, and that it changed nothing. */
  async function refusedUnchanged(work: () => Promise<unknown>) {
    const before = await databaseState();
    const error = await work().then(
      () => undefined,
      (thrown: unknown) => thrown
    );
    expect(NextlyError.is(error)).toBe(true);
    expect(await databaseState()).toEqual(before);
    return (error as NextlyError).publicMessage;
  }

  /** A run a person declined at the terminal: the shared code, and nothing changed. */
  async function declinedUnchanged(work: () => Promise<unknown>) {
    const before = await databaseState();
    const error = await work().then(
      () => undefined,
      (thrown: unknown) => thrown
    );
    expect(NextlyError.is(error) && error.code).toBe("DATA_LOSS_DECLINED");
    expect(await databaseState()).toEqual(before);
  }

  it("refuses a dropped table without consent, naming the file and the table, and applies with consent naming it", async () => {
    const name = file([`DROP TABLE ${posts}`], []);
    const message = await refusedUnchanged(() => migrate());
    expect(message).toContain(name);
    expect(message).toContain(posts);
    expect((await migrate(consentFor(posts))).applied).toBe(1);
    expect((await databaseState()).tables[posts]).toBeUndefined();
  }, 180_000);

  it("refuses an unmarked hand-written DROP COLUMN, and applies with consent naming the column", async () => {
    file([`ALTER TABLE ${posts} DROP COLUMN summary`], []);
    const message = await refusedUnchanged(() =>
      migrate(consentFor(`${posts}.title`))
    );
    expect(message).toContain("summary");
    expect((await migrate(consentFor(`${posts}.summary`))).applied).toBe(1);
    expect((await databaseState()).columns).not.toContain("summary");
  }, 180_000);

  it.each([
    [
      "a DELETE with a condition",
      (t: string) => `DELETE FROM ${t} WHERE id = 1`,
    ],
    [
      "a removal of every row",
      (t: string) =>
        dialect === "sqlite" ? `DELETE FROM ${t}` : `TRUNCATE TABLE ${t}`,
    ],
  ])(
    "refuses %s in an UP without consent, keeping every row, and runs with consent naming the table",
    async (_name, statement) => {
      file([statement(posts)], []);
      const message = await refusedUnchanged(() => migrate());
      expect(message).toContain(posts);
      expect((await migrate(consentFor(posts))).applied).toBe(1);
    },
    180_000
  );

  it("asks no consent for a file whose only data statement is an UPDATE", async () => {
    file([`UPDATE ${posts} SET title = 'c' WHERE id = 1`], []);
    expect((await migrate()).applied).toBe(1);
  }, 180_000);

  it("refuses an app drop under the earlier core-only spelling, naming the app drop", async () => {
    file([`ALTER TABLE ${posts} DROP COLUMN summary`], []);
    const core = resolveDataLossConsent({
      env: { NEXTLY_ALLOW_CORE_DESTRUCTIVE: "1" },
      honours: ["NEXTLY_ALLOW_CORE_DESTRUCTIVE"],
    });
    const message = await refusedUnchanged(() => migrate(core));
    expect(message).toContain("summary");
  }, 180_000);

  it("names each deletion and the consent a real run needs in a dry run, which writes nothing", async () => {
    const name = file([`DROP TABLE ${posts}`], []);
    const lines: string[] = [];
    const before = await databaseState();
    await previewMigrate({
      adapter: adapter as never,
      db: adapter.getDrizzle(),
      dialect,
      migrationsDir,
      plugins: [],
      logger: {
        ...logger,
        info: (m: string) => {
          lines.push(m);
        },
      } as never,
    });
    const listing = lines.join("\n");
    expect(listing).toContain(name);
    expect(listing).toContain(
      `deletes data: table ${posts}. A real run needs --accept-data-loss=${posts}`
    );
    expect(await databaseState()).toEqual(before);
  }, 180_000);

  it("asks nothing for a table rebuild in a later file of the run, when an earlier file of the run creates the table", async () => {
    // A fresh environment: the table and its rebuild are both pending.
    const fresh = `${P}_fresh`;
    file(
      [`CREATE TABLE ${fresh} (id integer PRIMARY KEY, title varchar(64))`],
      []
    );
    file(
      [
        `CREATE TABLE __new_${fresh} (id integer PRIMARY KEY, title varchar(64) NOT NULL)`,
        `INSERT INTO __new_${fresh} (id, title) SELECT id, title FROM ${fresh}`,
        `DROP TABLE ${fresh}`,
        `ALTER TABLE __new_${fresh} RENAME TO ${fresh}`,
      ],
      []
    );
    expect((await migrate()).applied).toBe(2);
  }, 180_000);

  it("names a live table an earlier file of the run renames by its live name, for what a later file deletes", async () => {
    const renamed = `${P}_renamed`;
    file([`ALTER TABLE ${posts} RENAME TO ${renamed}`], []);
    file([`ALTER TABLE ${renamed} DROP COLUMN summary`], []);
    const message = await refusedUnchanged(() => migrate());
    expect(message).toContain(`${posts}.summary`);
    expect((await migrate(consentFor(`${posts}.summary`))).applied).toBe(2);
  }, 180_000);

  it("stops with nothing changed when the person at the terminal declines", async () => {
    file([`DROP TABLE ${posts}`], []);
    await declinedUnchanged(() =>
      migrate(NO_CONSENT, { interactive: true, answer: false })
    );
    expect(
      (await migrate(NO_CONSENT, { interactive: true, answer: true })).applied
    ).toBe(1);
  }, 180_000);

  it("asks one question for a run of several files that delete, and a no applies none of them", async () => {
    const other = `${P}_other`;
    file([`CREATE TABLE ${other} (id integer)`], [`DROP TABLE ${other}`]);
    expect((await migrate()).applied).toBe(1);
    const first = file([`DROP TABLE ${other}`], []);
    const second = file([`DELETE FROM ${posts}`], []);
    const asked: string[] = [];
    const printed: string[] = [];
    await declinedUnchanged(() =>
      migrate(NO_CONSENT, { interactive: true, answer: false, asked, printed })
    );
    expect(asked).toHaveLength(1);
    // The one listing names both files, each above what it deletes.
    expect(printed).toContain(`  ${first}:`);
    expect(printed).toContain(`  ${second}:`);
    expect(
      (await migrate(NO_CONSENT, { interactive: true, answer: true, asked }))
        .applied
    ).toBe(2);
    // The second run asked once more, for both files together.
    expect(asked).toHaveLength(2);
  }, 180_000);

  it("refuses migrate:down over a down section dropping the table its UP created, and rolls back with consent naming it", async () => {
    const made = `${P}_made`;
    file([`CREATE TABLE ${made} (id integer)`], [`DROP TABLE ${made}`]);
    expect((await migrate()).applied).toBe(1);
    const message = await refusedUnchanged(() => migrateDown());
    expect(message).toContain(made);
    expect((await migrateDown(consentFor(made))).rolledBack).toHaveLength(1);
  }, 180_000);

  it("refuses migrate:down over a down section that removes rows, keeping every row", async () => {
    file(
      [`INSERT INTO ${posts} (id, title) VALUES (3, 'c')`],
      [`DELETE FROM ${posts} WHERE id = 3`]
    );
    expect((await migrate()).applied).toBe(1);
    const message = await refusedUnchanged(() => migrateDown());
    expect(message).toContain(posts);
    expect((await migrateDown(consentFor(posts))).rolledBack).toHaveLength(1);
  }, 180_000);

  it("names the tables a removal cascades to, and refuses consent naming only the parent", async () => {
    const parent = `${P}_parent`;
    const child = `${P}_child`;
    await adapter.executeQuery(
      `CREATE TABLE ${parent} (id integer PRIMARY KEY)`
    );
    await adapter.executeQuery(
      `CREATE TABLE ${child} (id integer PRIMARY KEY, parent_id integer, FOREIGN KEY (parent_id) REFERENCES ${parent} (id) ON DELETE CASCADE)`
    );
    await adapter.executeQuery(`INSERT INTO ${parent} (id) VALUES (1)`);
    await adapter.executeQuery(
      `INSERT INTO ${child} (id, parent_id) VALUES (1, 1)`
    );
    file([`DELETE FROM ${parent} WHERE id = 1`], []);
    if (dialect !== "sqlite") {
      const message = await refusedUnchanged(() => migrate(consentFor(parent)));
      expect(message).toContain(child);
      expect((await migrate(consentFor(`${parent},${child}`))).applied).toBe(1);
      return;
    }
    // The runner applies a SQLite file with foreign keys off, even where
    // the connection enforces them, so no cascade fires: consent names the
    // parent alone, and the orphaned child row then refuses the file.
    await adapter.executeQuery("PRAGMA foreign_keys = ON");
    const error = await migrate(consentFor(parent)).then(
      () => undefined,
      (thrown: unknown) => thrown
    );
    expect(NextlyError.is(error)).toBe(true);
    expect((error as NextlyError).publicMessage).toContain(
      "referencing rows that do not exist"
    );
    const { tables } = await databaseState();
    expect([tables[parent], tables[child]]).toEqual([1, 1]);
  }, 180_000);

  it("refuses a column type change until the consent names the column", async () => {
    const change =
      dialect === "postgresql"
        ? [`ALTER TABLE ${posts} ALTER COLUMN summary TYPE varchar(8)`]
        : dialect === "mysql"
          ? [`ALTER TABLE ${posts} MODIFY summary varchar(8)`]
          : [
              `CREATE TABLE __new_${posts} (id integer PRIMARY KEY, title varchar(64), summary integer)`,
              `INSERT INTO __new_${posts} (id, title, summary) SELECT id, title, summary FROM ${posts}`,
              `DROP TABLE ${posts}`,
              `ALTER TABLE __new_${posts} RENAME TO ${posts}`,
            ];
    file(change, []);
    const message = await refusedUnchanged(() =>
      migrate(consentFor(posts.concat(".title")))
    );
    expect(message).toContain("summary");
    // On SQLite the rebuild asks for the column, never for the table.
    expect((await migrate(consentFor(`${posts}.summary`))).applied).toBe(1);
  }, 180_000);

  it.runIf(dialect === "sqlite")(
    "asks no consent for a SQLite rebuild that carries every column and converts none, and names the column one leaves out",
    async () => {
      const rebuild = (columns: string) => [
        `CREATE TABLE __new_${posts} (${columns})`,
        `INSERT INTO __new_${posts} (id, title) SELECT id, title FROM ${posts}`,
        `DROP TABLE ${posts}`,
        `ALTER TABLE __new_${posts} RENAME TO ${posts}`,
      ];
      file(
        [
          `CREATE TABLE __new_${posts} (id integer PRIMARY KEY, title varchar(64), summary varchar(64))`,
          `INSERT INTO __new_${posts} (id, title, summary) SELECT id, title, summary FROM ${posts}`,
          `DROP TABLE ${posts}`,
          `ALTER TABLE __new_${posts} RENAME TO ${posts}`,
        ],
        []
      );
      expect((await migrate()).applied).toBe(1);
      file(rebuild("id integer PRIMARY KEY, title varchar(64)"), []);
      const message = await refusedUnchanged(() =>
        migrate(consentFor(posts.concat(".title")))
      );
      expect(message).toContain("summary");
      expect((await migrate(consentFor(`${posts}.summary`))).applied).toBe(1);
    },
    180_000
  );
});
