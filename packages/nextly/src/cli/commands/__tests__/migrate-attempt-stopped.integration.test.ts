/**
 * What a migration run stopped part-way leaves behind, with the process killed, or its
 * connection dropped, at one statement of a migration file.
 *
 * - A file run in a transaction on PostgreSQL or SQLite leaves nothing: no schema change, no row
 *   change, no ledger row and no registry row. The schema lock lapses, and the next
 *   `nextly migrate` applies the file whole.
 * - Where statements commit as they run (MySQL, or a file marked to run outside a transaction),
 *   the attempt is recorded before the file's first statement and its outcome only after its
 *   last, so a stop in between leaves an attempt with no outcome, and the migration's state is
 *   what it was before the attempt. The same holds for `migrate:down` running a down section.
 *
 * The run is a real second process (`helpers/migration-run-child.ts`), because killing one is the
 * only honest way to show what a dead run leaves behind. Each test runs on a database of its own,
 * because each runs whole commands.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  hasUnresolvedAttempt,
  migrationState,
} from "../../../domains/schema/events/migration-state";
import {
  SchemaEventsRepository,
  type SchemaEventRow,
} from "../../../domains/schema/events/schema-events-repository";
import { ensureSchemaEventsTable } from "../../../domains/schema/events/schema-events-ddl";
import {
  LOCK_DIALECTS,
  lockWorld,
  startScript,
  type Holder,
  type LockWorld,
} from "../../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import { NextlyError } from "../../../errors/nextly-error";
import { createLogger } from "../../utils/logger";
import { migrateCore } from "../migrate";

const CHILD = join(__dirname, "helpers", "migration-run-child.ts");
const NAME = "20261029_000001_attempt_stopped";
const FILE = `${NAME}.sql`;
/** The lease the stopped run holds the lock for: short, so a killed run's lock lapses soon. */
const LEASE_SECONDS = 3;
/** Every table a lock keeps its row in: not part of what a run leaves behind. */
const LOCK_TABLES = new Set([
  "nextly_schema_lock",
  "nextly_field_group_lock",
  "nextly_migrate_lock",
]);

const logger = createLogger({ quiet: true });

/** What a stopped run is compared on: every table with its row count, and the ledger. */
interface DatabaseState {
  tables: Record<string, number>;
  ledger: Array<Pick<SchemaEventRow, "eventType" | "status" | "filename">>;
}

describe.each(LOCK_DIALECTS)(
  "a migration run stopped part-way on %s",
  dialect => {
    const P = `mas_${randomBytes(3).toString("hex")}`;
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let migrationsDir: string;
    let child: Holder | undefined;

    beforeEach(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-attempt-stopped-"));
      // Nextly's own tables first, so the file is the only thing a run has left to do.
      await migrate();
    }, 120_000);

    afterEach(async () => {
      if (child !== undefined) {
        child.kill("SIGKILL");
        await child.exited;
        child = undefined;
      }
      await adapter.disconnect();
      rmSync(migrationsDir, { recursive: true, force: true });
      await world.dispose();
    }, 60_000);

    /** `nextly migrate`'s core in this process, waiting out a lapsing lock. */
    function migrate() {
      return migrateCore({
        extensionSchema: undefined,
        dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir,
        logger,
        lockMode: "wait",
        lockWaitMs: 30_000,
        ensureLedger: () => ensureSchemaEventsTable(adapter),
      });
    }

    /** The migration file in the shape `migrate:create` writes, maybe marked. */
    function writeFile(up: string[], down: string[], marked: boolean): void {
      const statements = (list: string[]) => list.map(s => `${s};`).join("\n");
      writeFileSync(
        join(migrationsDir, FILE),
        `${marked ? "-- nextly:no-transaction\n" : ""}-- Migration: ${NAME}\n\n-- UP\n${statements(up)}\n\n-- DOWN\n${statements(down)}\n`,
        "utf8"
      );
    }

    async function databaseState(): Promise<DatabaseState> {
      const tables: Record<string, number> = {};
      for (const name of (await adapter.listTables()).sort()) {
        if (LOCK_TABLES.has(name)) continue;
        const rows = await adapter.executeQuery<{ n: unknown }>(
          `SELECT COUNT(*) AS n FROM ${name}`
        );
        tables[name] = Number(rows[0]?.n ?? 0);
      }
      const ledger = (await ledgerRows()).map(row => ({
        eventType: row.eventType,
        status: row.status,
        filename: row.filename,
      }));
      return { tables, ledger };
    }

    /** Every ledger row, oldest first. */
    async function ledgerRows(): Promise<SchemaEventRow[]> {
      const repo = new SchemaEventsRepository(adapter.getDrizzle(), dialect);
      const rows = [
        ...(await repo.listFileApplies()),
        ...(await repo.listFailedRollbacks()),
      ];
      return rows.sort(
        (a, b) => +new Date(a.startedAt) - +new Date(b.startedAt)
      );
    }

    /** The file's own ledger rows. */
    async function fileRows(): Promise<SchemaEventRow[]> {
      return (await ledgerRows()).filter(row => row.filename === FILE);
    }

    /** Starts the second process, and resolves once it stands at `watched`. */
    async function runUntil(
      command: "up" | "down",
      when: "before" | "after",
      watched: string
    ): Promise<Holder> {
      child = startScript(CHILD, [
        dialect,
        world.url,
        migrationsDir,
        command,
        when,
        watched,
        String(LEASE_SECONDS),
      ]);
      await child.printed("paused");
      return child;
    }

    async function kill(run: Holder): Promise<void> {
      run.kill("SIGKILL");
      await run.exited;
      child = undefined;
    }

    /** Drops the stopped run's connection, lets it go on, and waits for it to end. */
    async function dropConnection(run: Holder): Promise<void> {
      if (dialect === "postgresql") {
        // Its transaction's connection: the one session idle in a transaction.
        await adapter.executeQuery(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction' AND pid <> pg_backend_pid()"
        );
      } else {
        run.send("drop");
        await run.printed("dropped");
      }
      run.send("continue");
      await run.exited;
      child = undefined;
      // The run did not finish: it reported the failure, or the dropped
      // connection's error ended the process (PostgreSQL's driver raises it
      // outside the statement that was waiting).
      expect(run.lines()).not.toContain("ended ok");
      expect(await run.exited).not.toBe(0);
    }

    /** The error a run refused with, or undefined when it ran. */
    async function refusal(work: Promise<unknown>): Promise<unknown> {
      return work.then(
        () => undefined,
        (error: unknown) => (NextlyError.is(error) ? error.code : error)
      );
    }

    it("keeps every attempt status in the ledger an existing install created", async () => {
      // The ledger as the current release creates it (`beforeEach` ran `nextly
      // migrate`): the new status is a value in its existing status column, which
      // is text on PostgreSQL and SQLite and VARCHAR(32) on MySQL.
      const repo = new SchemaEventsRepository(adapter.getDrizzle(), dialect);
      const applied = await repo.recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename: FILE,
      });
      await repo.markApplied(applied, {});
      await repo.insertEvent({
        eventType: "file_rollback",
        status: "nothing_applied",
        source: "cli-migrate",
        filename: FILE,
        endedAt: new Date(),
      });
      const rows = await fileRows();
      expect(rows.map(row => [row.eventType, row.status])).toEqual([
        ["file_apply", "applied"],
        ["file_rollback", "nothing_applied"],
      ]);
      // A down section that ended with nothing applied leaves it applied and resolved.
      expect(migrationState(rows)).toBe("applied");
      expect(hasUnresolvedAttempt(rows)).toBe(false);
    }, 120_000);

    const inTransaction = dialect !== "mysql";

    describe.runIf(inTransaction)("a file run in a transaction", () => {
      const seed = `${P}_seed`;
      const created = `${P}_two`;
      const firstStatement = `INSERT INTO ${seed}`;

      beforeEach(async () => {
        await adapter.executeQuery(`CREATE TABLE ${seed} (id integer)`);
        // A row change first, then a schema change: both must be left undone.
        writeFile(
          [
            `INSERT INTO ${seed} (id) VALUES (1)`,
            `CREATE TABLE ${created} (id integer)`,
          ],
          [`DROP TABLE ${created}`, `DELETE FROM ${seed}`],
          false
        );
      }, 60_000);

      async function expectAppliedWhole(): Promise<void> {
        // Waits for the stopped run's lock to lapse, then applies the file from its start.
        const result = await migrate();
        expect(result.applied).toBe(1);
        const after = await databaseState();
        expect(after.tables[seed]).toBe(1);
        expect(after.tables[created]).toBe(0);
        expect(migrationState(await fileRows())).toBe("applied");
      }

      it("leaves nothing of the file when the process is killed after its first statement", async () => {
        const before = await databaseState();
        await kill(await runUntil("up", "after", firstStatement));
        expect(await databaseState()).toEqual(before);
        await expectAppliedWhole();
      }, 180_000);

      it("leaves nothing of the file when its connection drops after its first statement", async () => {
        const before = await databaseState();
        await dropConnection(await runUntil("up", "after", firstStatement));
        expect(await databaseState()).toEqual(before);
        await expectAppliedWhole();
      }, 180_000);
    });

    describe("a file whose second statement fails", () => {
      const one = `${P}_one`;
      // Fails on every dialect: the table it writes to does not exist.
      const failing = `INSERT INTO ${P}_missing (id) VALUES (1)`;

      /** Runs the file, and returns the error `nextly migrate` ended with. */
      async function failedRun(marked: boolean): Promise<unknown> {
        writeFile(
          [`CREATE TABLE ${one} (id integer)`, failing],
          [`DROP TABLE ${one}`],
          marked
        );
        return migrate().then(
          () => undefined,
          (error: unknown) => error
        );
      }

      it.runIf(inTransaction)(
        "in a transaction, ends with an error naming the file and leaves nothing of it",
        async () => {
          writeFile([], [], false);
          const before = await databaseState();
          const error = await failedRun(false);
          // The operator is told which file failed, and why.
          expect(error).toBeInstanceOf(Error);
          expect(String((error as Error).message)).toContain(NAME);
          // Nothing of the file was applied, so nothing of it is recorded.
          const after = await databaseState();
          expect(after).toEqual(before);
          expect(await fileRows()).toEqual([]);
        },
        120_000
      );

      it("where its statements commit as they run, records the attempt failed", async () => {
        // MySQL commits a schema statement in a transaction too; elsewhere the file is marked.
        const error = await failedRun(dialect !== "mysql");
        expect(error).toBeInstanceOf(Error);
        const rows = await fileRows();
        expect(rows.map(row => [row.eventType, row.status])).toEqual([
          ["file_apply", "failed"],
        ]);
        expect(hasUnresolvedAttempt(rows)).toBe(true);
        expect(migrationState(rows)).toBe("pending");
        // The statement before the failing one stayed applied.
        expect((await databaseState()).tables[one]).toBe(0);
      }, 120_000);
    });

    describe("a DOWN stopped between its rollback row and retiring the applied row", () => {
      const one = `${P}_one`;
      const two = `${P}_two`;

      /** Applies the file, then kills `migrate:down` between its two ledger writes. */
      async function killedBetweenLedgerWrites(marked: boolean) {
        writeFile(
          [
            `CREATE TABLE ${one} (id integer)`,
            `CREATE TABLE ${two} (id integer)`,
          ],
          [`DROP TABLE ${two}`, `DROP TABLE ${one}`],
          marked
        );
        expect((await migrate()).applied).toBe(1);
        await kill(await runUntil("down", "before", "@supersede"));
        // Every statement of the DOWN ran before its rollback was recorded.
        expect(
          Object.keys((await databaseState()).tables).filter(t =>
            t.startsWith(P)
          )
        ).toEqual([]);
        return fileRows();
      }

      // Where those writes commit on their own: outside a transaction on
      // every dialect, and on MySQL inside one too, whose schema statements
      // end the transaction they ran in.
      for (const marked of dialect === "mysql" ? [true, false] : [true]) {
        it(`the rollback row alone records it rolled back (marked to run outside a transaction: ${String(marked)})`, async () => {
          // Read as a cleared attempt, the rollback would leave the migration
          // applied, and the next `migrate:down` would run its DOWN again.
          const rows = await killedBetweenLedgerWrites(marked);
          expect(migrationState(rows)).toBe("rolled_back");
          expect(hasUnresolvedAttempt(rows)).toBe(false);
        }, 180_000);
      }
    });

    describe("a file whose statements commit as they run", () => {
      const one = `${P}_one`;
      const two = `${P}_two`;
      const firstStatement = `CREATE TABLE ${one}`;
      // MySQL commits each schema statement in a transaction too; elsewhere the file is marked.
      const marked = dialect !== "mysql";

      beforeEach(() => {
        writeFile(
          [
            `CREATE TABLE ${one} (id integer)`,
            `CREATE TABLE ${two} (id integer)`,
          ],
          [`DROP TABLE ${two}`, `DROP TABLE ${one}`],
          marked
        );
      });

      it.each(["before", "after"] as const)(
        "records the attempt with no outcome when the process is killed %s the first statement",
        async when => {
          const before = await databaseState();
          await kill(await runUntil("up", when, firstStatement));

          const after = await databaseState();
          expect(after.ledger).toEqual([
            ...before.ledger,
            { eventType: "file_apply", status: "in_progress", filename: FILE },
          ]);
          // What already ran stayed; nothing after it ran.
          expect(
            Object.keys(after.tables).filter(t => t.startsWith(P))
          ).toEqual(when === "after" ? [one] : []);
          const rows = await fileRows();
          expect(migrationState(rows)).toBe("pending");
          expect(hasUnresolvedAttempt(rows)).toBe(true);

          // The lock lapses, and the next run takes it and stops on the attempt,
          // changing nothing.
          const settled = await databaseState();
          expect(await refusal(migrate())).toBe(
            "NEXTLY_MIGRATION_PARTIALLY_APPLIED"
          );
          expect(await databaseState()).toEqual(settled);
        },
        180_000
      );

      it.each(["before", "after"] as const)(
        "records a down section's attempt with no outcome when migrate:down is killed %s its first statement",
        async when => {
          expect((await migrate()).applied).toBe(1);
          const before = await databaseState();
          await kill(await runUntil("down", when, `DROP TABLE ${two}`));

          const after = await databaseState();
          expect(after.ledger).toEqual([
            ...before.ledger,
            {
              eventType: "file_rollback",
              status: "in_progress",
              filename: FILE,
            },
          ]);
          expect(
            Object.keys(after.tables).filter(t => t.startsWith(P))
          ).toEqual(when === "after" ? [one] : [one, two]);
          const rows = await fileRows();
          // Still applied: only the down section's outcome would change that.
          expect(migrationState(rows)).toBe("applied");
          expect(hasUnresolvedAttempt(rows)).toBe(true);

          // The lock lapses, and the next run takes it; the file stays applied.
          expect((await migrate()).applied).toBe(0);
          expect(migrationState(await fileRows())).toBe("applied");
        },
        180_000
      );
    });
  }
);
