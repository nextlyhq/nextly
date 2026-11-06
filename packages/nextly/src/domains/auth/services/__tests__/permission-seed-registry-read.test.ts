/**
 * A registry table that cannot be read is a failed seeding, unless it does not
 * exist yet.
 *
 * Collection and Single permissions are seeded for the slugs the registry
 * tables list. When that read fails, no permission for any of them is written.
 * Kept quiet, the seeding reported no error, and a caller took it for complete:
 * a plugin role created then would lack those grants for good. A table a
 * migration has not created yet is the one failure that is no failure, since
 * it lists nothing. The adapter here is a stand-in whose registry read fails.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it, beforeAll } from "vitest";

import { PermissionSeedService } from "../permission-seed-service";
import { loadDialectTables } from "../../../../database/dialect-tables";

// The postgresql tables this file reads; the unit setup loads only
// the run's own dialect, as an app's adapter would.
beforeAll(async () => {
  await Promise.all(["postgresql"].map(d => loadDialectTables(d)));
});

/** A seed service whose every registry read fails with `failure`. */
function seedServiceReading(failure: Error): PermissionSeedService {
  const db = {
    select: () => ({ from: () => Promise.reject(failure) }),
  };
  const adapter = {
    getCapabilities: () => ({ dialect: "postgresql" }),
    getDrizzle: () => db,
  };
  return new PermissionSeedService(adapter as unknown as DrizzleAdapter, {
    debug() {},
    info() {},
    warn() {},
    error() {},
  });
}

/** What PostgreSQL reports for a table that does not exist. */
const missingTable = Object.assign(
  new Error('relation "dynamic_collections" does not exist'),
  { code: "42P01" }
);
const connectionReset = new Error("Connection terminated unexpectedly");

describe("seeding the permissions the registry lists", () => {
  it("counts a collection registry it could not read as an error", async () => {
    const result =
      await seedServiceReading(connectionReset).seedAllCollectionPermissions();
    expect(result.errors).toBe(1);
  });

  it("counts a Single registry it could not read as an error", async () => {
    const result =
      await seedServiceReading(connectionReset).seedAllSinglePermissions();
    expect(result.errors).toBe(1);
  });

  it("counts no error for a registry table that does not exist yet", async () => {
    const service = seedServiceReading(missingTable);
    expect((await service.seedAllCollectionPermissions()).errors).toBe(0);
    expect((await service.seedAllSinglePermissions()).errors).toBe(0);
  });
});
