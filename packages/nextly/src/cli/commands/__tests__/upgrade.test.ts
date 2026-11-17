/**
 * @module cli/commands/__tests__/upgrade
 * @since v0.0.3-alpha (Plan B)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import { busyTableBounds } from "../../../domains/schema/busy-table/bounds";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import {
  consolidateLegacyBookkeeping,
  type ConsolidateLegacyArgs,
} from "../legacy-bookkeeping";
import { runUpgrade, type UpgradeAdapter } from "../upgrade";

// The schema lock is exercised against real databases in its own suites. These drive the upgrade steps,
// and the move of an earlier release's migration records that `nextly migrate` makes,
// through a narrow adapter double that cannot hold it, so here the lock runs the work as given.
// `program` imports every command, `migrate` with its whole graph among them;
// the command under test takes only its context factory from it, and is
// handed its context here.
vi.mock("../../program", () => ({
  createContext: () => ({
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
  }),
}));

vi.mock("../../../domains/schema/pipeline/locks", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../domains/schema/pipeline/locks")
  >()),
  withMigrateLock: async <T>(
    _adapter: unknown,
    _dialect: unknown,
    fn: () => Promise<T>
  ) => ({ ran: true as const, value: await fn() }),
}));

/** Fake adapter over the in-memory SQLite fixture. */
function makeAdapter(testDb: TestDb): UpgradeAdapter {
  return {
    tableExists: name =>
      Promise.resolve(
        !!testDb.sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
          )
          .get(name)
      ),
    getDrizzle: () => testDb.db,
    dropTable: (name, options) => {
      const ifExists = options?.ifExists !== false ? "IF EXISTS " : "";
      testDb.sqlite.exec(`DROP TABLE ${ifExists}"${name}"`);
      return Promise.resolve();
    },
    getCapabilities: () => ({ dialect: "sqlite" as const }),
  };
}

function tableExistsSync(testDb: TestDb, name: string): boolean {
  return !!testDb.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
}

describe("the move of an earlier release's migration records (sqlite)", () => {
  let testDb: TestDb;
  let adapter: UpgradeAdapter;

  beforeEach(async () => {
    testDb = await createTestDb();
    adapter = makeAdapter(testDb);
    // Start from an existing alpha DB: legacy ledger present, no events table.
    testDb.sqlite.exec("DROP TABLE IF EXISTS nextly_schema_events");
    testDb.sqlite.exec(`
      CREATE TABLE nextly_migrations (
        id TEXT PRIMARY KEY, filename TEXT NOT NULL, sha256 TEXT NOT NULL,
        applied_at INTEGER, applied_by TEXT, duration_ms INTEGER,
        status TEXT NOT NULL, error_json TEXT
      );
      INSERT INTO nextly_migrations (id, filename, sha256, status)
      VALUES ('1', '0001.sql', 'aa', 'applied');
    `);
  });

  /** The move as `nextly migrate` starts it, with what was asked recorded. */
  function move(
    over: Partial<
      Pick<ConsolidateLegacyArgs, "backupConfirmed" | "interactive">
    > & { answer?: boolean } = {}
  ) {
    const asked: string[] = [];
    const moved = consolidateLegacyBookkeeping({
      adapter: adapter as unknown as ConsolidateLegacyArgs["adapter"],
      dialect: "sqlite",
      bounds: busyTableBounds({ env: {} }),
      backupConfirmed: over.backupConfirmed ?? false,
      interactive: over.interactive ?? false,
      askBackedUp: () => {
        asked.push("backed up?");
        return Promise.resolve(over.answer ?? false);
      },
      log: () => {},
      warn: () => {},
    });
    return { moved, asked };
  }

  it("creates the events table, backfills file_apply rows, and drops the legacy table", async () => {
    await move({ backupConfirmed: true }).moved;

    expect(tableExistsSync(testDb, "nextly_schema_events")).toBe(true);
    expect(tableExistsSync(testDb, "nextly_migrations")).toBe(false);

    const repo = new SchemaEventsRepository(testDb.db, "sqlite");
    expect(await repo.isFileApplied("0001.sql")).toBe(true);
  });

  it("is idempotent: a second run finds nothing to move and writes nothing", async () => {
    await move({ backupConfirmed: true }).moved;
    const count = () =>
      (
        testDb.sqlite
          .prepare("SELECT COUNT(*) AS n FROM nextly_schema_events")
          .get() as { n: number }
      ).n;
    const before = count();
    await expect(
      move({ backupConfirmed: true }).moved
    ).resolves.toBeUndefined();
    expect(count()).toBe(before);
  });

  it("refuses a foreign nextly_schema_events table (collision), naming no flag and keeping the legacy table", async () => {
    testDb.sqlite.exec(
      "CREATE TABLE nextly_schema_events (totally_wrong INTEGER)"
    );
    const refusal = await move({ backupConfirmed: true }).moved.then(
      () => undefined,
      (error: unknown) => error
    );
    expect(refusal).toMatchObject({
      code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION",
    });
    expect((refusal as { publicMessage: string }).publicMessage).toMatch(
      /Rename it, then run `nextly migrate` again/
    );
    expect(tableExistsSync(testDb, "nextly_migrations")).toBe(true);
  });

  it("with nobody to ask and no confirmation, changes nothing and names --backup-confirmed", async () => {
    const { moved, asked } = move({ interactive: false });
    await expect(moved).rejects.toMatchObject({
      code: "NEXTLY_UPGRADE_IN_PROGRESS",
      logContext: { reason: "migrate-backup-not-confirmed" },
      publicMessage: expect.stringContaining("--backup-confirmed") as string,
    });
    expect(asked).toEqual([]);
    expect(tableExistsSync(testDb, "nextly_migrations")).toBe(true);
    expect(tableExistsSync(testDb, "nextly_schema_events")).toBe(false);
  });

  it("at a terminal it asks: a no changes nothing", async () => {
    const { moved, asked } = move({ interactive: true, answer: false });
    await expect(moved).rejects.toMatchObject({
      code: "NEXTLY_UPGRADE_IN_PROGRESS",
      logContext: { reason: "migrate-backup-declined" },
    });
    expect(asked).toEqual(["backed up?"]);
    expect(tableExistsSync(testDb, "nextly_migrations")).toBe(true);
    expect(tableExistsSync(testDb, "nextly_schema_events")).toBe(false);
  });

  it("at a terminal it asks: a yes moves the records", async () => {
    const { moved, asked } = move({ interactive: true, answer: true });
    await moved;
    expect(asked).toEqual(["backed up?"]);
    expect(tableExistsSync(testDb, "nextly_migrations")).toBe(false);
  });

  it("the confirmation given, nobody is asked", async () => {
    const { moved, asked } = move({ backupConfirmed: true, interactive: true });
    await moved;
    expect(asked).toEqual([]);
  });

  it("nextly upgrade refuses the database, running no step and naming nextly migrate", async () => {
    let ran = false;
    const refusal = await runUpgrade(
      { confirmBackedUp: true },
      {
        adapter,
        steps: [
          {
            title: "a step with work",
            pending: () => Promise.resolve(1),
            run: () => {
              ran = true;
              return Promise.resolve(1);
            },
          },
        ],
      }
    ).then(
      () => undefined,
      (error: unknown) => error
    );
    expect(refusal).toMatchObject({
      code: "NEXTLY_LEGACY_BOOKKEEPING_DETECTED",
      publicMessage: expect.stringContaining(
        "nextly migrate --backup-confirmed"
      ) as string,
    });
    expect(ran).toBe(false);
    expect(tableExistsSync(testDb, "nextly_migrations")).toBe(true);
  });
});

describe("nextly upgrade runs a list of steps", () => {
  let testDb: TestDb;
  let adapter: UpgradeAdapter;

  beforeEach(async () => {
    // Already moved to nextly_schema_events: the first step has no work.
    testDb = await createTestDb();
    adapter = makeAdapter(testDb);
  });

  /** A step that says it has `pending` to do and records whether it ran. */
  function step(title: string, pending: number) {
    const ran: number[] = [];
    return {
      ran,
      step: {
        title,
        pending: () => Promise.resolve(pending),
        run: () => {
          ran.push(pending);
          return Promise.resolve(pending);
        },
      },
    };
  }

  it("runs only the steps with work, and reports each one's count", async () => {
    const idle = step("tidy one thing", 0);
    const busy = step("tidy another thing", 2);
    const lines: string[] = [];

    await runUpgrade({ confirmBackedUp: true }, {
      adapter,
      logger: { info: msg => lines.push(msg) },
      steps: [idle.step, busy.step],
    } as Parameters<typeof runUpgrade>[1]);

    expect(idle.ran).toEqual([]);
    expect(busy.ran).toEqual([2]);
    expect(lines.join("\n")).toContain("tidy another thing: 2");
    expect(lines.join("\n")).not.toContain("Nothing to do");
  });

  it("asks for a backup only when a step has work", async () => {
    const busy = step("tidy a thing", 1);

    await expect(
      runUpgrade({ confirmBackedUp: false }, {
        adapter,
        isTTY: false,
        steps: [busy.step],
      } as Parameters<typeof runUpgrade>[1])
    ).rejects.toMatchObject({ code: "NEXTLY_UPGRADE_IN_PROGRESS" });
    expect(busy.ran).toEqual([]);
  });

  it("says there is nothing to do only when no step has work, without asking for a backup", async () => {
    const idle = step("tidy a thing", 0);
    const lines: string[] = [];

    await runUpgrade({ confirmBackedUp: false }, {
      adapter,
      isTTY: false,
      logger: { info: msg => lines.push(msg) },
      steps: [idle.step],
    } as Parameters<typeof runUpgrade>[1]);

    expect(idle.ran).toEqual([]);
    expect(lines).toContain("Already upgraded. Nothing to do.");
  });
});

describe("nextly upgrade runs its steps in order", () => {
  it("brings each step up to date before asking the next what it has to do", async () => {
    const testDb = await createTestDb();
    const adapter = makeAdapter(testDb);
    let firstRan = false;
    const first = {
      title: "repair the bookkeeping",
      pending: () => Promise.resolve(firstRan ? 0 : 1),
      run: () => {
        firstRan = true;
        return Promise.resolve(1);
      },
    };
    // Reads what the first step repairs, so it can only count after it.
    const second = {
      title: "read what the bookkeeping holds",
      pending: () =>
        firstRan
          ? Promise.resolve(1)
          : Promise.reject(new Error("read before the repair")),
      run: () => Promise.resolve(1),
    };
    const lines: string[] = [];

    await runUpgrade(
      { confirmBackedUp: true },
      {
        adapter,
        logger: { info: msg => lines.push(msg) },
        steps: [first, second],
      }
    );

    expect(lines).toContain("repair the bookkeeping: 1");
    expect(lines).toContain("read what the bookkeeping holds: 1");
  });
});
