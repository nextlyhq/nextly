/**
 * The schema lock against real databases, held from a second process.
 *
 * What an operator relies on, each on PostgreSQL, MySQL and SQLite: a command-line run waits for a
 * held lock and proceeds when it is released inside the wait, or stops with a message naming the
 * holder; a live holder keeps the lock however many leases its run lasts; a holder that dies lets
 * it lapse within one lease; every ending of a command releases it; and on SQLite a second process
 * on the same file is excluded exactly as on the servers.
 *
 * The holder is a real second process (`helpers/schema-lock-holder.ts`), because on SQLite that is
 * the only kind of contender a file lock can exclude, and because killing one is the only honest
 * way to show what a dead holder leaves behind.
 */
import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../../errors/nextly-error";
import { withMigrationExcluded } from "../../../field-groups/migration/sync-guard";
import { withMigrateLock } from "../locks";
import { withSchemaLock } from "../schema-lock";

import {
  LOCK_DIALECTS,
  lockWorld,
  sleep,
  startHolder,
  tablesWithPrefix,
  type Holder,
  type LockWorld,
} from "./helpers/schema-lock-world";

/** This file's own tables, prefixed so no other suite's can collide with them. */
const PREFIX = `sl_${randomBytes(4).toString("hex")}`;
const TABLES = [`${PREFIX}_first`, `${PREFIX}_second`, `${PREFIX}_mine`];

/** A no-op logger, so a waiting run's notice does not reach the test output. */
const quiet = { warn: () => {}, info: () => {} };

describe.each(LOCK_DIALECTS)("the schema lock on %s", dialect => {
  let world: LockWorld;
  let adapter: DrizzleAdapter;
  let holder: Holder | undefined;

  beforeEach(async () => {
    world = await lockWorld(dialect);
    adapter = await world.connect();
    await world.reset(adapter, TABLES);
  });

  afterEach(async () => {
    if (holder !== undefined) {
      holder.kill("SIGKILL");
      await holder.exited;
      holder = undefined;
    }
    await world.reset(adapter, TABLES);
    await adapter.disconnect();
    await world.dispose();
  });

  /** A run of this process that creates a table of its own once it holds the lock. */
  function myRun(options: { whenHeld: "wait" | "refuse"; waitMs?: number }) {
    return withSchemaLock(
      {
        adapter,
        command: "nextly migrate",
        whenHeld: options.whenHeld,
        waitMs: options.waitMs,
        pollMs: 200,
        logger: quiet,
      },
      async () => {
        await adapter.executeQuery(`CREATE TABLE ${PREFIX}_mine (id integer)`);
        return "ran";
      }
    );
  }

  it("waits for a held lock and proceeds when the holder releases inside the wait", async () => {
    holder = startHolder(world, {
      command: "nextly db:sync",
      leaseSeconds: 30,
      prefix: PREFIX,
    });
    await holder.printed("held");

    const started = Date.now();
    const run = myRun({ whenHeld: "wait", waitMs: 20_000 });
    await sleep(1_500);
    // Still waiting: nothing of this run's has happened while the other holds the lock.
    expect(await tablesWithPrefix(adapter, `${PREFIX}_mine`)).toEqual([]);
    holder.send("release");

    await expect(run).resolves.toEqual({ ran: true, value: "ran" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_400);
    expect(await tablesWithPrefix(adapter, `${PREFIX}_mine`)).toEqual([
      `${PREFIX}_mine`,
    ]);
  }, 60_000);

  it("stops after the wait without changing anything, naming the holder, its start and when it lapses", async () => {
    holder = startHolder(world, {
      command: "nextly db:sync",
      leaseSeconds: 30,
      prefix: PREFIX,
    });
    await holder.printed("held");

    const error = await myRun({ whenHeld: "wait", waitMs: 1_500 }).catch(
      (e: unknown) => e
    );

    expect(NextlyError.is(error) && error.code).toBe(
      "NEXTLY_MIGRATE_LOCK_BUSY"
    );
    const message = (error as NextlyError).publicMessage;
    expect(message).toContain(
      "`nextly migrate` did not start, and changed nothing"
    );
    expect(message).toContain("`nextly db:sync` holds it");
    expect(message).toMatch(/started \d+ s ago at \d{4}-\d\d-\d\dT[\d:]+Z/);
    expect(message).toMatch(
      /If that process has stopped, the lock lapses in \d+ s/
    );
    expect(await tablesWithPrefix(adapter, `${PREFIX}_mine`)).toEqual([]);
  }, 60_000);

  it("keeps the lock for a run lasting several leases, excluding a second run throughout", async () => {
    // A two-second lease, held for seven: only renewal keeps it.
    holder = startHolder(world, {
      command: "nextly migrate",
      leaseSeconds: 2,
      prefix: PREFIX,
    });
    await holder.printed("held");

    const until = Date.now() + 7_000;
    let attempts = 0;
    while (Date.now() < until) {
      // Refused by the schema lock's own row, renewed by its holder: not merely by the earlier
      // field-group lock held beside it, which renews on its own and would refuse this as well.
      await expect(myRun({ whenHeld: "refuse" })).rejects.toMatchObject({
        code: "NEXTLY_MIGRATE_LOCK_BUSY",
        logContext: { holder: { kind: "schema", command: "nextly migrate" } },
      });
      attempts += 1;
      await sleep(500);
    }
    expect(attempts).toBeGreaterThan(5);
    expect(await tablesWithPrefix(adapter, `${PREFIX}_mine`)).toEqual([]);

    holder.send("release");
    await holder.printed("released");
    await expect(myRun({ whenHeld: "refuse" })).resolves.toEqual({
      ran: true,
      value: "ran",
    });
  }, 60_000);

  it("lets the lock of a holder killed between two statements lapse within one lease", async () => {
    holder = startHolder(world, {
      command: "nextly migrate",
      leaseSeconds: 3,
      prefix: PREFIX,
    });
    await holder.printed("held");
    holder.kill("SIGKILL");
    await holder.exited;
    const killedAt = Date.now();
    holder = undefined;

    await expect(myRun({ whenHeld: "wait", waitMs: 20_000 })).resolves.toEqual({
      ran: true,
      value: "ran",
    });
    // Within one lease of the kill, give or take one poll and the time to ask.
    expect(Date.now() - killedAt).toBeLessThan(3_000 + 2_000);
    // The first statement it ran stays; the second it never reached.
    expect(await tablesWithPrefix(adapter, PREFIX)).toEqual([
      `${PREFIX}_first`,
      `${PREFIX}_mine`,
    ]);
  }, 60_000);

  it("is released when an interrupted command ends, so the next run takes it at once", async () => {
    holder = startHolder(world, {
      command: "nextly migrate",
      leaseSeconds: 60,
      prefix: PREFIX,
    });
    await holder.printed("held");
    holder.kill("SIGINT");
    await holder.exited;
    holder = undefined;

    // Refused at once if the lock were still held: its lease has most of a minute to run.
    await expect(myRun({ whenHeld: "refuse" })).resolves.toEqual({
      ran: true,
      value: "ran",
    });
  }, 60_000);

  it.each([
    ["success", async (): Promise<string> => "done"],
    [
      "refusal",
      async (): Promise<string> => {
        throw NextlyError.validation({
          errors: [{ path: "x", code: "INVALID", message: "refused" }],
        });
      },
    ],
    [
      "error",
      async (): Promise<string> => {
        throw new Error("the work failed");
      },
    ],
  ] as const)(
    "is released when a command ends by %s, so the next run takes it at once",
    async (_ending, work) => {
      await withSchemaLock(
        { adapter, command: "nextly migrate", whenHeld: "refuse" },
        work
      ).catch(() => undefined);

      // A second adapter: another run, with no part in the first one's context.
      const other = await world.connect();
      try {
        await expect(
          withSchemaLock(
            { adapter: other, command: "nextly upgrade", whenHeld: "refuse" },
            async () => "ran"
          )
        ).resolves.toEqual({ ran: true, value: "ran" });
      } finally {
        await other.disconnect();
      }
    },
    60_000
  );

  it("excludes db:sync while another process runs nextly migrate", async () => {
    holder = startHolder(world, {
      command: "nextly migrate",
      leaseSeconds: 30,
      prefix: PREFIX,
    });
    await holder.printed("held");

    let synced = false;
    const logger = { debug() {}, info() {}, warn() {}, error() {} };
    await expect(
      withMigrationExcluded(
        {
          adapter,
          logger,
          label: "db:sync",
          mayCreateLock: true,
          releaseOnInterrupt: true,
          whenHeld: "wait",
          waitMs: 1_000,
        },
        async () => {
          synced = true;
        }
      )
    ).rejects.toMatchObject({ code: "NEXTLY_MIGRATE_LOCK_BUSY" });
    expect(synced).toBe(false);

    holder.send("release");
    await holder.printed("released");
    await withMigrationExcluded(
      {
        adapter,
        logger,
        label: "db:sync",
        mayCreateLock: true,
        releaseOnInterrupt: true,
        whenHeld: "refuse",
      },
      async () => {
        synced = true;
      }
    );
    expect(synced).toBe(true);
  }, 60_000);

  it("excludes nextly migrate while another process holds the lock, through the migrate commands' entry", async () => {
    holder = startHolder(world, {
      command: "nextly db:sync",
      leaseSeconds: 30,
      prefix: PREFIX,
    });
    await holder.printed("held");

    let migrated = false;
    await expect(
      withMigrateLock(
        adapter,
        dialect,
        async () => {
          migrated = true;
        },
        { command: "nextly migrate", mode: "wait", waitMs: 1_000 }
      )
    ).rejects.toMatchObject({ code: "NEXTLY_MIGRATE_LOCK_BUSY" });
    expect(migrated).toBe(false);
  }, 60_000);
});
