/**
 * PermissionSeedService.seedSystemPermissions — slug convention and healing.
 *
 * A permission's slug is `${action}-${resource}`, and the admin resolves
 * permissions by slug (`hasPermission("read-users")`), so a slug that
 * disagrees with its action is unreachable by the name every caller derives.
 *
 * `manage-api-keys` carried action `update` — the only such disagreement in
 * the seed — while its three siblings on the same resource follow the
 * convention and the routes enforce `("update", "api-keys")`.
 *
 * A row's identity is `(action, resource)` and grants reference it by id, so
 * a slug is a label, not a key: correcting one revokes nothing. That is why
 * `ensurePermission` can adopt the declared slug on a row that already
 * exists, which is what heals databases seeded before the fix rather than
 * leaving new installs and old ones on different names forever.
 *
 * Same boot pattern as the other seeder tests here: the harness creates only
 * code-first collection tables, so core RBAC tables come from the shared DDL.
 */
import { afterEach, describe, expect, it } from "vitest";

import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

import { SYSTEM_PERMISSIONS } from "./permission-seed-service";
import { SYSTEM_RESOURCES } from "../../../schemas/_zod/rbac";

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

async function slugFor(
  handle: TestNextly,
  action: string,
  resource: string
): Promise<string | undefined> {
  const rows = (await handle.adapter.executeQuery(
    `SELECT slug FROM permissions WHERE action = '${action}' AND resource = '${resource}'`
  )) as unknown as Array<{ slug: string }>;
  return rows[0] ? String(rows[0].slug) : undefined;
}

describe("system permission slugs", () => {
  it("derives every seeded slug from its own action and resource", () => {
    const mismatched = SYSTEM_PERMISSIONS.filter(
      p => p.slug !== `${p.action}-${p.resource}`
    );

    expect(mismatched).toEqual([]);
  });

  it("declares every seeded resource as a system resource", () => {
    // `cleanupOrphanedPermissions()` treats an owner-less permission whose
    // resource is not a system, collection, single or component resource as a
    // content type that has been deleted, and removes it together with its role
    // grants. A system permission missing from SYSTEM_RESOURCES therefore
    // survives seeding and disappears on the next cleanup pass, taking every
    // role's access to that surface with it.
    const undeclared = SYSTEM_PERMISSIONS.map(p => p.resource).filter(
      resource => !(SYSTEM_RESOURCES as readonly string[]).includes(resource)
    );

    expect(Array.from(new Set(undeclared))).toEqual([]);
  });

  it("seeds the api-keys update permission under the slug callers ask for", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");

    await seed.seedSystemPermissions();

    expect(await slugFor(current, "update", "api-keys")).toBe(
      "update-api-keys"
    );
  });

  // Databases seeded before the correction hold the old slug. Identity is
  // (action, resource), so re-seeding finds the same row and must bring its
  // label into line rather than leave it stranded.
  it("corrects a stale slug on a row that already exists", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");

    await current.adapter.executeQuery(
      `INSERT INTO permissions (id, name, slug, action, resource, created_at, updated_at)
       VALUES ('p-stale', 'Manage API Keys', 'manage-api-keys', 'update', 'api-keys', 0, 0)`
    );

    await seed.seedSystemPermissions();

    expect(await slugFor(current, "update", "api-keys")).toBe(
      "update-api-keys"
    );
  });

  it("keeps the row's id when correcting its slug, so grants survive", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");

    await current.adapter.executeQuery(
      `INSERT INTO permissions (id, name, slug, action, resource, created_at, updated_at)
       VALUES ('p-stale', 'Manage API Keys', 'manage-api-keys', 'update', 'api-keys', 0, 0)`
    );
    await current.adapter.executeQuery(
      `INSERT INTO roles (id, name, slug, level, is_system, created_at, updated_at)
       VALUES ('role-1', 'Ops', 'ops', 0, 0, 0, 0)`
    );
    await current.adapter.executeQuery(
      `INSERT INTO role_permissions (id, role_id, permission_id, created_at)
       VALUES ('rp-1', 'role-1', 'p-stale', 0)`
    );

    await seed.seedSystemPermissions();

    const rows = (await current.adapter.executeQuery(
      `SELECT id FROM permissions WHERE action = 'update' AND resource = 'api-keys'`
    )) as unknown as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(String(rows[0].id)).toBe("p-stale");
  });
});
