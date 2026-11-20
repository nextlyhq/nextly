/**
 * Taking the schema lock on a busy SQLite database.
 *
 * On SQLite the lock's claim is read and written inside one `BEGIN IMMEDIATE` transaction, and a
 * second connection with a write transaction open holds the whole database. A run that asks for
 * the lock then waits for the database in tries, with the bounds and pauses a schema change waits
 * for a busy table with: a holder that lets go within the total bound lets the lock be taken, and
 * one that does not ends the run with `NEXTLY_TABLE_BUSY`, naming the lock's table and why SQLite
 * names no holder. SQLite's own busy answer never reaches the caller as the error. A command,
 * which waits for a held lock, makes every try; a run that refuses a held lock at once (a Schema
 * Builder save) makes one. The bounds are the caller's where it has its own, else the
 * environment's, and are judged only once the database is found busy.
 *
 * The holder is a second adapter on the same file, as another process is: the short bounds come
 * from the environment (1 second a try, 4 in all), as a Builder save and a start read them.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { busyTableBounds } from "../../busy-table/bounds";
import { causeChain } from "../../busy-table/ended-waiting";
import { plannedTryStarts } from "../../busy-table/schedule";
import { withSchemaLock } from "../schema-lock";

import { lockWorld, type LockWorld } from "./helpers/schema-lock-world";

describe("taking the schema lock on a busy database (sqlite)", () => {
  let world: LockWorld;
  let adapter: DrizzleAdapter;
  let holderAdapter: DrizzleAdapter;
  let free: () => void = () => {};
  let holding: Promise<unknown> = Promise.resolve();
  let ownBusyTimeout = 0;
  const warned: string[] = [];
  const logger = {
    warn: (line: string) => {
      warned.push(line);
    },
    info: () => {},
  };

  beforeAll(async () => {
    vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
    vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "4");
    world = await lockWorld("sqlite", { fresh: true });
    adapter = await world.connect();
    holderAdapter = await world.connect();
    await adapter.executeQuery("CREATE TABLE slb_hold (id integer)");
    ownBusyTimeout = await busyTimeout();
    // The lock's tables and row exist before any case, as on a site that has run once, so each
    // case meets the holder where the claim is made.
    await withSchemaLock(
      { adapter, command: "nextly migrate", whenHeld: "refuse" },
      async () => undefined
    );
  }, 60_000);

  afterEach(async () => {
    free();
    await holding.catch(() => {});
    warned.length = 0;
  });

  afterAll(async () => {
    await holderAdapter?.disconnect();
    await adapter?.disconnect();
    await world?.dispose();
    vi.unstubAllEnvs();
  }, 60_000);

  /** A second connection's open write transaction, which holds the whole database, until `free()`. */
  async function holdTheDatabase(): Promise<void> {
    let held: () => void = () => {};
    const isHeld = new Promise<void>(resolve => {
      held = resolve;
    });
    const freed = new Promise<void>(resolve => {
      free = resolve;
    });
    holding = holderAdapter.transaction(async tx => {
      await tx.queryStatement(
        sql.raw("INSERT INTO slb_hold (id) VALUES (0) RETURNING id")
      );
      held();
      await freed;
    });
    await isHeld;
  }

  /** The connection's busy timeout, in milliseconds. */
  async function busyTimeout(): Promise<number> {
    const [row] = await adapter.executeQuery<Record<string, unknown>>(
      "PRAGMA busy_timeout"
    );
    return Number(Object.values(row ?? {})[0]);
  }

  /** A run that asks for the lock, and says so once it holds it. */
  const run = (
    whenHeld: "wait" | "refuse",
    busyBounds?: { tryMs: number; totalMs: number }
  ) =>
    withSchemaLock(
      {
        adapter,
        command: "nextly migrate",
        whenHeld,
        logger,
        ...(busyBounds === undefined ? {} : { busyBounds }),
      },
      async () => "ran"
    );

  /** The stop a run ends with while the database stays held. */
  async function stopOf(work: () => Promise<unknown>): Promise<NextlyError> {
    await holdTheDatabase();
    const error: unknown = await work().then(
      () => undefined,
      (e: unknown) => e
    );
    if (!NextlyError.is(error)) throw new Error(`no refusal: ${String(error)}`);
    return error;
  }

  const triesOf = (stop: NextlyError): unknown =>
    (stop.logContext as { stop?: { tries?: unknown } } | undefined)?.stop
      ?.tries;

  it.each(["wait"] as const)(
    "takes the lock once the holder lets go within the bound (a command, which waits)",
    async whenHeld => {
      await holdTheDatabase();
      // Let go while the run pauses after its first try, well inside the total.
      const letGo = setTimeout(() => free(), 1_500);
      try {
        await expect(run(whenHeld)).resolves.toEqual({
          ran: true,
          value: "ran",
        });
      } finally {
        clearTimeout(letGo);
      }
      // The second try was announced, naming what was busy.
      expect(warned.join("\n")).toContain(
        'nextly migrate: table "nextly_schema_lock" is busy'
      );
      expect(warned.join("\n")).toContain("try 2 of up to");
    },
    30_000
  );

  it("announces each later try on standard error for a caller with no logger", async () => {
    const written: string[] = [];
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(chunk => {
        written.push(String(chunk));
        return true;
      });
    await holdTheDatabase();
    const letGo = setTimeout(() => free(), 1_500);
    try {
      await expect(
        withSchemaLock(
          { adapter, command: "nextly migrate:resolve", whenHeld: "wait" },
          async () => "ran"
        )
      ).resolves.toEqual({ ran: true, value: "ran" });
    } finally {
      clearTimeout(letGo);
      stderr.mockRestore();
    }
    expect(written.join("")).toContain(
      'nextly migrate:resolve: table "nextly_schema_lock" is busy'
    );
    expect(await busyTimeout()).toBe(ownBusyTimeout);
  }, 30_000);

  it.each(["wait", "refuse"] as const)(
    "refuses with NEXTLY_TABLE_BUSY, never SQLite's own answer, once the holder outlasts the bound (%s)",
    async whenHeld => {
      await holdTheDatabase();

      const error: unknown = await run(whenHeld).then(
        () => undefined,
        (e: unknown) => e
      );

      expect(NextlyError.is(error)).toBe(true);
      const refusal = error as NextlyError;
      expect(refusal.code).toBe("NEXTLY_TABLE_BUSY");
      const bounds = busyTableBounds({ env: process.env });
      expect(refusal.logContext).toMatchObject({
        reason: "table busy",
        stop: {
          change: "nextly migrate",
          ended: {
            table: "nextly_schema_lock",
            holder: { kind: "unnamed" },
          },
          // A command makes every try the bounds allow; a run that refuses at once makes one.
          tries: whenHeld === "wait" ? plannedTryStarts(bounds).length : 1,
          outcome: { kind: "nothing-changed" },
        },
      });
      expect(refusal.publicMessage).toContain(
        "`nextly migrate` stopped: table busy, nothing changed."
      );
      expect(refusal.publicMessage).toContain(
        "another connection holds its write lock"
      );
      expect(refusal.publicMessage).not.toMatch(/SQLITE_BUSY/i);
      // SQLite's answer stays the stop's cause, where a caller that holds the write lock itself
      // reads it; and the connection's own busy timeout is back once the tries end.
      expect(
        causeChain(refusal).some(link => link.code === "SQLITE_BUSY")
      ).toBe(true);
      expect(await busyTimeout()).toBe(ownBusyTimeout);

      // The database is left as it was: once the holder ends, the next run takes the lock.
      free();
      await holding.catch(() => {});
      await expect(run("refuse")).resolves.toEqual({ ran: true, value: "ran" });
    },
    30_000
  );

  it("waits with the caller's own bounds, over the environment's", async () => {
    // One try of one second in all, where the environment allows four seconds of them.
    const stop = await stopOf(() =>
      run("wait", { tryMs: 1_000, totalMs: 1_000 })
    );

    expect(stop.code).toBe("NEXTLY_TABLE_BUSY");
    expect(triesOf(stop)).toBe(1);
    expect(
      plannedTryStarts(busyTableBounds({ env: process.env })).length
    ).toBeGreaterThan(1);
  }, 30_000);

  it("asks once for a run that refuses at once, waiting as its connection is set to and not a command's long try", async () => {
    const startedAt = Date.now();
    // A try an operator set long for commands: a request must not wait it out.
    const stop = await stopOf(() =>
      run("refuse", { tryMs: 20_000, totalMs: 60_000 })
    );
    const elapsed = Date.now() - startedAt;

    expect(stop.code).toBe("NEXTLY_TABLE_BUSY");
    expect(triesOf(stop)).toBe(1);
    // The connection's own busy timeout, with room for the run around it; never the 20 seconds.
    expect(elapsed).toBeLessThan(ownBusyTimeout + 4_000);
    expect(await busyTimeout()).toBe(ownBusyTimeout);
  }, 30_000);

  it("shares one total between the steps of taking the lock", async () => {
    // The seeding of the lock's row waits for the holder and gets through on its second try.
    // The database is then held again before the claim, which is left what remains of the total:
    // one try, where a total of its own would have allowed the two the bounds plan.
    const bounds = busyTableBounds({ env: process.env });
    expect(plannedTryStarts(bounds).length).toBe(2);
    const transaction = adapter.transaction.bind(adapter);
    let transactions = 0;
    const spied = vi
      .spyOn(adapter, "transaction")
      .mockImplementation(async (...args: Parameters<typeof transaction>) => {
        const result = await transaction(...args);
        transactions += 1;
        if (transactions === 1) await holdTheDatabase();
        return result;
      });
    await holdTheDatabase();
    const letGo = setTimeout(() => free(), 1_500);
    let error: unknown;
    try {
      error = await run("wait").then(
        () => undefined,
        (e: unknown) => e
      );
    } finally {
      clearTimeout(letGo);
      spied.mockRestore();
    }

    expect(NextlyError.is(error)).toBe(true);
    expect((error as NextlyError).code).toBe("NEXTLY_TABLE_BUSY");
    expect(triesOf(error as NextlyError)).toBe(1);
  }, 30_000);

  describe("with a bound out of its range in the environment", () => {
    beforeAll(() => {
      vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "0");
    });
    afterAll(() => {
      vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
    });

    it("takes the lock on a database nobody holds: the bounds are not judged", async () => {
      await expect(run("wait")).resolves.toEqual({ ran: true, value: "ran" });
    }, 30_000);

    it("refuses with the bound's own refusal once the database is found busy", async () => {
      const stop = await stopOf(() => run("wait"));

      expect(stop.code).toBe("INVALID_INPUT");
      expect(stop.logContext).toMatchObject({
        reason: "busy-table-bound-invalid",
        setting: "NEXTLY_LOCK_TIMEOUT",
      });
    }, 30_000);
  });

  describe("where another Nextly run holds the lock and the database", () => {
    /**
     * A second run that holds the schema lock and, inside its work, a write of its own left
     * open: a migration part-way through its transaction. Ends when `free()` is called.
     */
    async function runHolding(): Promise<void> {
      let held: () => void = () => {};
      const isHeld = new Promise<void>(resolve => {
        held = resolve;
      });
      const freed = new Promise<void>(resolve => {
        free = resolve;
      });
      const running = withSchemaLock(
        {
          adapter: holderAdapter,
          command: "nextly upgrade",
          whenHeld: "refuse",
        },
        () =>
          holderAdapter.transaction(async tx => {
            await tx.queryStatement(
              sql.raw("INSERT INTO slb_hold (id) VALUES (1) RETURNING id")
            );
            held();
            await freed;
          })
      );
      holding = running;
      // The holder's own failure ends the case at once, with its reason.
      await Promise.race([
        isHeld,
        running.then(
          () => undefined,
          (error: unknown) => {
            throw error;
          }
        ),
      ]);
    }

    it("refuses a command with the held lock's refusal, naming the run that holds it", async () => {
      await runHolding();

      const error: unknown = await withSchemaLock(
        {
          adapter,
          command: "nextly migrate",
          whenHeld: "wait",
          waitMs: 1_500,
          pollMs: 200,
          logger,
        },
        async () => "ran"
      ).then(
        () => undefined,
        (e: unknown) => e
      );

      expect(NextlyError.is(error)).toBe(true);
      const refusal = error as NextlyError;
      expect(refusal.code).toBe("NEXTLY_MIGRATE_LOCK_BUSY");
      expect(refusal.publicMessage).toContain("nextly upgrade");
      expect(refusal.logContext).toMatchObject({
        holder: { kind: "schema", command: "nextly upgrade" },
      });
    }, 30_000);

    it("refuses a save at once, telling the editor a migration is running", async () => {
      await runHolding();
      const startedAt = Date.now();

      const error: unknown = await withSchemaLock(
        {
          adapter,
          command: "Schema Builder: collection update",
          whenHeld: "refuse",
          refusal: "editor",
          logger,
        },
        async () => "ran"
      ).then(
        () => undefined,
        (e: unknown) => e
      );

      expect(NextlyError.is(error)).toBe(true);
      expect((error as NextlyError).publicMessage).toContain(
        "A migration is running on this database"
      );
      // No wait: the connection's own busy timeout was not sat through.
      expect(Date.now() - startedAt).toBeLessThan(ownBusyTimeout - 1_000);
    }, 30_000);

    it("takes the lock once that run ends within the wait, past what a busy table is waited for", async () => {
      await runHolding();
      // Longer than the whole of the busy-table bounds (4 s here), shorter than the lock's wait.
      const letGo = setTimeout(() => free(), 6_000);
      try {
        await expect(
          withSchemaLock(
            {
              adapter,
              command: "nextly migrate",
              whenHeld: "wait",
              waitMs: 20_000,
              pollMs: 200,
              logger,
            },
            async () => "ran"
          )
        ).resolves.toEqual({ ran: true, value: "ran" });
      } finally {
        clearTimeout(letGo);
      }
    }, 30_000);
  });

  describe("a database that turns busy once the lock is held", () => {
    /** Makes the holder take the database right after the run's `nth` transaction ends. */
    function busyAfterTransaction(nth: number): () => void {
      const transaction = adapter.transaction.bind(adapter);
      let transactions = 0;
      const spied = vi
        .spyOn(adapter, "transaction")
        .mockImplementation(async (...args: Parameters<typeof transaction>) => {
          const result = await transaction(...args);
          transactions += 1;
          if (transactions === nth) await holdTheDatabase();
          return result;
        });
      return () => spied.mockRestore();
    }

    it("finishes a run whose later lock steps meet a database busy for longer than one wait", async () => {
      // Busy from just after the claim, for longer than the connection waits on its own: the
      // steps that follow (the field-group claim, the work's end, the release) wait for it.
      const restore = busyAfterTransaction(2);
      const letGo = setTimeout(() => free(), ownBusyTimeout + 1_500);
      try {
        await expect(
          withSchemaLock(
            {
              adapter,
              command: "nextly migrate",
              whenHeld: "wait",
              busyBounds: { tryMs: 1_000, totalMs: 20_000 },
              logger,
            },
            async () => "ran"
          )
        ).resolves.toEqual({ ran: true, value: "ran" });
      } finally {
        clearTimeout(letGo);
        restore();
      }
      // Released: the next run takes the lock at once.
      await holding.catch(() => {});
      await expect(run("refuse")).resolves.toEqual({ ran: true, value: "ran" });
    }, 60_000);

    it("finishes a run whose work ends into a database busy for longer than one wait", async () => {
      // Busy from inside the work: the steps at its end (the session's release, the check that
      // no other run took the lock, the lock's release) are the ones that wait.
      const letGo = {
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
      };
      try {
        await expect(
          withSchemaLock(
            {
              adapter,
              command: "nextly migrate",
              whenHeld: "wait",
              busyBounds: { tryMs: 1_000, totalMs: 20_000 },
              logger,
            },
            async () => {
              await holdTheDatabase();
              letGo.timer = setTimeout(() => free(), ownBusyTimeout + 1_500);
              return "ran";
            }
          )
        ).resolves.toEqual({ ran: true, value: "ran" });
      } finally {
        clearTimeout(letGo.timer);
      }
      await holding.catch(() => {});
      await expect(run("refuse")).resolves.toEqual({ ran: true, value: "ran" });
    }, 60_000);

    it("releases the lock when only its release meets a busy database", async () => {
      // Busy from just after the end check, the second transaction once the work has ended:
      // the release alone waits. Given up, it would leave the lock held for its whole lease.
      let restore: () => void = () => {};
      const letGo = setTimeout(() => free(), ownBusyTimeout + 3_000);
      try {
        await expect(
          withSchemaLock(
            {
              adapter,
              command: "nextly migrate",
              whenHeld: "wait",
              busyBounds: { tryMs: 1_000, totalMs: 20_000 },
              logger,
            },
            async () => {
              restore = busyAfterTransaction(2);
              return "ran";
            }
          )
        ).resolves.toEqual({ ran: true, value: "ran" });
      } finally {
        clearTimeout(letGo);
        restore();
      }
      await holding.catch(() => {});
      await expect(run("refuse")).resolves.toEqual({ ran: true, value: "ran" });
    }, 60_000);

    it("ends a run that finished, but could not confirm its lock, as a busy database and not a lost lock", async () => {
      const error: unknown = await withSchemaLock(
        {
          adapter,
          command: "nextly migrate",
          whenHeld: "wait",
          busyBounds: { tryMs: 1_000, totalMs: 2_000 },
          logger,
        },
        async () => {
          // The work is done; the database is busy from here to past the end of the run's wait.
          await holdTheDatabase();
          return "ran";
        }
      ).then(
        () => undefined,
        (e: unknown) => e
      );

      expect(NextlyError.is(error)).toBe(true);
      const refusal = error as NextlyError;
      expect(refusal.code).toBe("NEXTLY_TABLE_BUSY");
      expect(refusal.publicMessage).toContain("finished");
      expect(refusal.publicMessage).toContain(
        "Check the database before running it again"
      );
      expect(refusal.publicMessage).not.toContain("another run took it");
    }, 60_000);
  });
});
