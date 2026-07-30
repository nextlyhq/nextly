import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { Logger } from "../../../../shared/types";
import { hashManifest, type ManifestEntry } from "../manifest";
import { MIGRATION_MARKER_VERSION } from "../state";
import { assertNoMigrationInFlight } from "../sync-guard";

const PLAN: ManifestEntry[] = [
  { kind: "registry", from: "dynamic_components", to: "dynamic_field_groups" },
];

/**
 * A `nextly_meta` stand-in. The guard reads through `MetaService`, which selects
 * from the meta table, so the double answers that select and nothing else.
 */
function adapterWith(marker: unknown): DrizzleAdapter {
  return {
    // `MetaService` picks its dialect-specific table through this, so a double
    // without it answers a query the real service never issues.
    getCapabilities: () => ({ dialect: "postgresql" }),
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
    slugsHash: "slugs-1",
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
