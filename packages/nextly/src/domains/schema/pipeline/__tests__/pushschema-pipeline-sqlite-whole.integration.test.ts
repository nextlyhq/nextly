// A SQLite push is all or nothing: the apply runs in one transaction on the connection, opened
// after foreign-key enforcement is switched off (SQLite ignores the pragma inside a transaction),
// so a statement that fails takes back every statement before it. An apply that finds nothing to
// change opens no transaction, so a start that finds the tables as declared sends the statements
// it always has.
//
// Against a real in-memory SQLite database and the real executor, with every statement the
// connection runs recorded.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../../database/index";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { freshPushSchema } from "../fresh-push";
import { PushSchemaPipeline } from "../pushschema-pipeline";
import { readSchemaLockState, withSchemaLock } from "../schema-lock";
import {
  noopClassifier,
  noopMigrationJournal,
  noopNotifier,
  noopPreCleanupExecutor,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../pushschema-pipeline-stubs";

import { lockWorld, sleep, type LockWorld } from "./helpers/schema-lock-world";

const P = "sqlwhole"; // per-file table prefix
const TABLE = `dc_${P}_posts`;

/** The system tables, and the collection's table as the production generator writes it, with one row. */
async function seedPosts(
  sqlite: Database.Database,
  db: ReturnType<typeof drizzle>
): Promise<void> {
  await freshPushSchema("sqlite", db, getDialectTables("sqlite"));
  const schemaService = new DynamicCollectionSchemaService(undefined, "sqlite");
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
}

/** The collection with `fields`, as the desired schema an apply is handed. */
const desiredWith = (fields: Array<{ name: string; type: string }>) => ({
  collections: {
    [`${P}_posts`]: {
      slug: `${P}_posts`,
      tableName: TABLE,
      fields: fields as never,
    },
  },
  singles: {},
  components: {},
});

describe("PushSchemaPipeline — a SQLite push is all or nothing", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle>;
  /** Every statement the connection ran, in order, once recording starts. */
  let sent: string[];
  let recording = false;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    // Recorded at the driver as each prepared statement runs, so the pipeline's own statements and
    // the executor's are seen alike, and a statement prepared more than once counts once per run.
    const prepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = ((source: string) => {
      const statement = prepare(source);
      for (const method of ["run", "all", "get", "iterate"] as const) {
        const real = statement[method].bind(statement) as (
          ...args: unknown[]
        ) => unknown;
        Object.assign(statement, {
          [method]: (...args: unknown[]) => {
            if (recording) sent.push(source);
            return real(...args);
          },
        });
      }
      return statement;
    }) as typeof sqlite.prepare;
    db = drizzle({ client: sqlite });
    await seedPosts(sqlite, db);
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
      adapter: undefined,
    });
  }

  /** Apply the collection with `fields`. */
  const applyWith = (
    fields: Array<{ name: string; type: string }>,
    fails?: RegExp
  ) =>
    pipeline(fails).apply({
      desired: desiredWith(fields),
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
    expect(sqlite.prepare(`SELECT "heading" FROM "${TABLE}"`).all()).toEqual([
      { heading: "Hello" },
    ]);
  });

  it("runs an apply that changes the table in one transaction, foreign keys switched off before it opens", async () => {
    const result = await applyWith([
      { name: "heading", type: "text" },
      { name: "alpha", type: "text" },
    ]);

    expect(result.success).toBe(true);
    expect(columns()).toContain("alpha");
    expect(transactionStatements().map(s => s.trim().toUpperCase())).toEqual([
      "BEGIN IMMEDIATE",
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

// A try whose COMMIT waits for a reader: in rollback-journal mode the commit needs every reader of
// the database gone, and the busy timeout bounds its wait as a try's. The try rolls back whole, so
// the try after it applies the whole change again, and the apply counts only what that try ran.
describe("PushSchemaPipeline — a SQLite try that ended waiting at its commit", () => {
  let dir: string;
  let sqlite: Database.Database;
  let reader: Database.Database;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "nextly-sqlite-whole-"));
    const file = join(dir, "site.db");
    // Rollback-journal mode, better-sqlite3's own, in which a commit waits for readers.
    sqlite = new Database(file);
    reader = new Database(file);
    db = drizzle({ client: sqlite });
    await seedPosts(sqlite, db);
  });

  afterEach(() => {
    if (reader?.inTransaction) reader.exec("ROLLBACK");
    reader?.close();
    sqlite?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("counts nothing of it applied, and the next try applies the whole change", async () => {
    let held = false;
    let freeing: Promise<void> = Promise.resolve();
    const notices: string[] = [];
    // Once the first try's first column is added, a reader opens a read transaction, which the
    // try's commit then waits for past its bound; the reader ends during the pause after it.
    class HoldingAtCommit extends DrizzleStatementExecutor {
      override async executeStatements(
        tx: unknown,
        statements: string[]
      ): Promise<void> {
        await super.executeStatements(tx, statements);
        if (!held && statements.some(statement => /\bADD\b/i.test(statement))) {
          held = true;
          reader.exec("BEGIN");
          reader.prepare(`SELECT count(*) FROM "${TABLE}"`).get();
          freeing = new Promise(resolve => setTimeout(resolve, 1_500)).then(
            () => {
              reader.exec("COMMIT");
            }
          );
        }
      }
    }
    const applied = await new PushSchemaPipeline({
      executor: new HoldingAtCommit("sqlite", db),
      renameDetector: noopRenameDetector,
      classifier: noopClassifier,
      promptDispatcher: noopPromptDispatcher,
      preRenameExecutor: noopPreRenameExecutor,
      preCleanupExecutor: noopPreCleanupExecutor,
      migrationJournal: noopMigrationJournal,
      notifier: noopNotifier,
      adapter: undefined,
    }).apply({
      desired: desiredWith([
        { name: "heading", type: "text" },
        { name: "alpha", type: "text" },
        { name: "beta", type: "text" },
      ]),
      db,
      dialect: "sqlite",
      source: "code",
      promptChannel: "terminal",
      busyTable: {
        bounds: { tryMs: 1_000, totalMs: 20_000 },
        notify: line => notices.push(line),
        change: "schema sync",
      },
    });
    await freeing;

    expect(held, "the reader never held the commit").toBe(true);
    expect(applied.success, JSON.stringify(applied.error)).toBe(true);
    expect(notices, "the tries").toHaveLength(1);
    expect(
      (
        sqlite.prepare(`PRAGMA table_info("${TABLE}")`).all() as Array<{
          name: string;
        }>
      ).map(column => column.name)
    ).toEqual(expect.arrayContaining(["alpha", "beta"]));
    // The last try's two additions, not the first try's too: those rolled back with it.
    expect(applied.statementsExecuted).toBe(2);
    expect(applied.summary).toMatchObject({ added: 2 });
  }, 60_000);
});

// The apply's transaction is the adapter's own, queued behind every other flow's on SQLite's one
// connection: another flow's transaction that starts while the apply's is open waits its turn and
// commits after it, rather than beginning inside it and failing.
describe("PushSchemaPipeline — a SQLite push and another flow's transaction", () => {
  let dir: string;
  let adapter: DrizzleAdapter;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "nextly-sqlite-queue-"));
    const file = join(dir, "site.db");
    const seeding = new Database(file);
    await seedPosts(seeding, drizzle({ client: seeding }));
    seeding.close();
    adapter = createSqliteAdapter({
      url: `file:${file}`,
    }) as unknown as DrizzleAdapter;
    await adapter.connect();
  });

  afterEach(async () => {
    await adapter?.disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lets another flow's transaction wait for the apply's, then commit", async () => {
    const db = adapter.getDrizzle();
    // The other flow is set up here, in the case's own context, so its transaction is another
    // flow's: one started from inside the apply's work would join the apply's transaction instead.
    let reach: () => void = () => undefined;
    const reached = new Promise<void>(resolve => {
      reach = resolve;
    });
    let started = false;
    const other = reached
      .then(() =>
        adapter.transaction(ctx =>
          ctx.execute(
            `INSERT INTO "${TABLE}" ("id", "title", "slug", "heading") VALUES ('2', 'Two', 'two', 'Meanwhile')`
          )
        )
      )
      .then(
        () => "committed",
        (error: unknown) => error
      );
    // Once the apply's first column is added, its transaction open, the other flow starts its
    // transaction; the apply goes on a moment later.
    class OtherFlowMeanwhile extends DrizzleStatementExecutor {
      override async executeStatements(
        tx: unknown,
        statements: string[]
      ): Promise<void> {
        await super.executeStatements(tx, statements);
        if (
          !started &&
          statements.some(statement => /\bADD\b/i.test(statement))
        ) {
          started = true;
          reach();
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }
    const applied = await new PushSchemaPipeline({
      executor: new OtherFlowMeanwhile("sqlite", db),
      renameDetector: noopRenameDetector,
      classifier: noopClassifier,
      promptDispatcher: noopPromptDispatcher,
      preRenameExecutor: noopPreRenameExecutor,
      preCleanupExecutor: noopPreCleanupExecutor,
      migrationJournal: noopMigrationJournal,
      notifier: noopNotifier,
      adapter,
    }).apply({
      desired: desiredWith([
        { name: "heading", type: "text" },
        { name: "alpha", type: "text" },
        { name: "beta", type: "text" },
      ]),
      db,
      dialect: "sqlite",
      source: "code",
      promptChannel: "terminal",
    });

    expect(started, "no other flow's transaction was started").toBe(true);
    expect(applied.success, JSON.stringify(applied.error)).toBe(true);
    expect(await other, "the other flow's transaction").toBe("committed");
    expect(
      await adapter.executeQuery<{ heading: string }>(
        `SELECT "heading" FROM "${TABLE}" ORDER BY "id"`
      )
    ).toEqual([{ heading: "Hello" }, { heading: "Meanwhile" }]);
  }, 60_000);
});

// A push under the schema lock whose transaction runs longer than the lock's lease: the lock's
// renewals wait behind that transaction on the one connection, so the hold is confirmed again
// inside it, before it commits, and the lease extended there commits with the change.
describe("PushSchemaPipeline — a SQLite push longer than the schema lock's lease", () => {
  let world: LockWorld;
  let adapter: DrizzleAdapter;

  beforeEach(async () => {
    world = await lockWorld("sqlite");
    const seeding = new Database(world.url);
    await seedPosts(seeding, drizzle({ client: seeding }));
    seeding.close();
    adapter = await world.connect();
    await world.reset(adapter);
  });

  afterEach(async () => {
    await adapter?.disconnect();
    await world?.dispose();
  });

  it("leaves the lease held once its transaction commits, with no renewal landing meanwhile", async () => {
    const db = adapter.getDrizzle();
    // Every adapter transaction whose work starts while the push's is open and stalled (the
    // lock's renewals, queued behind it) is refused, so none extends the lease: only a
    // confirmation inside the push's own transaction can.
    const real = adapter.transaction.bind(adapter);
    let holdingRenewals = false;
    adapter.transaction = ((
      work: Parameters<DrizzleAdapter["transaction"]>[0],
      options?: Parameters<DrizzleAdapter["transaction"]>[1]
    ) =>
      real(ctx => {
        if (holdingRenewals) {
          return Promise.reject(new Error("held for the case"));
        }
        return work(ctx);
      }, options)) as DrizzleAdapter["transaction"];
    // After the push's last statement, inside its transaction, a stall past the 2 s lease: no
    // statement follows, so the executor's own check before each one does not confirm it again.
    let stalled = false;
    class LongLastStatement extends DrizzleStatementExecutor {
      override async executeStatements(
        tx: unknown,
        statements: string[]
      ): Promise<void> {
        await super.executeStatements(tx, statements);
        if (!stalled && statements.some(statement => /beta/.test(statement))) {
          stalled = true;
          holdingRenewals = true;
          await sleep(2_600);
        }
      }
    }

    let lapsesIn: number | null | undefined;
    const outcome = await withSchemaLock(
      {
        adapter,
        command: "nextly db:sync",
        whenHeld: "refuse",
        leaseSeconds: 2,
        logger: { warn: () => {}, info: () => {} },
      },
      async () => {
        const applied = await new PushSchemaPipeline({
          executor: new LongLastStatement("sqlite", db),
          renameDetector: noopRenameDetector,
          classifier: noopClassifier,
          promptDispatcher: noopPromptDispatcher,
          preRenameExecutor: noopPreRenameExecutor,
          preCleanupExecutor: noopPreCleanupExecutor,
          migrationJournal: noopMigrationJournal,
          notifier: noopNotifier,
          adapter,
        }).apply({
          desired: desiredWith([
            { name: "heading", type: "text" },
            { name: "alpha", type: "text" },
            { name: "beta", type: "text" },
          ]),
          db,
          dialect: "sqlite",
          source: "code",
          promptChannel: "terminal",
        });
        holdingRenewals = false;
        // Read at once, before the next renewal is asked for.
        const state = await readSchemaLockState(adapter);
        lapsesIn =
          state.state === "held" && state.holder.kind === "schema"
            ? state.holder.lapsesInSeconds
            : undefined;
        return applied;
      }
    );

    expect(stalled, "the push never stalled after its last statement").toBe(
      true
    );
    expect(outcome.ran && outcome.value.success).toBe(true);
    // The lease the push's commit carried: a whole lease ahead, not lapsed during the stall.
    expect(
      lapsesIn,
      "the schema lock's lease once the push committed"
    ).toBeGreaterThan(1);
  }, 60_000);
});
