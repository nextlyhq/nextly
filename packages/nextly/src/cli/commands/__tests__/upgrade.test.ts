/**
 * @module cli/commands/__tests__/upgrade
 * @since v0.0.3-alpha (Plan B)
 */
import { describe, it, expect, beforeEach } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { runUpgrade, type UpgradeAdapter } from "../upgrade";
import { schemaEventsStep } from "../upgrade-steps/schema-events";

/** The step these fixtures exercise: a fake adapter serves no content table. */
const steps = [schemaEventsStep];

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

describe("nextly upgrade (sqlite)", () => {
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

  it("creates the events table, backfills file_apply rows, and drops the legacy table", async () => {
    await runUpgrade({ confirmBackedUp: true }, { adapter, steps });

    expect(tableExistsSync(testDb, "nextly_schema_events")).toBe(true);
    expect(tableExistsSync(testDb, "nextly_migrations")).toBe(false);

    const repo = new SchemaEventsRepository(testDb.db, "sqlite");
    expect(await repo.isFileApplied("0001.sql")).toBe(true);
  });

  it("is idempotent — a second run reports already-upgraded and does not throw", async () => {
    await runUpgrade({ confirmBackedUp: true }, { adapter, steps });
    await expect(
      runUpgrade({ confirmBackedUp: true }, { adapter, steps })
    ).resolves.toBeUndefined();
  });

  it("aborts on a foreign nextly_schema_events table (collision)", async () => {
    testDb.sqlite.exec("DROP TABLE IF EXISTS nextly_migrations");
    testDb.sqlite.exec(
      "CREATE TABLE nextly_schema_events (totally_wrong INTEGER)"
    );
    await expect(
      runUpgrade({ confirmBackedUp: true }, { adapter, steps })
    ).rejects.toMatchObject({ code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION" });
  });

  it("requires --confirm-backed-up in non-TTY", async () => {
    await expect(
      runUpgrade({ confirmBackedUp: false }, { adapter, isTTY: false, steps })
    ).rejects.toBeTruthy();
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
