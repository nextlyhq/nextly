/**
 * 🔴 The boot drift check must ask about the registry the database really has.
 *
 * It reads two things that have to agree: the desired core shape, and the list
 * of tables to introspect the live side under. Leaving either on the legacy
 * spelling means a migrated database is asked about a table it does not have,
 * the one it does have is never looked at, and every single start reports the
 * core schema as behind — a warning about a database that is correct, which an
 * operator cannot act on and will learn to ignore.
 */
import { describe, expect, it, vi } from "vitest";

import { MIGRATION_TARGET } from "../../domains/field-groups/migration/manifest";
import { STORAGE_FORMAT } from "../../schemas/storage-format";
import { warnIfCoreSchemaIsBehind } from "../first-run";

const introspectLiveSnapshot = vi.fn();

vi.mock("../../domains/schema/pipeline/diff/introspect-live", () => ({
  introspectLiveSnapshot: (...args: unknown[]) =>
    introspectLiveSnapshot(...args),
}));

vi.mock("../../domains/field-groups/storage/resolve-storage-names", () => ({
  // The database in these cases has been migrated, which is the only state
  // where the two spellings can disagree.
  resolveRegistryNameFromCatalog: () =>
    Promise.resolve(MIGRATION_TARGET.registryTable),
}));

/** Enough adapter for the check; the drift comparison itself is not the subject. */
const adapter = {
  dialect: "postgresql" as const,
  getDrizzle: () => ({}),
  tableExists: () => Promise.resolve(true),
  executeQuery: () => Promise.resolve([]),
};

describe("the boot core-schema drift check on a migrated database", () => {
  it("introspects the migrated registry and never the legacy one", async () => {
    introspectLiveSnapshot.mockResolvedValue({ tables: [] });

    // The production timeout is deliberately overridden. `warnIfCoreSchemaIsBehind` races the
    // check against a 2s deadline so a slow database cannot delay boot, and the check begins with
    // two dynamic imports — under a loaded full-suite run those lose the race, the check never
    // reaches `introspectLiveSnapshot`, and this fails with "called 0 times" while passing alone.
    // What is under test is WHICH tables get introspected, not whether the check beats a clock.
    await warnIfCoreSchemaIsBehind(
      adapter,
      {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      60_000
    );

    expect(introspectLiveSnapshot).toHaveBeenCalledTimes(1);
    const names = introspectLiveSnapshot.mock.calls[0][2] as string[];
    expect(names).toContain(MIGRATION_TARGET.registryTable);
    expect(names).not.toContain(STORAGE_FORMAT.registryTable);
  });
});
