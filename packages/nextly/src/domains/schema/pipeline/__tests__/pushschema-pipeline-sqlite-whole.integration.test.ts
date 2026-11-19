// A SQLite push is all or nothing: the apply runs in one transaction on the connection, opened
// after foreign-key enforcement is switched off (SQLite ignores the pragma inside a transaction),
// so a statement that fails takes back every statement before it. An apply that finds nothing to
// change opens no transaction, so a start that finds the tables as declared sends the statements
// it always has.
//
// Against a real in-memory SQLite database and the real executor, with every statement the
// connection is asked to prepare recorded.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../../database/index";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { freshPushSchema } from "../fresh-push";
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

const P = "sqlwhole"; // per-file table prefix
const TABLE = `dc_${P}_posts`;

describe("PushSchemaPipeline — a SQLite push is all or nothing", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle>;
  /** Every statement the connection was asked to prepare, in order, once recording starts. */
  let sent: string[];
  let recording = false;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    // Recorded at the driver, so the pipeline's own statements and the executor's are seen alike.
    const prepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = ((source: string) => {
      if (recording) sent.push(source);
      return prepare(source);
    }) as typeof sqlite.prepare;
    db = drizzle({ client: sqlite });
    await freshPushSchema("sqlite", db, getDialectTables("sqlite"));
    // The collection's table as the production generator writes it, with one row.
    const schemaService = new DynamicCollectionSchemaService(
      undefined,
      "sqlite"
    );
    for (const statement of schemaService
      .generateMigrationSQL(TABLE, [{ name: "heading", type: "text" }], {
        localized: false,
      })
      .split("--> statement-breakpoint")) {
      const clean = statement
        .split("\n")
        .filter(line => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      if (clean) sqlite.exec(clean);
    }
    sqlite
      .prepare(
        `INSERT INTO "${TABLE}" ("id", "title", "slug", "heading") VALUES ('1', 'One', 'one', 'Hello')`
      )
      .run();
    sent = [];
    recording = true;
  });

  afterEach(() => {
    recording = false;
    sqlite?.close();
  });

  /** The pipeline, its executor failing the first statement matching `fails`, where given. */
  function pipeline(fails?: RegExp) {
    class Failing extends DrizzleStatementExecutor {
      override async executeStatements(
        tx: unknown,
        statements: string[]
      ): Promise<void> {
        for (const statement of statements) {
          if (fails?.test(statement) === true) {
            throw new Error(`injected failure: ${statement}`);
          }
          await super.executeStatements(tx, [statement]);
        }
      }
    }
    return new PushSchemaPipeline({
      executor: new Failing("sqlite", db),
      renameDetector: noopRenameDetector,
      classifier: noopClassifier,
      promptDispatcher: noopPromptDispatcher,
      preRenameExecutor: noopPreRenameExecutor,
      preCleanupExecutor: noopPreCleanupExecutor,
      migrationJournal: noopMigrationJournal,
      notifier: noopNotifier,
    });
  }

  /** Apply the collection with `fields`. */
  const applyWith = (
    fields: Array<{ name: string; type: string }>,
    fails?: RegExp
  ) =>
    pipeline(fails).apply({
      desired: {
        collections: {
          [`${P}_posts`]: {
            slug: `${P}_posts`,
            tableName: TABLE,
            fields: fields as never,
          },
        },
        singles: {},
        components: {},
      },
      db,
      dialect: "sqlite",
      source: "code",
      promptChannel: "terminal",
    });

  const columns = () =>
    (
      sqlite.prepare(`PRAGMA table_info("${TABLE}")`).all() as Array<{
        name: string;
      }>
    )
      .map(column => column.name)
      .sort();

  /** The statements sent that open, end or undo a transaction. */
  const transactionStatements = () =>
    sent.filter(statement => /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(statement));

  it("takes back every statement of an apply when a later one fails", async () => {
    const before = columns();

    const result = await applyWith(
      [
        { name: "heading", type: "text" },
        { name: "alpha", type: "text" },
        { name: "beta", type: "text" },
      ],
      /ADD\s+(COLUMN\s+)?[`"]?beta[`"]?/i
    ).catch((error: unknown) => ({ success: false, error }));

    expect(result.success, "the failed apply was reported as applied").toBe(
      false
    );
    // `alpha`'s statement ran before `beta`'s failed, and was taken back with it.
    expect(
      sent.some(statement => /alpha/.test(statement)),
      "no statement adding `alpha` ran before `beta`'s"
    ).toBe(true);
    expect(columns()).toEqual(before);
    // The row is as it was.
    expect(
      sqlite.prepare(`SELECT "heading" FROM "${TABLE}"`).all()
    ).toEqual([{ heading: "Hello" }]);
  });

  it("runs an apply that changes the table in one transaction, foreign keys switched off before it opens", async () => {
    const result = await applyWith([
      { name: "heading", type: "text" },
      { name: "alpha", type: "text" },
    ]);

    expect(result.success).toBe(true);
    expect(columns()).toContain("alpha");
    expect(transactionStatements().map(s => s.trim().toUpperCase())).toEqual([
      "BEGIN",
      "COMMIT",
    ]);
    const switchedOff = sent.findIndex(statement =>
      /PRAGMA\s+foreign_keys\s*=\s*OFF/i.test(statement)
    );
    const opened = sent.findIndex(statement => /^\s*BEGIN\b/i.test(statement));
    expect(switchedOff, "foreign keys were never switched off").toBeGreaterThan(
      -1
    );
    expect(switchedOff).toBeLessThan(opened);
  });

  it("opens no transaction for an apply that finds nothing to change", async () => {
    const before = columns();

    const result = await applyWith([{ name: "heading", type: "text" }]);

    expect(result.success).toBe(true);
    expect(columns()).toEqual(before);
    expect(transactionStatements()).toEqual([]);
  });
});
