/**
 * A promote's or demote's registry write on a SQLite database another connection holds.
 *
 * Its first access to the database is the schema lock's own, made inside the lock's busy handling
 * (`waitingForBusyDatabase`): the write waits for the database in tries, within the busy-table
 * bounds, and stops with `NEXTLY_TABLE_BUSY` naming the lock's table once the holder outlasts
 * them. SQLite's own busy answer never reaches the operator as the error. A read made before the
 * lock (such as a question whether the lock's table is there) would meet the holder outside those
 * tries, and end the command at once with SQLite's answer.
 *
 * The database runs without WAL (the adapter's `wal: false`), where a connection that holds the
 * database exclusively (`BEGIN EXCLUSIVE`, or a writer committing) keeps every other connection
 * from reading as well as writing. The holder is a second connection to the same file, as another
 * process is. The bounds come from the environment (1 second a try, 8 in all), as a command reads
 * them. Without WAL the lock also reads the holder's row after each busy try, which waits as well,
 * so fewer tries fit in the total than on a WAL database; what tells a run that waited from one
 * that stopped at once is that it tried more than once.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { loadDialectTables } from "../../../database/dialect-tables";
import { busyTableBounds } from "../../../domains/schema/busy-table/bounds";
import { causeChain } from "../../../domains/schema/busy-table/ended-waiting";
import { plannedTryStarts } from "../../../domains/schema/busy-table/schedule";
import { withSchemaLock } from "../../../domains/schema/pipeline/schema-lock";
import { NextlyError } from "../../../errors/nextly-error";
import { createLogger } from "../../utils/logger";
import { installRegistryResolver } from "../../utils/registry-resolver";
import { withCollectionRegistryWrite } from "../db-sync-registry";

describe("a promote's or demote's registry write on a busy SQLite database", () => {
  let dir: string;
  let adapter: DrizzleAdapter;
  let holder: DrizzleAdapter;

  /** A connection to the case's file, without WAL, as a site configured so opens it. */
  async function connect(): Promise<DrizzleAdapter> {
    const opened = createSqliteAdapter({
      url: `file:${join(dir, "site.db")}`,
      wal: false,
    }) as unknown as DrizzleAdapter;
    await opened.connect();
    await loadDialectTables("sqlite");
    installRegistryResolver(opened);
    return opened;
  }

  beforeAll(async () => {
    vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
    vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "8");
    dir = mkdtempSync(join(tmpdir(), "nextly-registry-busy-"));
    adapter = await connect();
    holder = await connect();
    await holder.executeQuery("CREATE TABLE rbs_hold (id integer)");
    // The lock's tables and row exist, as on a site that has run once.
    await withSchemaLock(
      { adapter, command: "nextly migrate", whenHeld: "refuse" },
      async () => undefined
    );
  }, 60_000);

  afterEach(async () => {
    await holder.executeQuery("COMMIT").catch(() => {});
  });

  afterAll(async () => {
    await holder?.disconnect();
    await adapter?.disconnect();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  }, 60_000);

  /** The holder takes the database exclusively and keeps it until `afterEach`. */
  async function holdTheDatabase(): Promise<void> {
    await holder.executeQuery("BEGIN EXCLUSIVE");
    await holder.executeQuery("INSERT INTO rbs_hold (id) VALUES (1)");
  }

  it("waits for the database in tries, then stops with NEXTLY_TABLE_BUSY, never SQLite's own answer", async () => {
    await holdTheDatabase();
    const work = vi.fn(async () => "written");

    const error: unknown = await withCollectionRegistryWrite(
      {
        adapter,
        logger: createLogger({ quiet: true }),
        label: "db:sync --demote",
      },
      work
    ).then(
      () => undefined,
      (thrown: unknown) => thrown
    );

    expect(work).not.toHaveBeenCalled();
    expect(NextlyError.is(error), String(error)).toBe(true);
    const refusal = error as NextlyError;
    expect(refusal.code).toBe("NEXTLY_TABLE_BUSY");
    // Tries within the bounds, as a command that waits for a held lock makes them: not one try and
    // a stop (as a request that refuses at once makes), and not SQLite's own answer at the first
    // access.
    expect(refusal.logContext).toMatchObject({
      reason: "table busy",
      stop: { ended: { table: "nextly_schema_lock" } },
    });
    const { tries } = (refusal.logContext as { stop: { tries: number } }).stop;
    expect(tries).toBeGreaterThan(1);
    expect(tries).toBeLessThanOrEqual(
      plannedTryStarts(busyTableBounds({ env: process.env })).length
    );
    // SQLite's busy answer is the stop's cause, not the error the command ends with.
    expect(causeChain(refusal).some(link => link.code === "SQLITE_BUSY")).toBe(
      true
    );
  }, 60_000);
});
