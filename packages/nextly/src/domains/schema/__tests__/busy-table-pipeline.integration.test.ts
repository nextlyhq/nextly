/**
 * A schema pipeline apply that waits for a table another session is using waits in bounded tries,
 * then stops and says so: the apply `db:sync`, the development push, the runtime reload and the
 * Builder's saves share (`PushSchemaPipeline.apply`).
 *
 * On PostgreSQL and MySQL the holder is an open transaction that has read the table, so the
 * apply's ALTER waits for its lock (on MySQL, the table's metadata lock). On SQLite it is an open
 * write transaction on a second connection to the same file, which holds the whole database. The
 * bounds are shortened (one second a try) so the cases run in seconds; the schedule they follow is
 * the default's, which the unit tests pin.
 *
 * PostgreSQL runs each try as one transaction of the plan it made once; MySQL and SQLite, which
 * keep what a try committed, plan each try again from the live database. Either way a question
 * the apply asks is asked once, and the journal records the apply once.
 */
import { randomBytes } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { exportBusyTableBounds } from "../../../cli/commands/db-sync";
import { clearCachedSnapshot } from "../../../init/schema-snapshot-cache";
import type { BusyTableBounds } from "../busy-table/bounds";
import {
  LOCK_DIALECTS,
  lockWorld,
  sleep,
  type LockWorld,
} from "../pipeline/__tests__/helpers/schema-lock-world";
import { RealClassifier } from "../pipeline/classifier/classifier";
import { RealPreCleanupExecutor } from "../pipeline/pre-cleanup/executor";
import {
  PushSchemaPipeline,
  type PipelineResult,
} from "../pipeline/pushschema-pipeline";
import type {
  MigrationJournal,
  PromptDispatcher,
} from "../pipeline/pushschema-pipeline-interfaces";
import {
  noopNotifier,
  noopPreRenameExecutor,
  noopPromptDispatcher,
} from "../pipeline/pushschema-pipeline-stubs";
import { RegexRenameDetector } from "../pipeline/rename-detector";
import type { DesiredSchema } from "../pipeline/types";
import { DrizzleStatementExecutor } from "../services/drizzle-statement-executor";

const PREFIX = `btp_${randomBytes(4).toString("hex")}`;
const BUSY = `${PREFIX}_busy`;
// SQLite's holder writes here: its write lock holds the whole database, whichever table it wrote.
const HOLD = `${PREFIX}_hold`;
const TABLES = [BUSY, HOLD];

const DIALECTS: readonly SupportedDialect[] = LOCK_DIALECTS;

type Fields = DesiredSchema["collections"][string]["fields"];

/** The desired schema of one collection on the busy table, with `fields`. */
function desiredWith(fields: Fields): DesiredSchema {
  return {
    collections: {
      busy: { slug: "busy", tableName: BUSY, fields },
    },
    singles: {},
    components: {},
  };
}

const EARLY = [{ name: "early", type: "text" }] as Fields;
const EARLY_AND_LATE = [
  { name: "early", type: "text" },
  { name: "late", type: "text" },
] as Fields;
// A required column added over a row: the classifier asks what the row gets. Answered "make it
// optional", the column is added nullable, which every dialect adds without drizzle-kit.
// Two columns added, as two statements: the first can commit before the second waits.
const EARLY_AND_TWO_MORE = [
  { name: "early", type: "text" },
  { name: "late", type: "text" },
  { name: "later", type: "text" },
] as Fields;
const EARLY_AND_REQUIRED = [
  { name: "early", type: "text" },
  { name: "needed", type: "text", required: true },
] as Fields;

/** A journal that keeps what it was told, to count the applies it recorded. */
function recordingJournal(): MigrationJournal & {
  starts: number;
  ends: { success: boolean }[];
} {
  const journal = {
    starts: 0,
    ends: [] as { success: boolean }[],
    recordStart() {
      journal.starts += 1;
      return Promise.resolve(`journal-${String(journal.starts)}`);
    },
    recordEnd(_id: string, args: { success: boolean }) {
      journal.ends.push({ success: args.success });
      return Promise.resolve();
    },
  };
  return journal;
}

describe.each(DIALECTS)(
  "a schema pipeline apply that meets a busy table on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let holderAdapter: DrizzleAdapter;
    let free: () => void = () => {};
    let holding: Promise<unknown> = Promise.resolve();
    let notices: string[];
    let databaseName: string | undefined;

    beforeEach(async () => {
      world = await lockWorld(dialect);
      adapter = await world.connect({ poolMax: 6 });
      holderAdapter = await world.connect({ poolMax: 2 });
      await world.reset(adapter, TABLES);
      await adapter.executeQuery(`CREATE TABLE ${HOLD} (id integer)`);
      clearCachedSnapshot();
      notices = [];
      databaseName =
        dialect === "mysql"
          ? String(
              (
                await adapter.executeQuery<{ name: unknown }>(
                  "SELECT DATABASE() AS name"
                )
              )[0]?.name
            )
          : undefined;
      // The table the cases change, created by the pipeline itself with nobody holding it.
      const created = await apply(EARLY, { busyTable: undefined });
      expect(created.success, JSON.stringify(created.error)).toBe(true);
    });

    afterEach(async () => {
      free();
      await holding.catch(() => {});
      await holderAdapter.disconnect();
      await world.reset(adapter, TABLES);
      await adapter.disconnect();
      await world.dispose();
      clearCachedSnapshot();
    });

    /**
     * The second session holds the table until `free()`: on PostgreSQL and MySQL an open
     * transaction that has read it, on SQLite an open write transaction.
     */
    async function holdTheTable(): Promise<void> {
      let held: () => void = () => {};
      const isHeld = new Promise<void>(resolve => {
        held = resolve;
      });
      const freed = new Promise<void>(resolve => {
        free = resolve;
      });
      holding = holderAdapter.transaction(async ctx => {
        await ctx.queryStatement(
          dialect === "sqlite"
            ? sql.raw(`INSERT INTO ${HOLD} (id) VALUES (0) RETURNING id`)
            : sql.raw(`SELECT * FROM ${BUSY}`)
        );
        held();
        await freed;
      });
      await isHeld;
    }

    /**
     * Applies `fields` through a pipeline of the production parts, with `bounds` (none: the
     * pipeline's own, from the environment) and `journal`.
     */
    function apply(
      fields: Fields,
      options: {
        busyTable?: BusyTableBounds;
        journal?: MigrationJournal;
        promptDispatcher?: PromptDispatcher;
      }
    ): Promise<PipelineResult> {
      const db = adapter.getDrizzle();
      const pipeline = new PushSchemaPipeline({
        executor: new DrizzleStatementExecutor(dialect, db),
        renameDetector: new RegexRenameDetector(),
        classifier: new RealClassifier(),
        promptDispatcher: options.promptDispatcher ?? noopPromptDispatcher,
        preRenameExecutor: noopPreRenameExecutor,
        preCleanupExecutor: new RealPreCleanupExecutor(),
        migrationJournal: options.journal ?? recordingJournal(),
        notifier: noopNotifier,
      });
      return pipeline.apply({
        desired: desiredWith(fields),
        db,
        dialect,
        source: "code",
        promptChannel: "terminal",
        ...(databaseName === undefined ? {} : { databaseName }),
        ...(options.busyTable === undefined
          ? {}
          : {
              busyTable: {
                bounds: options.busyTable,
                notify: line => notices.push(line),
                change: "schema sync",
              },
            }),
      });
    }

    async function columnsOf(table: string): Promise<string[]> {
      const rows = await adapter.executeQuery<{ name: string }>(
        dialect === "sqlite"
          ? `SELECT name FROM pragma_table_info('${table}')`
          : `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${table}'`
      );
      return rows.map(row => row.name);
    }

    /** The stop a failed apply carries in its details. */
    function stopOf(result: PipelineResult): { tries: number; change: string } {
      return (
        result.error?.details as {
          logContext: { stop: { tries: number; change: string } };
        }
      ).logContext.stop;
    }

    it("applies once when the holder ends during the second pause, the journal recording one apply", async () => {
      await holdTheTable();
      // Tries at about 0, 2 and 5 seconds (a later try also plans again on MySQL and SQLite):
      // the second pause runs from about 3 to 5.
      const freeing = sleep(4_200).then(() => free());
      const journal = recordingJournal();

      const applied = await apply(EARLY_AND_LATE, {
        busyTable: { tryMs: 1_000, totalMs: 20_000 },
        journal,
      });
      await freeing;

      expect(applied.success, JSON.stringify(applied.error)).toBe(true);
      expect(await columnsOf(BUSY)).toContain("late");
      expect(notices).toHaveLength(2);
      expect(journal.starts).toBe(1);
      expect(journal.ends).toEqual([{ success: true }]);
    });

    it("stops with NEXTLY_TABLE_BUSY when the holder never ends, the column absent", async () => {
      await holdTheTable();
      const journal = recordingJournal();

      const started = Date.now();
      const stopped = await apply(EARLY_AND_LATE, {
        busyTable: { tryMs: 1_000, totalMs: 5_000 },
        journal,
      });
      const elapsed = Date.now() - started;

      expect(stopped.success).toBe(false);
      expect(stopped.error?.code).toBe("NEXTLY_TABLE_BUSY");
      // A try of 1 second and a total of 5 give tries at about 0 and 2 seconds.
      expect(stopOf(stopped).tries).toBe(2);
      expect(elapsed).toBeLessThan(10_000);
      expect(notices).toHaveLength(1);
      expect(await columnsOf(BUSY)).not.toContain("late");
      const message = String(stopped.error?.message);
      expect(message).toContain(
        "`schema sync` stopped: table busy, nothing changed."
      );
      // Named by the change, never by a statement's text.
      expect(message).not.toMatch(/ALTER|ADD COLUMN/i);
      expect(journal.starts).toBe(1);
      expect(journal.ends).toEqual([{ success: false }]);
    });

    it("asks its question once across its tries, and applies the answer", async () => {
      await adapter.executeQuery(
        `INSERT INTO ${BUSY} (id, title, slug, early) VALUES ('r1', 't', 's', 'x')`
      );
      await holdTheTable();
      const freeing = sleep(4_200).then(() => free());
      let asked = 0;
      const makeEveryColumnOptional: PromptDispatcher = {
        dispatch(args) {
          asked += 1;
          return Promise.resolve({
            confirmedRenames: [],
            resolutions: args.events.map(event => ({
              kind: "make_optional" as const,
              eventId: event.id,
            })),
            proceed: true,
          });
        },
      };

      const applied = await apply(EARLY_AND_REQUIRED, {
        busyTable: { tryMs: 1_000, totalMs: 20_000 },
        promptDispatcher: makeEveryColumnOptional,
      });
      await freeing;

      expect(applied.success, JSON.stringify(applied.error)).toBe(true);
      expect(notices).toHaveLength(2);
      // On MySQL and SQLite every try plans again and meets the question again.
      expect(asked).toBe(1);
      expect(await columnsOf(BUSY)).toContain("needed");
    });

    // MySQL bounds a table's metadata lock and a row's lock with two session settings, which
    // outlive the transaction on a pooled connection: a try sets both and puts back the values
    // the session had, never the server's defaults.
    it.runIf(dialect === "mysql")(
      "bounds MySQL's metadata and row lock waits in a try, and puts back the session's own values",
      async () => {
        // One connection, so the session read afterwards is the one the try ran on.
        const single = await world.connect({ poolMax: 1 });
        try {
          await single.executeQuery("SET SESSION lock_wait_timeout = 77");
          await single.executeQuery(
            "SET SESSION innodb_lock_wait_timeout = 33"
          );
          const drizzle = single.getDrizzle() as unknown as {
            transaction: (fn: (tx: unknown) => Promise<unknown>) => unknown;
          };
          // Every setting the try sends on its transaction, as text.
          const settings: string[] = [];
          const db = new Proxy(drizzle, {
            get(target, property) {
              const value: unknown = Reflect.get(target, property, target);
              if (property !== "transaction" || typeof value !== "function") {
                return typeof value === "function" ? value.bind(target) : value;
              }
              return (fn: (tx: unknown) => Promise<unknown>) =>
                (value as typeof drizzle.transaction).call(
                  target,
                  (tx: unknown) =>
                    fn(
                      new Proxy(tx as object, {
                        get(txTarget, txProperty) {
                          const member: unknown = Reflect.get(
                            txTarget,
                            txProperty,
                            txTarget
                          );
                          if (
                            txProperty !== "execute" ||
                            typeof member !== "function"
                          ) {
                            return typeof member === "function"
                              ? member.bind(txTarget)
                              : member;
                          }
                          return (query: { queryChunks?: unknown[] }) => {
                            const text = (query.queryChunks ?? [])
                              .map(chunk =>
                                (chunk as { value?: unknown }).value instanceof
                                Array
                                  ? (chunk as { value: string[] }).value.join(
                                      ""
                                    )
                                  : ""
                              )
                              .join("");
                            if (text.startsWith("SET SESSION"))
                              settings.push(text);
                            return (member as (q: unknown) => unknown).call(
                              txTarget,
                              query
                            );
                          };
                        },
                      })
                    )
                );
            },
          });
          const pipeline = new PushSchemaPipeline({
            executor: new DrizzleStatementExecutor(dialect, db),
            renameDetector: new RegexRenameDetector(),
            classifier: new RealClassifier(),
            promptDispatcher: noopPromptDispatcher,
            preRenameExecutor: noopPreRenameExecutor,
            preCleanupExecutor: new RealPreCleanupExecutor(),
            migrationJournal: recordingJournal(),
            notifier: noopNotifier,
          });
          const applied = await pipeline.apply({
            desired: desiredWith(EARLY_AND_LATE),
            db,
            dialect,
            source: "code",
            promptChannel: "terminal",
            ...(databaseName === undefined ? {} : { databaseName }),
            busyTable: {
              bounds: { tryMs: 1_000, totalMs: 5_000 },
              notify: line => notices.push(line),
              change: "schema sync",
            },
          });
          expect(applied.success, JSON.stringify(applied.error)).toBe(true);

          expect(settings).toEqual([
            "SET SESSION lock_wait_timeout = 2",
            "SET SESSION innodb_lock_wait_timeout = 2",
            "SET SESSION lock_wait_timeout = 77",
            "SET SESSION innodb_lock_wait_timeout = 33",
          ]);
          const [session] = await single.executeQuery<Record<string, unknown>>(
            "SELECT @@SESSION.lock_wait_timeout AS lock_wait, @@SESSION.innodb_lock_wait_timeout AS row_wait"
          );
          expect(Number(session?.lock_wait)).toBe(77);
          expect(Number(session?.row_wait)).toBe(33);
        } finally {
          await single.disconnect();
        }
      }
    );

    // MySQL and SQLite keep what a try committed, and a later try plans only what is left: the
    // apply still reports every statement and every change its tries made, not the last try's.
    it.runIf(dialect !== "postgresql")(
      "reports what an earlier try committed with what the last try applied",
      async () => {
        const db = adapter.getDrizzle();
        const inner = new DrizzleStatementExecutor(dialect, db);
        let freeing: Promise<void> = Promise.resolve();
        let held = false;
        // The hold starts once the first column's statement has committed, so the second waits;
        // it ends during the pause after that try, so the next try applies the rest.
        const executor = {
          executeStatements: async (tx: unknown, statements: string[]) => {
            for (const statement of statements) {
              await inner.executeStatements(tx, [statement]);
              if (!held && /\bADD\b/i.test(statement)) {
                held = true;
                await holdTheTable();
                freeing = sleep(1_500).then(() => free());
              }
            }
          },
        };
        const pipeline = new PushSchemaPipeline({
          executor,
          renameDetector: new RegexRenameDetector(),
          classifier: new RealClassifier(),
          promptDispatcher: noopPromptDispatcher,
          preRenameExecutor: noopPreRenameExecutor,
          preCleanupExecutor: new RealPreCleanupExecutor(),
          migrationJournal: recordingJournal(),
          notifier: noopNotifier,
        });
        const applied = await pipeline.apply({
          desired: desiredWith(EARLY_AND_TWO_MORE),
          db,
          dialect,
          source: "code",
          promptChannel: "terminal",
          ...(databaseName === undefined ? {} : { databaseName }),
          busyTable: {
            bounds: { tryMs: 1_000, totalMs: 20_000 },
            notify: line => notices.push(line),
            change: "schema sync",
          },
        });
        await freeing;

        expect(applied.success, JSON.stringify(applied.error)).toBe(true);
        expect(held).toBe(true);
        expect(notices).toHaveLength(1);
        expect(await columnsOf(BUSY)).toEqual(
          expect.arrayContaining(["late", "later"])
        );
        expect(applied.statementsExecuted).toBe(2);
        expect(applied.summary).toMatchObject({ added: 2 });
      }
    );

    it("takes db:sync's --lock-timeout 1 --lock-timeout-total 5 through the environment it hands them on in", async () => {
      // What `db:sync` does with its flags before the sync starts; the sync's pipeline is then
      // given no bounds of its own, as `performAutoSync` gives it none, and reads them.
      const before = {
        NEXTLY_LOCK_TIMEOUT: process.env.NEXTLY_LOCK_TIMEOUT,
        NEXTLY_LOCK_TIMEOUT_TOTAL: process.env.NEXTLY_LOCK_TIMEOUT_TOTAL,
      };
      try {
        exportBusyTableBounds({ lockTimeout: "1", lockTimeoutTotal: "5" });
        await holdTheTable();

        const started = Date.now();
        const stopped = await apply(EARLY_AND_LATE, {});
        const elapsed = Date.now() - started;

        expect(stopped.error?.code).toBe("NEXTLY_TABLE_BUSY");
        // The defaults (5 seconds a try, 90 in all) would make one try last the whole run.
        expect(stopOf(stopped)).toMatchObject({
          tries: 2,
          change: "schema sync",
        });
        expect(elapsed).toBeLessThan(10_000);
        expect(await columnsOf(BUSY)).not.toContain("late");
      } finally {
        for (const [name, value] of Object.entries(before)) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
    });
  },
  60_000
);
