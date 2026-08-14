/**
 * Where a collection's permissions actually come from, and why the two boot
 * paths can disagree about ordering without disagreeing about outcome.
 *
 * Nextly boots from two places. `init.ts` migrates, then runs post-init tasks
 * (which call `seedAllPermissions`) in the background. The route handler's
 * `initializeServicesOnce` calls `seedAllPermissions` BEFORE it applies
 * pending migrations. Reading those two sequences side by side suggests a
 * request-triggered cold start seeds against a database that is not ready.
 *
 * It does not, and the reason is that nothing a pending migration produces is
 * an input to seeding. THREE mechanisms put a collection's permissions in
 * place, each covering rows the others cannot reach:
 *
 * 1. `CollectionRegistryService` seeds them when a collection is REGISTERED,
 *    which for a code-first collection happens inside `registerServices`.
 * 2. `seedAllPermissions` sweeps `dynamic_collections`, which
 *    `registerServices` has already written to. Both boot paths call it.
 * 3. `boot-apply.ts` calls `seedPermissionsForMigrationCollections` directly
 *    after `registerFromMigrations` inserts metadata rows, so a collection
 *    that exists only in a migration is seeded in the same pass.
 *
 * The first two run before either path applies a migration; the third runs as
 * part of applying one. So the ordering difference cannot cost a collection
 * its permissions, whichever route the collection arrived by.
 *
 * WHAT IS ASSERTED, and what is deliberately not. The first test drives (1)
 * and (2) as one sequence, in the order the request path runs them, and
 * asserts the OUTCOME. Pinning either on its own would fail an implementation
 * that dropped it and kept the other, which serves requests correctly.
 *
 * The second test covers what only the sweep reaches — a row that never went
 * through registration. It calls the sweep DIRECTLY, so it is a test of the
 * sweep and NOT of (3): removing `seedPermissionsForMigrationCollections`
 * would leave it green. Covering that call means driving
 * `registerFromMigrations` against a migrations directory, which is a fixture
 * this file does not build. Stated rather than implied, so the green here is
 * not read as coverage it does not have.
 */
import { afterEach, describe, expect, it } from "vitest";

import { generateSqliteCoreTableStatements } from "../database/sqlite-core-tables";
import { createTestNextly, type TestNextly } from "../plugins/test-nextly";

import { seedAllPermissions } from "./seed-permissions";

const CRUD_AND_LIFECYCLE = [
  "create-articles",
  "delete-articles",
  "publish-articles",
  "read-articles",
  "unpublish-articles",
  "update-articles",
];

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * Boot with one code-first collection and nothing else.
 *
 * This is deliberately `registerServices` and no more: no post-init tasks, no
 * `seedAllPermissions`, no migration step. It is the state the route handler
 * is in at the moment it reaches its own seeding call.
 */
async function bootRegisterServicesOnly(): Promise<TestNextly> {
  const handle = await createTestNextly({
    collections: [
      { slug: "articles", fields: [{ name: "title", type: "text" }] },
    ],
  });
  current = handle;
  // The core RBAC tables are not part of the code-first collection sync, so the
  // harness supplies them from the production DDL helper. Already-present
  // tables are left as they are.
  for (const statement of generateSqliteCoreTableStatements()) {
    await handle.adapter.executeQuery(statement).catch(() => undefined);
  }
  return handle;
}

async function permissionSlugsFor(
  handle: TestNextly,
  resource: string
): Promise<string[]> {
  const rows = (await handle.adapter.executeQuery(
    `SELECT slug FROM permissions WHERE resource = '${resource}'`
  )) as unknown as Array<{ slug: string }>;
  return rows.map(row => String(row.slug)).sort();
}

describe("permission seeding across the two boot paths", () => {
  it("leaves a code-first collection seeded once the request path has initialised", async () => {
    const handle = await bootRegisterServicesOnly();

    // The request path's own sequence, in its own order: register services,
    // then sweep. Nothing between them applies a migration, which is the
    // ordering the audit questioned.
    await seedAllPermissions();

    expect(await permissionSlugsFor(handle, "articles")).toEqual(
      CRUD_AND_LIFECYCLE
    );
  });

  it("sweeps dynamic_collections for rows registration never saw", async () => {
    const handle = await bootRegisterServicesOnly();

    // A slug that is in no config, so registration cannot have seeded it. It
    // exercises the sweep's own reach and is NOT a stand-in for the migration
    // path, which has its own seeding call that this test never runs.
    expect(await permissionSlugsFor(handle, "reports")).toEqual([]);

    await seedAllPermissions();
    expect(await permissionSlugsFor(handle, "reports")).toEqual([]);

    await handle.adapter.executeQuery(
      `INSERT INTO dynamic_collections
         (slug, labels, table_name, fields, schema_hash, created_at, updated_at)
       VALUES ('reports', '{}', 'dc_reports', '[]', 'h', '2026-01-01', '2026-01-01')`
    );

    await seedAllPermissions();
    expect(await permissionSlugsFor(handle, "reports")).toEqual([
      "create-reports",
      "delete-reports",
      "publish-reports",
      "read-reports",
      "unpublish-reports",
      "update-reports",
    ]);
  });
});
