/**
 * What a Schema Builder save and `db:sync` each say of one column change over the same stored
 * values, pinned per dialect: the class (safe, lossy or blocked) and the rows named. Where they
 * agree they give one verdict; where they differ, on purpose, the table names both, so a drift of
 * either rule fails here. The Builder's
 * comes from the per-value judge its save asks before anything runs (`judgeFieldTypeChanges`);
 * `db:sync`'s from the repair rule the real pipeline hands its classifier for a code-first apply
 * (`judgeConversion`), captured as the classifier receives it.
 *
 * Over the changes both rules judge: text to number, a long text to a short one, a number's width,
 * text to a checkbox and text to a date (`CASES`, which says why each difference is there).
 *
 * Against real databases: SQLite in memory, and PostgreSQL and MySQL where their URLs are set,
 * each in a table of this file's own prefix.
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { createPool, type Pool as MysqlPool } from "mysql2";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../../database/index";
import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db";
import { clearCachedSnapshot } from "../../../../init/schema-snapshot-cache";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import type { ConversionJudgement } from "../../value-conversion/types";
import {
  fieldTypeChangesOf,
  judgeFieldTypeChanges,
} from "../../value-conversion/type-change/field-type-changes";
import type { TypeChangeJudge } from "../classifier/judge-type-change";
import type { Operation } from "../diff/types";
import { freshPushSchema } from "../fresh-push";
import { PushSchemaPipeline } from "../pushschema-pipeline";
import {
  noopMigrationJournal,
  noopNotifier,
  noopPreCleanupExecutor,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../pushschema-pipeline-stubs";
import type { DesiredSchema } from "../types";

interface Target {
  db: unknown;
  dialect: SupportedDialect;
  /** MySQL's pushSchema needs it. */
  databaseName?: string;
}

/** A verdict as the table pins it: the class, and the rows a reason that is not safe names. */
interface Verdict {
  class: "safe" | "lossy" | "blocked";
  rows: string[];
}

const v = (cls: Verdict["class"], ...rows: string[]): Verdict => ({
  class: cls,
  rows,
});

/** Each rule's verdict on one dialect; `sync` null where db:sync plans no type change at all. */
interface Pinned {
  builder: Verdict;
  sync: Verdict | null;
}

/** One column change, the values its column holds by row id, and each rule's verdict per dialect. */
interface ParityCase {
  name: string;
  from: Record<string, unknown>;
  to: Record<string, unknown>;
  values: Record<string, string>;
  pinned: Record<SupportedDialect, Pinned>;
}

const agree = (verdict: Verdict): Pinned => ({
  builder: verdict,
  sync: verdict,
});

/**
 * Where the two differ, the reason is one of these, each on purpose:
 *
 * - On SQLite no conversion runs and a column keeps any value, so db:sync's column rule finds every
 *   value kept, and plans no type change at all where the column's storage is the same (a long text
 *   to a short one); the Builder's judge reads each value as the new field reads it, and a "maybe"
 *   is no checkbox, a "nope" no date, 1.5 no whole number, and a text over the field's length one
 *   its own validation refuses.
 * - On PostgreSQL and MySQL, text to an integer, a boolean or a timestamp, and a fraction to an
 *   integer, are no conversion Nextly runs, so db:sync's rule blocks the pair whatever the values
 *   and names no row; the Builder's judge reads each value, so a column whose every value converts
 *   goes ahead, and one holding a value that does not names its row.
 */
const CASES: ParityCase[] = [
  {
    name: "text to number, every value a number",
    from: { type: "text" },
    to: { type: "number" },
    values: { r1: "5", r2: "12" },
    pinned: {
      sqlite: agree(v("safe")),
      postgresql: { builder: v("safe"), sync: v("blocked") },
      mysql: { builder: v("safe"), sync: v("blocked") },
    },
  },
  {
    name: "text to number, a value no number",
    from: { type: "text" },
    to: { type: "number" },
    values: { r1: "5", r2: "abc" },
    pinned: {
      sqlite: agree(v("lossy", "r2")),
      postgresql: { builder: v("lossy", "r2"), sync: v("blocked") },
      mysql: { builder: v("lossy", "r2"), sync: v("blocked") },
    },
  },
  {
    name: "a long text to a short one, a value too long",
    from: { type: "textarea" },
    to: {
      type: "text",
      options: { variant: "short" },
      validation: { maxLength: 5 },
    },
    values: { r1: "abc", r2: "abcdefgh" },
    pinned: {
      sqlite: { builder: v("lossy", "r2"), sync: null },
      postgresql: agree(v("blocked", "r2")),
      mysql: agree(v("blocked", "r2")),
    },
  },
  {
    name: "a number with fractions to a whole one, a fraction held",
    from: { type: "number", options: { format: "float" } },
    to: { type: "number" },
    values: { r1: "2", r2: "1.5" },
    pinned: {
      sqlite: { builder: v("blocked", "r2"), sync: v("safe") },
      postgresql: { builder: v("blocked", "r2"), sync: v("blocked") },
      mysql: { builder: v("blocked", "r2"), sync: v("blocked") },
    },
  },
  {
    name: "text to a checkbox, a value no boolean",
    from: { type: "text" },
    to: { type: "checkbox" },
    values: { r1: "true", r2: "maybe" },
    pinned: {
      sqlite: { builder: v("lossy", "r2"), sync: v("safe") },
      postgresql: { builder: v("lossy", "r2"), sync: v("blocked") },
      mysql: { builder: v("lossy", "r2"), sync: v("blocked") },
    },
  },
  {
    name: "text to a date, a value no date",
    from: { type: "text" },
    to: { type: "date" },
    values: { r1: "2024-01-02T03:04:05.000Z", r2: "nope" },
    pinned: {
      sqlite: { builder: v("lossy", "r2"), sync: v("safe") },
      postgresql: { builder: v("lossy", "r2"), sync: v("blocked") },
      mysql: { builder: v("lossy", "r2"), sync: v("blocked") },
    },
  },
];

const fieldsOf = (value: Record<string, unknown>) => [
  { name: "title", type: "text" },
  { name: "value", ...value },
];

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

/** A judgement as the table pins it: its class, and the row ids its reasons that are not safe name. */
function verdictOf(judgement: ConversionJudgement): Verdict {
  return {
    class: judgement.class,
    rows: judgement.reasons
      .filter(reason => reason.class !== "safe")
      .flatMap(reason => reason.rows?.first ?? [])
      .map(key => ("id" in key ? String(key.id) : JSON.stringify(key)))
      .sort(),
  };
}

/** The Builder save's verdict: the judge its precondition asks, over the column's values. */
async function builderVerdict(
  target: Target,
  table: string,
  parity: ParityCase
) {
  const changes = fieldTypeChangesOf({
    previous: fieldsOf(parity.from) as FieldDefinition[],
    next: fieldsOf(parity.to) as FieldDefinition[],
    dialect: target.dialect,
    builtBy: "collection",
  });
  expect(changes.map(change => change.to.name)).toEqual(["value"]);
  const [judged] = await judgeFieldTypeChanges({
    db: target.db,
    dialect: target.dialect,
    builtBy: "collection",
    table,
    changes,
  });
  return verdictOf(judged.result.judgement);
}

/** Stops the apply once the classifier has been handed what it judges. */
class Captured extends Error {}

/**
 * `db:sync`'s verdict: the pipeline's code-first apply of the same change, its classifier capturing
 * the judgement the repair rule gives the column's type change, then stopping the apply.
 */
async function syncVerdict(target: Target, table: string, parity: ParityCase) {
  const desired: DesiredSchema = {
    collections: {
      [table]: {
        slug: table,
        tableName: table,
        fields: fieldsOf(parity.to) as never,
        builderOwned: true,
      },
    },
    singles: {},
    components: {},
  };
  let judged: ConversionJudgement | undefined;
  const result = await new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor(target.dialect, target.db),
    renameDetector: noopRenameDetector,
    classifier: {
      classify: async (args: { operations: Operation[] }) => {
        const judge = (args as { judgeConversion?: TypeChangeJudge })
          .judgeConversion;
        for (const op of args.operations) {
          if (op.type !== "change_column_type" || judge === undefined) continue;
          judged = (await judge(op))?.judgement;
        }
        throw new Captured("captured");
      },
    },
    promptDispatcher: noopPromptDispatcher,
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: noopPreCleanupExecutor,
    migrationJournal: noopMigrationJournal,
    notifier: noopNotifier,
  }).apply({
    desired,
    db: target.db,
    dialect: target.dialect,
    source: "code",
    promptChannel: "terminal",
    ...(target.databaseName !== undefined
      ? { databaseName: target.databaseName }
      : {}),
  });
  expect(result.success).toBe(false);
  return judged === undefined ? null : verdictOf(judged);
}

/** Each case, given a fresh table holding its values and the database it is on. */
function cases(
  open: () => { target: Target; table: string },
  create: (parity: ParityCase) => Promise<void>
) {
  for (const parity of CASES) {
    it(`gives each rule's pinned verdict: ${parity.name}`, async () => {
      const { target, table } = open();
      await create(parity);
      const pinned = parity.pinned[target.dialect];

      const measured = {
        builder: await builderVerdict(target, table, parity),
        sync: await syncVerdict(target, table, parity),
      };

      expect(measured).toEqual(pinned);
      // Where the table says the two agree, they give one verdict.
      if (JSON.stringify(pinned.builder) === JSON.stringify(pinned.sync)) {
        expect(measured.builder).toEqual(measured.sync);
      }
    });
  }
}

describe("a Builder save's and db:sync's verdicts on a column change (sqlite)", () => {
  const table = "dc_tcp_items";
  let sqlite: Database.Database;
  let target: Target;

  beforeEach(async () => {
    clearCachedSnapshot();
    sqlite?.close();
    sqlite = new Database(":memory:");
    const db = drizzleSqlite({ client: sqlite });
    target = { db, dialect: "sqlite" };
    await freshPushSchema("sqlite", db, getDialectTables("sqlite"));
  });
  afterAll(() => {
    clearCachedSnapshot();
    sqlite?.close();
  });

  cases(
    () => ({ target, table }),
    parity => {
      for (const statement of builderStatements(
        "sqlite",
        table,
        fieldsOf(parity.from)
      )) {
        sqlite.exec(statement);
      }
      const insert = sqlite.prepare(
        `INSERT INTO "${table}" (id, title, slug, value) VALUES (?, 'T', ?, ?)`
      );
      for (const [id, value] of Object.entries(parity.values)) {
        insert.run(id, id, value);
      }
      return Promise.resolve();
    }
  );
});

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
    `a Builder save's and db:sync's verdicts on a column change (${server.dialect})`,
    () => {
      const table = `dc_${context.prefix}_tcp_items`;
      const quote = (name: string) =>
        server.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      let connection: ReturnType<(typeof server)["open"]>;

      beforeAll(() => {
        connection = server.open(context.url ?? "");
      });
      beforeEach(async () => {
        clearCachedSnapshot();
        await connection.run(`DROP TABLE IF EXISTS ${quote(table)}`);
      });
      afterAll(async () => {
        await connection.run(`DROP TABLE IF EXISTS ${quote(table)}`);
        await connection.close();
        clearCachedSnapshot();
      });

      cases(
        () => ({ target: connection.target, table }),
        async parity => {
          for (const statement of builderStatements(
            server.dialect,
            table,
            fieldsOf(parity.from)
          )) {
            await connection.run(statement);
          }
          for (const [id, value] of Object.entries(parity.values)) {
            await connection.run(
              `INSERT INTO ${quote(table)} (id, title, slug, value) VALUES ('${id}', 'T', '${id}', '${value}')`
            );
          }
        }
      );
    }
  );
}
