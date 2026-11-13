/**
 * `nextly repair-columns` against a table another database session is using: its reads of the
 * table's rows and its conversions wait in the bounded, retried tries every schema change takes,
 * one set per table per run, then report the table's columns as unavailable, locked (or, for a
 * column with recorded progress, interrupted) and go on with the other tables.
 *
 * The holders:
 * - for a read: on PostgreSQL an open transaction that changed a column's type of the table; on
 *   MySQL a session holding the table's write lock (`LOCK TABLES … WRITE`); on SQLite a connection
 *   in exclusive locking mode, which keeps even the tables' definitions from being read;
 * - for a conversion: on PostgreSQL and MySQL an open transaction that has read the table; on
 *   SQLite an open write transaction, which holds the whole database.
 *
 * The bounds are shortened to a 1-second try and a 4-second total, which the schedule's pauses
 * (1 s, then 2 s) fit two tries into: one set of tries is two tries, and one notice.
 *
 * On SQLite the holder is another process (`sqlite-database-holder.ts`): SQLite waits for a lock
 * synchronously, so a holder in the run's own process could not let go while the run waits. Its
 * exclusive locking mode is held in a rollback journal: in WAL mode a connection already open keeps
 * its share of the WAL index, which stops another from taking the database whole. Its
 * write-transaction cases run in WAL mode, as Nextly opens SQLite. An apply on SQLite cannot take
 * the schema lock (a write) while another connection holds the database, so there the hold starts
 * once the run holds the lock, as it would for a site whose traffic starts mid-run, and ends just
 * after one set of tries has run out: the run's own release of the schema lock is a write too,
 * which a hold lasting past the run would keep from landing. A SQLite hold "ended after the first
 * try" ends on its own between the first try and the second.
 */
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { installRegistryResolver } from "../../../../cli/utils/registry-resolver";
import { loadDialectTables } from "../../../../database/dialect-tables";

import type { BusyTableBounds } from "../../busy-table/bounds";
import { introspectLiveColumns } from "../../pipeline/diff/introspect-live";
import {
  LOCK_DIALECTS,
  lockWorld,
  startScript,
  type LockWorld,
} from "../../pipeline/__tests__/helpers/schema-lock-world";
import { applyRepairs, type ConversionStepAt } from "../apply";
import { COLUMN_REPAIRS_TABLE, readRepairs } from "../record";
import type { RepairRecord } from "../report";
import { stepName } from "../resume";
import { dryRunReport } from "../run-report";
import type { RepairEntity } from "../types";

import { collection, f, tableTools } from "./apply-fixture";

const PREFIX = `rl${randomBytes(3).toString("hex")}`;
const HELD = `dc_${PREFIX}_held`;
const OTHER = `dc_${PREFIX}_other`;
const CARDS = `comp_${PREFIX}_card`;
const HOLD = `${PREFIX}_hold`;
const TABLES = [HELD, OTHER, CARDS, HOLD, COLUMN_REPAIRS_TABLE];

const BOUNDS: BusyTableBounds = { tryMs: 1_000, totalMs: 4_000 };
/** A SQLite hold that ends on its own once one set of tries has run out. */
const PAST_THE_TRIES_MS = BOUNDS.totalMs + 500;
/** A SQLite hold that ends on its own between the first try (1 s) and the second (at 2 s). */
const AFTER_THE_FIRST_TRY_MS = BOUNDS.tryMs + 300;
/** A hold that lasts until the test ends it. */
const UNTIL_FREED_MS = 120_000;

const SQLITE_HOLDER = fileURLToPath(
  new URL("./sqlite-database-holder.ts", import.meta.url)
);
/** One set of tries under `BOUNDS`: two tries, so one notice. */
const ONE_SET = 2;
/** What a run may take beyond the total: the spec's 5 seconds. */
const SLACK_MS = 5_000;

const TITLE = f({ name: "title", type: "text" });
const LINKS = f({
  name: "links",
  type: "repeater",
  fields: [{ name: "url", type: "text" }],
});
const AUTHOR = f({
  name: "author",
  type: "relationship",
  relationTo: "users",
  required: true,
});
const PRICE = f({
  name: "price",
  type: "number",
  options: { format: "float" },
});
const RELATED = f({
  name: "related",
  type: "relationship",
  relationTo: "users",
  options: { relationType: "manyToMany" },
});

/** The safe differences each dialect can hold on one table: three on a server, one on SQLite. */
function fieldsFor(dialect: SupportedDialect) {
  return dialect === "sqlite" ? [TITLE, AUTHOR] : [TITLE, LINKS, AUTHOR, PRICE];
}

function differingColumns(dialect: SupportedDialect): string[] {
  return dialect === "sqlite" ? ["author"] : ["author", "links", "price"];
}

/** A field group's table, its many-to-many held in one scalar column: D22's list conversion. */
function cardsEntity(): RepairEntity {
  const definition = {
    fields: [RELATED],
    localized: false,
    origin: "fieldGroup" as const,
  };
  return {
    kind: "fieldGroup",
    slug: `${PREFIX}-card`,
    table: CARDS,
    applied: { ...definition, source: "snapshot" },
    configured: definition,
  };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function timed<T>(
  work: () => Promise<T>
): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  const value = await work();
  return { value, ms: Date.now() - started };
}

function recordsOf(
  records: readonly RepairRecord[] | undefined,
  table: string
): RepairRecord[] {
  return (records ?? []).filter(r => r.table === table);
}

describe.each(LOCK_DIALECTS)(
  "repair-columns and a busy table on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let holderAdapter: DrizzleAdapter | null;
    let free: () => Promise<void> = () => Promise.resolve();
    let holding: Promise<unknown> = Promise.resolve();
    let notices: string[];
    /** Called with each notice as it is printed. */
    let onNotice: (line: string) => void = () => {};
    const tools = tableTools(() => adapter, dialect);
    const { q, run } = tools;
    const entities = () => [
      collection(HELD, fieldsFor(dialect)),
      collection(OTHER, fieldsFor(dialect)),
    ];
    const tableWait = {
      bounds: BOUNDS,
      notify: (line: string) => {
        notices.push(line);
        onNotice(line);
      },
    };
    const dryRun = (on: RepairEntity[] = entities()) =>
      dryRunReport({
        adapter,
        dialect,
        entities: on,
        nextlyVersion: "test",
        tableWait,
      });
    /**
     * An apply. `holdUnderLock`, on SQLite, starts the hold once the run holds the schema lock: the
     * run reads its entities then, through the function it is given.
     */
    const apply = (
      on: RepairEntity[] = entities(),
      extra: {
        beforeStep?: (at: ConversionStepAt) => Promise<void>;
        holdUnderLock?: () => Promise<void>;
      } = {}
    ) =>
      applyRepairs({
        adapter,
        dialect,
        entities:
          extra.holdUnderLock === undefined
            ? on
            : async () => {
                await extra.holdUnderLock?.();
                return on;
              },
        nextlyVersion: "test",
        tableWait,
        ...(extra.beforeStep === undefined
          ? {}
          : { beforeStep: extra.beforeStep }),
      });

    async function createTables() {
      for (const table of [HELD, OTHER]) {
        await tools.createTable(table, fieldsFor(dialect));
        if (dialect !== "sqlite") {
          await tools.retype(table, "links", "text");
          await tools.retype(table, "price", "decimal(10,2)");
        }
        await tools.insert(
          table,
          [1, 2, 3].map(i => ({
            id: `p${i}`,
            title: `Post ${i}`,
            author: `u${i}`,
            ...(dialect !== "sqlite"
              ? {
                  links: `[{"url":"https://example.com/${i}"}]`,
                  price: i + 0.25,
                }
              : {}),
          }))
        );
      }
      await run(`CREATE TABLE ${q(HOLD)} (x integer)`);
    }

    /** Every differing column's state and values, to show a run left the table as it was. */
    async function stateOf(table: string) {
      return Promise.all(
        differingColumns(dialect).map(async column => ({
          column,
          state: await tools.columnState(table, column),
          values: await tools.values(table, column),
        }))
      );
    }

    /** A SQLite connection to the world's file, in a rollback journal where `journal` says so. */
    async function connectSqlite(journal: boolean): Promise<DrizzleAdapter> {
      const connected = createSqliteAdapter({
        url: `file:${world.url}`,
        ...(journal ? { wal: false } : {}),
      }) as unknown as DrizzleAdapter;
      await connected.connect();
      await loadDialectTables("sqlite");
      installRegistryResolver(connected);
      return connected;
    }

    /**
     * The run's connection and the holder's, with both tables made. `journal`: SQLite in a rollback
     * journal, for exclusive locking mode; WAL otherwise.
     */
    async function setUp(options: { journal?: boolean } = {}): Promise<void> {
      world = await lockWorld(dialect);
      if (dialect === "sqlite") {
        const journal = options.journal === true;
        adapter = await connectSqlite(journal);
        holderAdapter = await connectSqlite(journal);
      } else {
        adapter = await world.connect({ poolMax: 6 });
        holderAdapter = await world.connect({ poolMax: 2 });
      }
      await world.reset(adapter, TABLES);
      await createTables();
      notices = [];
      onNotice = () => {};
      free = () => Promise.resolve();
      holding = Promise.resolve();
    }

    afterEach(async () => {
      if (world === undefined) return;
      await free();
      await holding.catch(() => {});
      await holderAdapter?.disconnect();
      holderAdapter = null;
      await world.reset(adapter, TABLES);
      await adapter.disconnect();
      await world.dispose();
      world = undefined as unknown as LockWorld;
    });

    /** Another process holding the SQLite database (see the module's comment) for up to `holdMs`. */
    async function holdSqlite(
      mode: "exclusive" | "write",
      holdMs: number
    ): Promise<void> {
      const holder = startScript(SQLITE_HOLDER, [
        world.url,
        mode,
        HOLD,
        String(holdMs),
      ]);
      await holder.printed("held");
      holding = holder.exited;
      keep(async () => {
        // A signal to one that already let go on its own does nothing.
        holder.kill("SIGTERM");
        await holding;
      });
    }

    /** A held thing `release` ends; `free()` ends it once. */
    function keep(release: () => Promise<void>) {
      let done = false;
      free = async () => {
        if (done) return;
        done = true;
        await release();
      };
    }

    /**
     * Another session holds `table` so the run cannot read its rows: PostgreSQL an open transaction
     * that changed a column's type, MySQL `LOCK TABLES … WRITE`, SQLite exclusive locking mode.
     */
    async function holdAgainstReads(
      table: string,
      holdMs = UNTIL_FREED_MS
    ): Promise<void> {
      if (dialect === "sqlite") {
        // Exclusive locking mode keeps the lock its first write takes until the connection closes.
        await holdSqlite("exclusive", holdMs);
        return;
      }
      const holder = holderAdapter;
      if (holder === null) throw new Error("no holder connection");
      let held: () => void = () => {};
      const isHeld = new Promise<void>(resolve => {
        held = resolve;
      });
      let release: () => void = () => {};
      const released = new Promise<void>(resolve => {
        release = resolve;
      });
      holding =
        dialect === "postgresql"
          ? holder
              .transaction(async ctx => {
                await ctx.execute(
                  `ALTER TABLE ${q(table)} ALTER COLUMN ${q("title")} TYPE text`
                );
                held();
                await released;
                // Rolled back: the type change was only ever the hold.
                throw new Error("rolled back");
              })
              .catch(() => undefined)
          : holder.withSession(async session => {
              await session.execute(`LOCK TABLES ${q(table)} WRITE`);
              held();
              await released;
              await session.execute("UNLOCK TABLES");
            });
      await isHeld;
      keep(async () => {
        release();
        await holding;
      });
    }

    /**
     * Another session keeps the run's conversion from getting `table`: on PostgreSQL and MySQL an
     * open transaction that has read it, on SQLite an open write transaction (the whole database).
     */
    async function holdAgainstConversions(
      table: string,
      holdMs = UNTIL_FREED_MS
    ): Promise<void> {
      if (dialect === "sqlite") {
        await holdSqlite("write", holdMs);
        return;
      }
      const holder = holderAdapter;
      if (holder === null) throw new Error("no holder connection");
      let held: () => void = () => {};
      const isHeld = new Promise<void>(resolve => {
        held = resolve;
      });
      let release: () => void = () => {};
      const released = new Promise<void>(resolve => {
        release = resolve;
      });
      holding = holder.transaction(async ctx => {
        await ctx.queryStatement(sql.raw(`SELECT ${q("id")} FROM ${q(table)}`));
        held();
        await released;
      });
      await isHeld;
      keep(async () => {
        release();
        await holding;
      });
    }

    it("a dry run and an apply against a locked table", async () => {
      await setUp({ journal: true });
      const heldBefore = await stateOf(HELD);
      await holdAgainstReads(HELD);

      const dry = await timed(() => dryRun());
      expect(dry.ms).toBeLessThan(BOUNDS.totalMs + SLACK_MS);
      // One set of tries for the held table (on SQLite, for the database): one notice.
      expect(notices).toHaveLength(ONE_SET - 1);
      const dryRecords = dry.value.result?.records;
      if (dialect !== "mysql") {
        // The table's definition could not be read (on SQLite, no table's: the whole database is
        // held; on PostgreSQL, reading it opens the table): each column its fields name, once.
        for (const table of dialect === "sqlite" ? [HELD, OTHER] : [HELD]) {
          const records = recordsOf(dryRecords, table);
          expect(records.map(r => r.column).sort()).toEqual(
            fieldsFor(dialect)
              .map(field => (field as { name: string }).name)
              .sort()
          );
          for (const record of records) {
            expect(record).toMatchObject({
              outcome: "unavailable-locked",
              differenceKnown: false,
              live: null,
              lock: {
                table,
                tries: ONE_SET,
                holder: { wholeDatabase: dialect === "sqlite" },
              },
            });
          }
        }
        for (const record of recordsOf(dryRecords, OTHER)) {
          if (dialect === "postgresql")
            expect(record.outcome).toBe("would-convert");
        }
      } else {
        const held = recordsOf(dryRecords, HELD);
        expect(held.map(r => r.column).sort()).toEqual(
          differingColumns(dialect)
        );
        for (const record of held) {
          expect(record).toMatchObject({
            outcome: "unavailable-locked",
            class: null,
            conversion: null,
            lock: {
              table: HELD,
              tries: ONE_SET,
              holder: { wholeDatabase: false },
            },
          });
        }
        for (const record of recordsOf(dryRecords, OTHER)) {
          expect(record.outcome).toBe("would-convert");
        }
      }
      expect(dry.value.exitCode).toBe(2);

      notices = [];
      if (dialect === "sqlite") await free();
      const applied = await timed(() =>
        apply(
          entities(),
          dialect === "sqlite"
            ? { holdUnderLock: () => holdAgainstReads(HELD, PAST_THE_TRIES_MS) }
            : {}
        )
      );
      expect(applied.ms).toBeLessThan(BOUNDS.totalMs + SLACK_MS);
      expect(notices).toHaveLength(ONE_SET - 1);
      const records = applied.value.result?.records;
      for (const record of recordsOf(records, HELD)) {
        expect(record.outcome).toBe("unavailable-locked");
      }
      for (const record of recordsOf(records, OTHER)) {
        expect(record.outcome).toBe(
          dialect === "sqlite" ? "unavailable-locked" : "converted"
        );
      }
      expect(applied.value.exitCode).toBe(2);
      await free();
      expect(await stateOf(HELD)).toEqual(heldBefore);
    });

    it("a hold that ends after the first try is read on a later try", async () => {
      await setUp({ journal: true });
      // On SQLite the holder ends on its own after the first try; on a server, at the first notice.
      await holdAgainstReads(HELD, AFTER_THE_FIRST_TRY_MS);
      if (dialect !== "sqlite") {
        onNotice = () => {
          void free();
        };
      }
      const dry = await dryRun();
      expect(notices.length).toBeGreaterThanOrEqual(1);
      for (const table of [HELD, OTHER]) {
        const records = recordsOf(dry.result?.records, table);
        expect(records.map(r => r.column).sort()).toEqual(
          differingColumns(dialect)
        );
        for (const record of records) {
          expect(record).toMatchObject({
            outcome: "would-convert",
            lock: null,
          });
        }
      }
    });

    it("a conversion waiting for its table", async () => {
      await setUp();
      const heldBefore = await stateOf(HELD);
      if (dialect !== "sqlite") await holdAgainstConversions(HELD);
      // A third session's read, started during a try, waits no longer than the try.
      let thirdRead: Promise<number> | undefined;
      const third =
        dialect === "sqlite" ? null : await world.connect({ poolMax: 1 });
      onNotice = () => {
        if (third === null || thirdRead !== undefined) return;
        thirdRead = (async () => {
          // The notice comes just before the next try: let that try start waiting first.
          await sleep(200);
          const started = Date.now();
          await third.executeQuery(`SELECT ${q("id")} FROM ${q(HELD)}`);
          return Date.now() - started;
        })();
      };
      try {
        const applied = await timed(() =>
          apply(
            entities(),
            dialect === "sqlite"
              ? {
                  holdUnderLock: () =>
                    holdAgainstConversions(HELD, PAST_THE_TRIES_MS),
                }
              : {}
          )
        );
        expect(applied.ms).toBeLessThan(BOUNDS.totalMs + SLACK_MS);
        // One set of tries for the held table, however many of its columns wait.
        expect(notices).toHaveLength(ONE_SET - 1);
        const records = applied.value.result?.records;
        const held = recordsOf(records, HELD);
        expect(held.map(r => r.column).sort()).toEqual(
          differingColumns(dialect)
        );
        for (const record of held) {
          expect(record).toMatchObject({
            outcome: "unavailable-locked",
            lock: { table: HELD, tries: ONE_SET },
          });
        }
        for (const record of recordsOf(records, OTHER)) {
          // SQLite's one writer holds every table: the other table takes no try of its own.
          expect(record.outcome).toBe(
            dialect === "sqlite" ? "unavailable-locked" : "converted"
          );
        }
        expect(applied.value.exitCode).toBe(2);
        if (thirdRead !== undefined) {
          expect(await thirdRead).toBeLessThan(BOUNDS.tryMs + 1_000);
        } else {
          expect(dialect).toBe("sqlite");
        }
        await free();
        expect(await stateOf(HELD)).toEqual(heldBefore);
      } finally {
        await third?.disconnect();
      }
    });

    it("a conversion whose table is freed after the first try converts with its values read back equal", async () => {
      await setUp();
      const before = await stateOf(HELD);
      if (dialect !== "sqlite") {
        await holdAgainstConversions(HELD);
        onNotice = () => {
          void free();
        };
      }
      const document = await apply(
        entities(),
        dialect === "sqlite"
          ? {
              holdUnderLock: () =>
                holdAgainstConversions(HELD, AFTER_THE_FIRST_TRY_MS),
            }
          : {}
      );
      expect(notices.length).toBeGreaterThanOrEqual(1);
      for (const table of [HELD, OTHER]) {
        for (const record of recordsOf(document.result?.records, table)) {
          expect(record.outcome).toBe("converted");
        }
      }
      const after = await stateOf(HELD);
      for (const [index, column] of after.entries()) {
        const was = before[index];
        expect(column.column).toBe(was.column);
        // Each value as its new type reads it back: JSON parsed, numbers as numbers.
        const read = (value: unknown) =>
          typeof value === "string" && /^[[{]/.test(value)
            ? JSON.parse(value)
            : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)
              ? Number(value)
              : value;
        expect(
          Object.fromEntries(
            Object.entries(column.values).map(([k, v]) => [k, read(v)])
          )
        ).toEqual(
          Object.fromEntries(
            Object.entries(was.values).map(([k, v]) => [k, read(v)])
          )
        );
      }
    });

    if (dialect === "mysql") {
      it("a D22 conversion stopped after its first step, on a locked table, stays interrupted under a dry run and an apply", async () => {
        await setUp();
        await run(
          `CREATE TABLE ${q(CARDS)} (${q("id")} varchar(36) PRIMARY KEY, ${q("related")} varchar(36))`
        );
        await run(
          `INSERT INTO ${q(CARDS)} VALUES ('r1', '6f1c1f3a-2b7e-4c2a-9d8e-0a1b2c3d4e5f'), ('r2', NULL)`
        );
        // The first step (widen) commits; the run stops before the second.
        const stopped = await apply([cardsEntity()], {
          beforeStep: async at => {
            if (at.table === CARDS && at.step === 1) throw new Error("stopped");
          },
        });
        expect(stopped.exitCode).toBe(3);
        const recorded = await readRepairs(adapter.getDrizzle(), dialect);
        const cardsBefore = await tools.columnState(CARDS, "related");

        await holdAgainstReads(CARDS);
        for (const runOnce of [
          () => dryRun([cardsEntity(), ...entities()]),
          () => apply([cardsEntity(), ...entities()]),
        ]) {
          notices = [];
          const document = await timed(runOnce);
          expect(document.ms).toBeLessThan(BOUNDS.totalMs + SLACK_MS);
          const [record] = recordsOf(document.value.result?.records, CARDS);
          expect(record).toMatchObject({
            outcome: "interrupted",
            progress: { recordedStep: stepName(1, 3), liveStep: null },
            lock: { table: CARDS, tries: ONE_SET },
          });
          // The other tables are reported, and under an apply converted, as with no lock.
          for (const r of recordsOf(document.value.result?.records, OTHER)) {
            expect(["would-convert", "converted"]).toContain(r.outcome);
          }
          expect(document.value.exitCode).toBe(3);
          expect(await tools.columnState(CARDS, "related")).toEqual(
            cardsBefore
          );
          // Its record is left exactly as it was.
          const cardsRow = (
            await readRepairs(adapter.getDrizzle(), dialect)
          ).find(row => row.table === CARDS);
          expect(cardsRow).toEqual(recorded.find(row => row.table === CARDS));
        }
      });
    } else {
      it("no recorded progress arises", async () => {
        await setUp();
        // A conversion stopped part-way commits nothing here: one transaction rolls it all back.
        const document = await apply(entities(), {
          beforeStep: async at => {
            if (at.table === HELD) throw new Error("stopped");
          },
        });
        for (const record of recordsOf(document.result?.records, HELD)) {
          expect(record.outcome).toBe("failed");
        }
        const rows = await readRepairs(adapter.getDrizzle(), dialect);
        expect(rows.filter(row => row.state === "in-progress")).toEqual([]);
      });
    }

    it("the catalog read does not wait for a table another session holds", async () => {
      // Why MySQL reads its tables' definitions once, outside the tries: only its rows wait. On
      // PostgreSQL the read opens each table, so each is read in its own tries.
      if (dialect !== "mysql") return;
      await setUp();
      await holdAgainstReads(HELD);
      const read = await timed(() =>
        Promise.race([
          introspectLiveColumns(adapter.getDrizzle(), dialect, [HELD, OTHER]),
          sleep(3_000).then(() => "waited" as const),
        ])
      );
      expect(read.value).not.toBe("waited");
    });
  }
);
