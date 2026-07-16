/**
 * PermissionSeedService.cleanupOrphanedPermissions.
 *
 * Cleanup removes permissions whose resource no longer exists. A resource is
 * "known" if it is a system resource or a live collection/single/component —
 * which a plugin's resource is none of. `submissions` is not a collection;
 * `form-submissions` is, and they are different resources. So a plugin's
 * declared permission looked orphaned on name alone, and cleanup deleted it
 * along with every grant of it.
 *
 * `owner` is the ground truth cleanup was missing: a permission that records
 * the plugin that declared it was declared by something, whatever its resource
 * is called. Cleanup leaves those alone. Retiring a permission whose plugin
 * has genuinely gone is a separate question — absence from config is not
 * uninstall, and there is no uninstall event to read.
 *
 * Same boot pattern as the seedCustomPermissions test alongside this one: the
 * harness only creates code-first collection tables, so the core RBAC tables
 * are bootstrapped from the shared DDL helper.
 */
import { afterEach, describe, expect, it } from "vitest";

import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function bootWithCoreTables(): Promise<TestNextly> {
  const handle = await createTestNextly({});
  for (const statement of generateSqliteCoreTableStatements()) {
    await handle.adapter.executeQuery(statement);
  }
  return handle;
}

/** Slugs currently in the permissions table. */
async function listSlugs(handle: TestNextly): Promise<string[]> {
  const rows = (await handle.adapter.executeQuery(
    "SELECT slug FROM permissions ORDER BY slug"
  )) as unknown as Array<{ slug: string }>;
  return rows.map(r => String(r.slug));
}

describe("cleanupOrphanedPermissions", () => {
  it("keeps a plugin-declared permission whose resource is not a collection", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");

    await seed.seedCustomPermissions([
      {
        action: "export",
        resource: "submissions",
        slug: "export-submissions",
        name: "Export Submissions",
        owner: "@nextlyhq/plugin-form-builder",
      },
    ]);
    expect(await listSlugs(current)).toContain("export-submissions");

    await seed.cleanupOrphanedPermissions();

    expect(await listSlugs(current)).toContain("export-submissions");
  });

  it("does not revoke grants of a plugin-declared permission", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");

    const seeded = await seed.seedCustomPermissions([
      {
        action: "export",
        resource: "submissions",
        slug: "export-submissions",
        name: "Export Submissions",
        owner: "@nextlyhq/plugin-form-builder",
      },
    ]);
    const permissionId = seeded.newPermissionIds[0];

    await current.adapter.executeQuery(
      `INSERT INTO roles (id, name, slug, level, is_system, created_at, updated_at)
       VALUES ('role-1', 'Exporter', 'exporter', 0, 0, 0, 0)`
    );
    await current.adapter.executeQuery(
      `INSERT INTO role_permissions (id, role_id, permission_id, created_at)
       VALUES ('rp-1', 'role-1', '${permissionId}', 0)`
    );

    await seed.cleanupOrphanedPermissions();

    const grants = (await current.adapter.executeQuery(
      "SELECT permission_id FROM role_permissions WHERE role_id = 'role-1'"
    )) as unknown as Array<{ permission_id: string }>;
    expect(grants).toHaveLength(1);
  });

  // The other half: cleanup still has a job. A permission naming a resource
  // that no longer exists and that nothing declared is what it is for.
  it("removes a permission for a vanished resource that no plugin declared", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");

    await current.adapter.executeQuery(
      `INSERT INTO permissions (id, name, slug, action, resource, created_at, updated_at)
       VALUES ('p-gone', 'Read gone', 'read-gone', 'read', 'gone', 0, 0)`
    );
    expect(await listSlugs(current)).toContain("read-gone");

    await seed.cleanupOrphanedPermissions();

    expect(await listSlugs(current)).not.toContain("read-gone");
  });
});
