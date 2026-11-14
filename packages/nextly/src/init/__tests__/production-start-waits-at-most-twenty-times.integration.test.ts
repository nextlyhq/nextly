/**
 * A production start waits on the database at most 20 times one after another before
 * `getNextly()` resolves, for 5 entities and for 50, on every configured dialect.
 *
 * Each case migrates a database of its own for one configuration of collections, Singles and
 * field groups, with an administrator, as a deployment that ran `nextly migrate` and finished
 * setup has it, then starts Nextly in production through `getNextly`, never the test harness.
 * Every round trip the driver makes (each statement, and each new connection) is held for a
 * fixed time and recorded (`sequential-waits`); the waits one after another are the longest
 * chain of round trips each begun after the one before it ended. Round trips sent together
 * count once; SQLite's driver blocks, so there every statement counts.
 *
 * The configuration starts no plugin and runs no migrations at start, the two the bound leaves
 * out. The count is the same for 5 entities and for 50: nothing the start waits for grows with
 * them. And nothing the start began is still on its way when it resolves: work it does not wait
 * for begins after it, so none of it lands among the start's own round trips by timing.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import {
  recordRoundTrips,
  sequentialWaits,
  type RoundTrip,
} from "../../__tests__/helpers/sequential-waits";
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  defineSingle,
  text,
} from "../../config";
import { createAdapter } from "../../database/factory";
import { seedSuperAdmin } from "../../database/seeders/super-admin";
import { shutdownServices } from "../../di/register";
import { getNextly, shutdownNextly, startSettled } from "../../init";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../plugins/test-nextly";
import { _resetEnvCache } from "../../shared/lib/env";
import { sanitizeConfig } from "../../shared/types/config";

/** The bound (`specs/safe-server-starts` D21). */
const MOST_WAITS = 20;

/** How long each round trip is held: long beside the time between two sent together. */
const DELAY_MS = 40;

/**
 * How long a new connection is held: not the statements' hold, so a statement waiting for a client
 * is never handed one by a tie between a released client and a newly connected one.
 */
const CONNECTION_DELAY_MS = 55;

/** `count` entities: collections, Singles and field groups in turn, each with a field. */
function entities(count: number) {
  const collections = [];
  const singles = [];
  const fieldGroups = [];
  for (let i = 0; i < count; i++) {
    const fields = [text({ name: "title" })];
    if (i % 3 === 0) {
      collections.push(defineCollection({ slug: `pwt_c${i}`, fields }));
    } else if (i % 3 === 1) {
      singles.push(defineSingle({ slug: `pwt_s${i}`, fields }));
    } else {
      fieldGroups.push(defineFieldGroup({ slug: `pwt_g${i}`, fields }));
    }
  }
  return { collections, singles, fieldGroups };
}

describe.each(getConfiguredTestDialects())(
  "a production start waits on the database at most 20 times (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void> = async () => undefined;

    const adapterFor = (): Promise<DrizzleAdapter> =>
      createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0]) as Promise<DrizzleAdapter>;

    async function freshDatabase(): Promise<void> {
      if (dialect === "sqlite") {
        const dir = mkdtempSync(join(tmpdir(), "nextly-pwt-"));
        url = `file:${join(dir, "start.db")}`;
        drop = async () => rmSync(dir, { recursive: true, force: true });
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_pwt");
        url = scratch.url;
        drop = scratch.drop;
      }
      // The start opens the database the environment names.
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      // A production start validates its address before it opens the database.
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      _resetEnvCache();
    }

    beforeEach(freshDatabase, 180_000);

    afterEach(async () => {
      await shutdownNextly();
      await shutdownServices();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
    });

    /**
     * Migrate the database for `shape` and seed it as a deployment that ran `nextly migrate`
     * and finished setup has it: tables, registry rows, permissions, the preset and Public
     * roles, and an administrator.
     */
    async function migrated(shape: ReturnType<typeof entities>): Promise<void> {
      vi.stubEnv("NODE_ENV", "test");
      _resetEnvCache();
      const setup = await adapterFor();
      await createTestNextly({
        adapter: setup as never,
        ...shape,
        seedPublic: true,
      });
      await seedSuperAdmin(setup, {
        email: "admin@pwt.test",
        password: "Pwt-Admin-Password-123!",
        silent: true,
      });
      await shutdownServices();
      await setup.disconnect().catch(() => undefined);
    }

    /**
     * The round trips a production start of `count` entities makes before it resolves, and those
     * among them still on their way when it does.
     */
    async function startOf(
      count: number
    ): Promise<RoundTrip[] & { open: RoundTrip[] }> {
      const shape = entities(count);
      await migrated(shape);
      vi.stubEnv("NODE_ENV", "production");
      _resetEnvCache();
      // Only to find the driver to hold: the recorder is installed on the driver's prototypes,
      // so the start's own connections are held and recorded.
      const probe = await adapterFor();
      const recorder = await recordRoundTrips(probe, dialect, {
        delayMs: DELAY_MS,
        connectionDelayMs: CONNECTION_DELAY_MS,
      });
      try {
        const begun = performance.now();
        await getNextly({
          config: sanitizeConfig(defineConfig(shape)) as never,
        });
        const resolved = performance.now();
        const made = recorder.trips.filter(
          trip => trip.startedAt >= begun && trip.startedAt < resolved
        );
        return Object.assign(made, {
          open: made.filter(
            trip => trip.endedAt === undefined || trip.endedAt > resolved
          ),
        });
      } finally {
        recorder.uninstall();
        await startSettled();
        await probe.disconnect().catch(() => undefined);
        await shutdownNextly();
        await shutdownServices();
      }
    }

    /** `trips`, short enough to read in a failure. */
    const shown = (trips: readonly RoundTrip[]) =>
      trips.map(trip => trip.text.replace(/\s+/g, " ").slice(0, 80));

    it("waits at most 20 times for 5 entities and for 50, the same number", async () => {
      const five = await startOf(5);
      await drop();
      await freshDatabase();
      const fifty = await startOf(50);

      expect(five.length, "the start was recorded").toBeGreaterThan(0);
      // Work the start does not wait for, begun while it still runs, lands among its round trips or
      // after them by the machine's timing: here, it is begun only once the start has resolved.
      expect(shown(five.open)).toEqual([]);
      expect(shown(fifty.open)).toEqual([]);
      expect(sequentialWaits(five), shown(five).join("\n")).toBeLessThanOrEqual(
        MOST_WAITS
      );
      expect(
        sequentialWaits(fifty),
        shown(fifty).join("\n")
      ).toBeLessThanOrEqual(MOST_WAITS);
      expect(sequentialWaits(fifty)).toBe(sequentialWaits(five));
    }, 600_000);
  }
);
