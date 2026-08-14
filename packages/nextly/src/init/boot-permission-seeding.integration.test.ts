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
 * an input to seeding. TWO mechanisms put a collection's permissions in place,
 * and both run ahead of any migration step on either path:
 *
 * `CollectionRegistryService` seeds them when the collection is REGISTERED,
 * which happens inside `registerServices`. And `seedAllPermissions` sweeps
 * `dynamic_collections`, which `registerServices` has already written to.
 *
 * So the property worth holding is the OUTCOME, and it is asserted here as one
 * sequence rather than as two separate mechanisms. Pinning either mechanism on
 * its own would fail an implementation that dropped it and kept the other,
 * which is a correct implementation — the route serves requests with the
 * permissions in place either way.
 *
 * The second test covers what only the sweep can do, which is a row that
 * reached `dynamic_collections` without going through registration.
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

    // A slug that is in no config, so registration cannot have seeded it. This
    // stands for a collection that reaches the table from migration metadata.
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
