/**
 * A command refused by a held schema lock ends in the error shape, naming the holder.
 *
 * The lock's refusal is raised only against a live database, so this runs the real one: a second
 * process holds the lock (`schema-lock-holder.ts`) while `nextly migrate`'s core tries to take it,
 * and the error it ends with is read as the CLI prints it. On every configured dialect.
 *
 * @module cli/__tests__/error-shape-lock-held.integration.test
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureSchemaEventsTable } from "../../domains/schema/events/schema-events-ddl";
import {
  LOCK_DIALECTS,
  lockWorld,
  startHolder,
  type Holder,
  type LockWorld,
} from "../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import { migrateCore } from "../commands/migrate";
import { formatCliError, toCliError } from "../errors";
import { createLogger } from "../utils/logger";

const FILE = "20261029_000001_error_shape_lock_held";

describe.each(LOCK_DIALECTS)("a held schema lock on %s", dialect => {
  let world: LockWorld;
  let adapter: DrizzleAdapter;
  let migrationsDir: string;
  let holder: Holder | undefined;

  beforeEach(async () => {
    world = await lockWorld(dialect, { fresh: true });
    adapter = await world.connect();
    migrationsDir = mkdtempSync(join(tmpdir(), "nextly-error-shape-lock-"));
    writeFileSync(
      join(migrationsDir, `${FILE}.sql`),
      `-- Migration: ${FILE}\n\n-- UP\nCREATE TABLE eslh_items (id varchar(36) PRIMARY KEY);\n\n-- DOWN\nDROP TABLE eslh_items;\n`,
      "utf8"
    );
  }, 60_000);

  afterEach(async () => {
    if (holder !== undefined) {
      holder.kill("SIGKILL");
      await holder.exited;
      holder = undefined;
    }
    await adapter.disconnect();
    rmSync(migrationsDir, { recursive: true, force: true });
    await world.dispose();
  }, 60_000);

  it("ends nextly migrate with the lock's holder and when to run it again", async () => {
    holder = startHolder(world, {
      command: "nextly db:sync",
      leaseSeconds: 30,
      prefix: "eslh_holder",
    });
    await holder.printed("held");

    const thrown = await migrateCore({
      extensionSchema: undefined,
      dialect,
      db: adapter.getDrizzle(),
      adapter: adapter as never,
      migrationsDir,
      logger: createLogger({ quiet: true }),
      lockMode: "wait",
      lockWaitMs: 1_000,
      ensureLedger: () => ensureSchemaEventsTable(adapter),
    }).then(
      () => undefined,
      (error: unknown) => error
    );

    const error = toCliError(thrown);
    expect(error.code).toBe("SCHEMA_LOCK_HELD");
    const lines = formatCliError(error).split("\n");
    expect(lines[0]).toMatch(
      /^✗ `nextly migrate` did not start, and changed nothing: the schema lock is still held/
    );
    expect(lines[1]).toMatch(/^ {2}Why: {2}`nextly db:sync` holds it \(/);
    expect(lines[2]).toBe("  Next: Run it again once that finishes.");
    expect(lines[3]).toBe(
      "  Docs: https://nextlyhq.com/docs/cli/errors/schema-lock-held  (SCHEMA_LOCK_HELD)"
    );
    expect(lines).toHaveLength(4);

    // The holder, as the lock recorded it, is there under --verbose and only there.
    const verbose = formatCliError(error, { verbose: true });
    expect(verbose).toMatch(
      / {2}Context: .*"holder":\{.*"command":"nextly db:sync"/
    );
  }, 90_000);
});
