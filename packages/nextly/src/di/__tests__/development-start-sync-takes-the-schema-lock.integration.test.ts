/**
 * A development start's schema writes hold the schema lock, on PostgreSQL, MySQL and SQLite.
 *
 * `registerServices` runs the schema registry's initialisation, the Builder reconcile, the
 * code-first sync and the extension tables' preparation inside `withDevelopmentStartSchemaLock`
 * (`development-start-sync-inside-the-lock.test.ts` holds it to that). Here the lock itself is
 * driven against a real database with a second process holding it, as a `nextly migrate` in
 * another terminal would:
 *
 * - outside production the start waits for the holder, its sync does not start while the holder
 *   works, and once the holder releases the sync runs holding the lock itself;
 * - the first start's own lock, which the registry's initialisation takes inside that hold, runs
 *   in the start's claim rather than waiting for it;
 * - in production the start takes no lock here, so it neither waits for the holder nor disturbs
 *   its claim.
 *
 * The sync is stood in for by work that records when it starts and reads the lock row as it runs:
 * what is under test is when the work may run and in whose claim, which the real reconcile and
 * sync would only obscure.
 */
import { randomBytes } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { firstStartSchemaLock } from "../../init/first-run";
import {
  DEVELOPMENT_START_SYNC_COMMAND,
  withDevelopmentStartSchemaLock,
} from "../development-start-schema-lock";

import {
  LOCK_DIALECTS,
  lockWorld,
  sleep,
  startHolder,
  type Holder,
  type LockWorld,
} from "../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";

/** The holder's tables, prefixed so no other suite's can collide with them. */
const PREFIX = `dss_${randomBytes(4).toString("hex")}`;
const TABLES = [`${PREFIX}_first`, `${PREFIX}_second`];

/** What the holder's claim names: a migration in another terminal. */
const HOLDER_COMMAND = "nextly migrate";

/**
 * Longer than one of the lock's polls (a second), so a start that is going to proceed beside the
 * holder has had more than one chance to.
 */
const WHILE_HELD_MS = 2_500;

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** The command the lock row names right now, or null when nobody holds it. */
async function lockCommand(adapter: DrizzleAdapter): Promise<string | null> {
  const rows = await adapter.executeQuery<{ command: string | null }>(
    "SELECT command FROM nextly_schema_lock WHERE id = 1"
  );
  return rows[0]?.command ?? null;
}

describe.each(LOCK_DIALECTS)(
  "the development start's schema sync on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let holder: Holder | undefined;

    beforeEach(async () => {
      world = await lockWorld(dialect);
      adapter = await world.connect();
      await world.reset(adapter, TABLES);
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      if (holder !== undefined) {
        holder.kill("SIGKILL");
        await holder.exited;
        holder = undefined;
      }
      await world.reset(adapter, TABLES);
      await adapter.disconnect();
      await world.dispose();
    });

    it("waits for a holder, runs nothing while it works, then syncs holding the lock", async () => {
      vi.stubEnv("NODE_ENV", "development");
      holder = startHolder(world, {
        command: HOLDER_COMMAND,
        leaseSeconds: 30,
        prefix: PREFIX,
      });
      await holder.printed("held");

      let started = false;
      const start = withDevelopmentStartSchemaLock(
        adapter,
        silentLogger,
        async () => {
          started = true;
          // Read while the sync runs: the claim it runs in.
          return lockCommand(adapter);
        }
      );
      // Observed rather than awaited, so a start that finished early is seen as finished.
      let finished = false;
      void start.then(
        () => {
          finished = true;
        },
        () => {
          finished = true;
        }
      );

      await sleep(WHILE_HELD_MS);
      expect(started).toBe(false);
      expect(finished).toBe(false);
      expect(await lockCommand(adapter)).toBe(HOLDER_COMMAND);

      holder.send("release");
      await holder.printed("released");

      // It ran once the holder let go, in a claim of its own.
      await expect(start).resolves.toBe(DEVELOPMENT_START_SYNC_COMMAND);
      expect(started).toBe(true);
      // And gave the lock back when it finished.
      expect(await lockCommand(adapter)).toBeNull();
    });

    it("runs the first start's own lock, taken inside the hold, in the start's claim", async () => {
      vi.stubEnv("NODE_ENV", "development");

      const startedAt = Date.now();
      const claimInsideFirstStart = await withDevelopmentStartSchemaLock(
        adapter,
        silentLogger,
        () =>
          firstStartSchemaLock(
            adapter,
            silentLogger
          )(() => lockCommand(adapter))
      );

      // Not a wait for its own holder: that would last a lease and then refuse.
      expect(claimInsideFirstStart).toBe(DEVELOPMENT_START_SYNC_COMMAND);
      expect(Date.now() - startedAt).toBeLessThan(WHILE_HELD_MS);
      expect(await lockCommand(adapter)).toBeNull();
    });

    it("in production, syncs at once without waiting for the holder or touching its claim", async () => {
      vi.stubEnv("NODE_ENV", "production");
      holder = startHolder(world, {
        command: HOLDER_COMMAND,
        leaseSeconds: 30,
        prefix: PREFIX,
      });
      await holder.printed("held");

      const startedAt = Date.now();
      const claimDuringSync = await withDevelopmentStartSchemaLock(
        adapter,
        silentLogger,
        () => lockCommand(adapter)
      );

      // Ran while the holder still held the lock, which it never waited for.
      expect(claimDuringSync).toBe(HOLDER_COMMAND);
      expect(Date.now() - startedAt).toBeLessThan(WHILE_HELD_MS);
      expect(holder.lines()).not.toContain("released");
      expect(await lockCommand(adapter)).toBe(HOLDER_COMMAND);

      holder.send("release");
      await holder.printed("released");
    });
  }
);
