/**
 * @module domains/schema/events/__tests__/legacy-detection
 * @since v0.0.3-alpha (Plan B)
 */
import { describe, it, expect } from "vitest";

import {
  detectLegacyBookkeeping,
  assertNoLegacyBookkeeping,
} from "../legacy-detection";

/** Minimal fake adapter — only `tableExists` is needed for detection. */
function adapterWith(presentTables: string[]) {
  const present = new Set(presentTables);
  return {
    tableExists: (name: string) => Promise.resolve(present.has(name)),
  };
}

describe("detectLegacyBookkeeping", () => {
  it("reports none when neither legacy table exists", async () => {
    const result = await detectLegacyBookkeeping(adapterWith([]));
    expect(result.hasLegacy).toBe(false);
    expect(result.tables).toEqual([]);
  });

  it("detects nextly_migrations when present", async () => {
    const result = await detectLegacyBookkeeping(
      adapterWith(["nextly_migrations"])
    );
    expect(result.hasLegacy).toBe(true);
    expect(result.tables).toContain("nextly_migrations");
  });

  it("detects both legacy tables", async () => {
    const result = await detectLegacyBookkeeping(
      adapterWith(["nextly_migrations", "nextly_migration_journal"])
    );
    expect(result.tables.sort()).toEqual([
      "nextly_migration_journal",
      "nextly_migrations",
    ]);
  });
});

describe("assertNoLegacyBookkeeping", () => {
  it("does not throw when clean", async () => {
    await expect(
      assertNoLegacyBookkeeping(adapterWith([]))
    ).resolves.toBeUndefined();
  });

  it("throws NEXTLY_LEGACY_BOOKKEEPING_DETECTED when legacy tables exist", async () => {
    await expect(
      assertNoLegacyBookkeeping(adapterWith(["nextly_migration_journal"]))
    ).rejects.toMatchObject({ code: "NEXTLY_LEGACY_BOOKKEEPING_DETECTED" });
  });
});
