import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { Logger } from "../../../../shared/types";
import { hashManifest, type ManifestEntry } from "../manifest";
import { MIGRATION_MARKER_VERSION } from "../state";
import {
  assertNoMigrationInFlight,
  withMigrationExcluded,
} from "../sync-guard";

const PLAN: ManifestEntry[] = [
  { kind: "registry", from: "dynamic_components", to: "dynamic_field_groups" },
];

/**
 * A `nextly_meta` stand-in. The guard reads through `MetaService`, which selects
 * from the meta table, so the double answers that select and nothing else.
 */
function adapterWith(
  marker: unknown,
  over: { metaTableExists?: boolean } = {}
): DrizzleAdapter {
  return {
    // `MetaService` picks its dialect-specific table through this, so a double
    // without it answers a query the real service never issues.
    getCapabilities: () => ({ dialect: "postgresql" }),
    tableExists: async () => over.metaTableExists ?? true,
    getDrizzle: () => ({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () =>
              marker === undefined
                ? []
                : [{ key: "k", value: JSON.stringify(marker) }],
          }),
        }),
      }),
    }),
  } as unknown as DrizzleAdapter;
}

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

function migrating(over: Record<string, unknown> = {}) {
  return {
    version: MIGRATION_MARKER_VERSION,
    status: "migrating",
    direction: "up",
    migrationId: "run-1",
    step: 2,
    registryHash: "slugs-1",
    manifestHash: hashManifest(PLAN),
    appliedManifest: PLAN,
    ...over,
  };
}

describe("schema sync guard", () => {
  // Mid-run some tables carry pre-rename names and some post-rename, and the
  // registry pointers move one step at a time. `--remove-orphaned` deletes what
  // it cannot account for, so a sync here can drop half-renamed storage.
  it.each(["up", "down"] as const)(
    "refuses while a %s migration is in flight",
    async direction => {
      const error = await assertNoMigrationInFlight({
        adapter: adapterWith(migrating({ direction })),
        logger,
      }).catch((caught: unknown) => caught);

      expect(NextlyError.is(error)).toBe(true);
      if (NextlyError.is(error)) {
        expect(error.logContext?.reason).toMatch(/migration is in flight/);
        // The refusal names the run so an operator can find it rather than only
        // learning that something is wrong.
        expect(error.logContext?.migrationId).toBe("run-1");
        expect(error.logContext?.step).toBe(2);
      }
    }
  );

  it("allows a sync on a database with no marker", async () => {
    await expect(
      assertNoMigrationInFlight({ adapter: adapterWith(undefined), logger })
    ).resolves.toBeUndefined();
  });

  it("allows a sync once a run has settled", async () => {
    await expect(
      assertNoMigrationInFlight({
        adapter: adapterWith({
          version: MIGRATION_MARKER_VERSION,
          status: "settled",
          generation: "legacy",
        }),
        logger,
      })
    ).resolves.toBeUndefined();
  });

  // Core-table setup returns as soon as it finds `users`, so a database created
  // before `nextly_meta` existed reaches this guard without it. No meta table
  // means no marker was ever recorded, which is untouched storage rather than a
  // reason to abort every sync on that database.
  it("allows a sync on a database that has no meta table", async () => {
    await expect(
      assertNoMigrationInFlight({
        adapter: adapterWith(migrating(), { metaTableExists: false }),
        logger,
      })
    ).resolves.toBeUndefined();
  });

  // Absence of the table is the only thing treated as absence. A read that
  // fails for any other reason still refuses, because an unreadable marker may
  // describe renamed objects.
  it("still refuses when the marker table exists but cannot be read", async () => {
    const adapter = {
      getCapabilities: () => ({ dialect: "postgresql" }),
      tableExists: async () => true,
      getDrizzle: () => ({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.reject(new Error("connection lost")),
            }),
          }),
        }),
      }),
    } as unknown as DrizzleAdapter;

    await expect(
      assertNoMigrationInFlight({ adapter, logger })
    ).rejects.toThrowError();
  });

  // An unreadable marker may still describe renamed objects, so it must not be
  // treated as absence — which would let the sync proceed over exactly the
  // storage this guard exists to protect.
  it("refuses on a marker it cannot read", async () => {
    await expect(
      assertNoMigrationInFlight({
        adapter: adapterWith({ version: 999, status: "migrating" }),
        logger,
      })
    ).rejects.toThrowError(NextlyError);
  });
});

/**
 * An adapter that models the lock row rather than accepting every write.
 *
 * The lock is the whole mechanism under test, so a double that let a second
 * claim succeed would certify exclusion that does not exist.
 */
function lockingAdapter(options: {
  marker?: unknown;
  heldBy?: string | null;
  lockTableExists?: boolean;
}) {
  const lock: { seeded: boolean; owner: string | null } = {
    seeded: options.heldBy !== undefined,
    owner: options.heldBy ?? null,
  };
  const ddl: string[] = [];

  function matches(where: unknown): boolean {
    const clauses =
      (where as { and?: { column: string; value: unknown }[] }).and ?? [];
    return clauses.every(clause =>
      clause.column === "owner" ? lock.owner === clause.value : true
    );
  }

  const adapter = {
    getCapabilities: () => ({ dialect: "postgresql" }),
    getDrizzle: () => ({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () =>
              options.marker === undefined
                ? []
                : [{ key: "k", value: JSON.stringify(options.marker) }],
          }),
        }),
      }),
    }),
    executeQuery: async (sql: string) => {
      ddl.push(sql);
      return [];
    },
    tableExists: async (name: string) =>
      name === "nextly_field_group_lock"
        ? (options.lockTableExists ?? true)
        : true,
    transaction: async (work: (ctx: unknown) => Promise<unknown>) =>
      work({
        lockRow: async () => undefined,
        selectOne: async () =>
          lock.seeded ? { id: 1, owner: lock.owner } : null,
        insert: async (_table: string, data: { owner: string | null }) => {
          lock.seeded = true;
          lock.owner = data.owner;
          return data;
        },
        update: async (
          _table: string,
          data: { owner: string | null },
          where: unknown
        ) => {
          // An occupied row refuses a new claim, exactly as the real one does:
          // `acquire` reads back what it wrote, so a double that overwrote a
          // held lock would report a successful claim over a live migration.
          if (matches(where)) lock.owner = data.owner;
          return [];
        },
      }),
  } as unknown as DrizzleAdapter;

  return { adapter, ownerNow: () => lock.owner, ddlIssued: () => [...ddl] };
}

describe("holding the exclusion for the whole sync", () => {
  // The point of the change: a point-in-time read only says a migration had not
  // started by the instant of the read, and a sync runs far longer than that.
  it("holds the migration lock while the work runs, and releases it after", async () => {
    const { adapter, ownerNow } = lockingAdapter({});
    let ownerDuringWork: string | null = null;

    await withMigrationExcluded({ adapter, logger, label: "db:sync" }, () => {
      ownerDuringWork = ownerNow();
      return Promise.resolve();
    });

    expect(ownerDuringWork).not.toBeNull();
    expect(ownerNow()).toBeNull();
  });

  it("refuses, and never runs the work, while a migration holds the lock", async () => {
    const { adapter } = lockingAdapter({ heldBy: "field-group-migration#abc" });
    const work = vi.fn(() => Promise.resolve());

    const error = await withMigrationExcluded(
      { adapter, logger, label: "db:sync" },
      work
    ).catch((caught: unknown) => caught);

    expect(NextlyError.is(error)).toBe(true);
    expect(work).not.toHaveBeenCalled();
  });

  // `--no-auto-sync` is chosen precisely to keep schema changes in migration
  // files, and a role granted DML but not DDL would be refused outright by a
  // CREATE TABLE. The sync therefore never creates the lock table.
  it("issues no DDL while taking the exclusion", async () => {
    const { adapter, ddlIssued } = lockingAdapter({});
    await withMigrationExcluded({ adapter, logger, label: "db:sync" }, () =>
      Promise.resolve()
    );
    expect(ddlIssued().filter(sql => /CREATE TABLE/i.test(sql))).toEqual([]);
  });

  // Absence of the lock table means no run has ever been recorded here, so
  // there is nothing to be excluded from — and nothing worth creating a table
  // for on a database whose role may not be allowed to.
  it("runs the work when no lock table exists", async () => {
    const { adapter, ddlIssued } = lockingAdapter({ lockTableExists: false });
    const work = vi.fn(() => Promise.resolve());

    await withMigrationExcluded({ adapter, logger, label: "db:sync" }, work);

    expect(work).toHaveBeenCalledTimes(1);
    expect(ddlIssued()).toEqual([]);
  });

  // Watch mode documents Ctrl+C as the way to stop, and the claim is durable
  // with no expiry, so without this a routine interrupt would leave a claim
  // only an operator could clear — blocking every later sync and migration.
  it("releases the claim when the process is interrupted", async () => {
    const { adapter, ownerNow } = lockingAdapter({});
    const exits: string[] = [];
    const kill = vi
      .spyOn(process, "kill")
      .mockImplementation((_pid: number, signal?: string | number) => {
        exits.push(String(signal));
        return true;
      });

    let ownerWhileHeld: string | null = null;
    await withMigrationExcluded(
      { adapter, logger, label: "db:sync watch" },
      async () => {
        ownerWhileHeld = ownerNow();
        process.emit("SIGINT");
        // Let the release settle before the work returns, so this observes the
        // signal path rather than the ordinary one in `finally`.
        await new Promise(resolve => setImmediate(resolve));
        expect(ownerNow()).toBeNull();
      }
    );

    expect(ownerWhileHeld).not.toBeNull();
    expect(exits).toContain("SIGINT");
    kill.mockRestore();
  });

  // Holding the lock is necessary and not sufficient. An operator who cleared a
  // dead run's lock row without settling its marker would otherwise be let
  // straight into half-renamed storage.
  it("still refuses on an in-flight marker when the lock is free", async () => {
    const { adapter } = lockingAdapter({ marker: migrating() });
    const work = vi.fn(() => Promise.resolve());

    const error = await withMigrationExcluded(
      { adapter, logger, label: "db:sync" },
      work
    ).catch((caught: unknown) => caught);

    expect(NextlyError.is(error)).toBe(true);
    if (NextlyError.is(error)) {
      expect(error.logContext?.reason).toMatch(/migration is in flight/);
    }
    expect(work).not.toHaveBeenCalled();
  });
});
