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

import type { CollectedPermission } from "../../../plugins/permissions/collect-permissions";
import { SYSTEM_PERMISSIONS } from "./permission-seed-service";
import { SYSTEM_RESOURCES } from "../../../schemas/_zod/rbac";
import { RESERVED_SLUGS } from "../../../shared/sql-reserved";
import { RESERVED_COLLECTION_NAMES } from "../../dynamic-collections/services/dynamic-collection-validation-service";

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

  it("seeds the three release authorities, and keeps scheduling separate", () => {
    // A release is ASSEMBLED and then COMMITTED, and those are different
    // powers. Creating one and choosing its members changes nothing a reader
    // can see; scheduling it is the act that puts content live later. Folding
    // them into a single permission would mean anyone who may draft a release
    // may also publish the site's content at a time of their choosing.
    const releaseSlugs = SYSTEM_PERMISSIONS.filter(
      p => p.resource === "content-releases"
    ).map(p => p.slug);

    expect(releaseSlugs.sort()).toEqual([
      "create-content-releases",
      "publish-content-releases",
      "read-content-releases",
    ]);
  });

  it("does not seed a release permission nothing enforces yet", () => {
    // The control for the case above, and the reason it is exactly three.
    // Seeding `update-releases` or `delete-releases` now would teach the admin
    // a vocabulary the server ignores: the surfaces that would check them do
    // not exist. They arrive with those surfaces.
    const releaseActions = SYSTEM_PERMISSIONS.filter(
      p => p.resource === "content-releases"
    ).map(p => p.action);

    expect(releaseActions).not.toContain("update");
    expect(releaseActions).not.toContain("delete");
  });

  it("does NOT reserve the word a site would use for press releases", () => {
    // Registering a system resource reserves its name for collections and
    // Singles. `releases` is a word real sites use for CONTENT — "press
    // releases" is among the most common collections on a corporate site — so
    // reserving it would fail an existing install at boot, and reclassify a
    // Schema-Builder collection's permissions as system ones, silently costing
    // preset roles their access.
    //
    // The other reserved names (`media`, `settings`, `users`) read as system
    // concepts. This one reads as content, which is exactly why it needed a
    // different word.
    expect(SYSTEM_RESOURCES as readonly string[]).not.toContain("releases");
    expect(SYSTEM_RESOURCES as readonly string[]).toContain("content-releases");
  });

  it("reserves the webhooks slug so a collection cannot share its permissions", () => {
    // Permission identity is action + resource. A collection slugged `webhooks`
    // would produce the same `read-webhooks` / `update-webhooks` rows these
    // system permissions use, so a content role granted them could read
    // endpoint configuration and reveal signing secrets.
    expect((RESERVED_SLUGS as readonly string[]).includes("webhooks")).toBe(
      true
    );
  });

  it("reserves the webhooks name on the Builder path too", () => {
    // Builder-created collections never reach the code-first validator, so
    // RESERVED_SLUGS alone would leave the collision reachable through the
    // Schema Builder.
    expect(
      (RESERVED_COLLECTION_NAMES as readonly string[]).includes("webhooks")
    ).toBe(true);
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

describe("a plugin declaring a permission on a Builder entity", () => {
  /**
   * A collection that exists only in `dynamic_collections`, and a plugin
   * declaring a permission on its slug.
   *
   * `collectCustomPermissions` decides what an entity is from the CONFIG, so a
   * Builder collection is invisible to it and its permissions are collected as
   * custom. Attaching an owner then makes the row look plugin-provided, and the
   * role presets grant Editor on `!isSystem && !isPlugin` — so the permission
   * silently stops being granted, and becomes eligible for the orphan sweep the
   * day the plugin is removed.
   */
  async function permissionRow(
    handle: TestNextly,
    action: string,
    resource: string
  ): Promise<{ owner: string | null; orphaned_at: unknown } | undefined> {
    const rows = (await handle.adapter.executeQuery(
      `SELECT owner, orphaned_at FROM permissions WHERE action = '${action}' AND resource = '${resource}'`
    )) as unknown as Array<{ owner: string | null; orphaned_at: unknown }>;
    return rows[0];
  }

  /**
   * The shape the collector produces, built in full rather than cast.
   *
   * `group` and `danger` are required on `CollectedPermission` and are what the seeder passes to
   * `ensurePermission`, so a partial object silenced with a cast would stop exercising the path
   * production takes the moment either began to matter.
   */
  function declared(
    overrides: Pick<CollectedPermission, "action" | "resource"> &
      Partial<CollectedPermission>
  ): CollectedPermission {
    return {
      slug: `${overrides.action}-${overrides.resource}`,
      name: `${overrides.action} ${overrides.resource}`,
      owner: "some-plugin",
      source: "plugin",
      group: "Plugin",
      danger: false,
      ...overrides,
    };
  }

  async function bootWithBuilderCollection(): Promise<TestNextly> {
    const handle = await bootWithCoreTables();
    await handle.adapter.executeQuery(
      // Every NOT NULL column, so the row is one the registry would accept. The seeder reads
      // only `slug`, but a partial insert fails before it gets there.
      `INSERT INTO dynamic_collections
         (id, slug, labels, table_name, fields, timestamps, status, localized,
          source, locked, schema_hash, schema_version, migration_status, created_at, updated_at)
       VALUES ('dc1', 'reports', '{}', 'reports', '[]', 1, 0, 0, 'ui', 0, 'h1', 1, 'applied', 0, 0)`
    );
    return handle;
  }

  it("leaves the permission unowned, so presets still grant it", async () => {
    const handle = await bootWithBuilderCollection();
    current = handle;

    const seeder = handle.getService("permissionSeedService");
    await seeder.seedAllCollectionPermissions();
    await seeder.seedCustomPermissions([
      declared({ action: "publish", resource: "reports" }),
    ]);

    // The row has to EXIST and be unowned. Asserting only that the owner is falsy also passes
    // when the built-in seeding never ran, which is the state where there is no permission for
    // the preset to grant at all — the opposite of what this protects.
    const row = await permissionRow(handle, "publish", "reports");
    expect(row).toBeDefined();
    expect(row?.owner).toBeNull();
  });

  it("repairs a row an earlier version already attributed to the plugin", async () => {
    // The common case on upgrade. Nothing else revisits an attribution while the declaration is
    // still present, so withholding ownership from here on would fix new installs and leave every
    // existing one exactly as broken — the Editor grant still missing.
    const handle = await bootWithBuilderCollection();
    current = handle;

    const seeder = handle.getService("permissionSeedService");
    await seeder.seedAllCollectionPermissions();
    await handle.adapter.executeQuery(
      `UPDATE permissions SET owner = 'some-plugin' WHERE action = 'publish' AND resource = 'reports'`
    );
    expect((await permissionRow(handle, "publish", "reports"))?.owner).toBe(
      "some-plugin"
    );

    await seeder.seedCustomPermissions([
      declared({ action: "publish", resource: "reports" }),
    ]);

    expect(
      (await permissionRow(handle, "publish", "reports"))?.owner
    ).toBeNull();
  });

  it("un-marks a row the orphan sweep retired while it was misattributed", async () => {
    // The declaration was present, then absent for one boot, then present again. The sweep marks
    // an owned row it no longer sees; giving the row back without clearing that mark strands it,
    // because the sweep skips a row with no owner and `listPermissions` filters marked rows out
    // before the presets are seeded. The permission exists, its collection exists, and Editor is
    // still not granted it.
    const handle = await bootWithBuilderCollection();
    current = handle;

    const seeder = handle.getService("permissionSeedService");
    await seeder.seedAllCollectionPermissions();
    await handle.adapter.executeQuery(
      `UPDATE permissions SET owner = 'some-plugin', orphaned_at = 1
         WHERE action = 'publish' AND resource = 'reports'`
    );

    await seeder.seedCustomPermissions([
      declared({ action: "publish", resource: "reports" }),
    ]);

    const row = await permissionRow(handle, "publish", "reports");
    expect(row?.owner).toBeNull();
    expect(row?.orphaned_at).toBeNull();
  });

  it("is not fooled by a declaration that differs only in case", async () => {
    // `ensurePermission` finds an existing row with `LOWER(action) = LOWER(action)`, so an exact
    // comparison here is walked straight past and the owner is patched anyway.
    const handle = await bootWithBuilderCollection();
    current = handle;

    const seeder = handle.getService("permissionSeedService");
    await seeder.seedAllCollectionPermissions();
    await seeder.seedCustomPermissions([
      declared({ action: "Publish", resource: "Reports" }),
    ]);

    const row = await permissionRow(handle, "publish", "reports");
    expect(row).toBeDefined();
    expect(row?.owner).toBeNull();
  });

  it("leaves a CRUD declaration owned by its plugin, as it is today", () => {
    // Deliberately NOT withheld. An unowned row is granted to Editor by the presets, so holding
    // ownership back here would open a plugin route guarded by `delete-reports` that today is
    // protected precisely because the plugin owns the row. Refusing the declaration outright is
    // the right answer and is a larger change; this keeps the existing behaviour rather than
    // trading one bug for another.
    return (async () => {
      const handle = await bootWithBuilderCollection();
      current = handle;

      const seeder = handle.getService("permissionSeedService");
      await seeder.seedAllCollectionPermissions();
      await seeder.seedCustomPermissions([
        declared({ action: "delete", resource: "reports" }),
      ]);

      const row = await permissionRow(handle, "delete", "reports");
      expect(row?.owner).toBe("some-plugin");
    })();
  });

  it("still lets a plugin own a permission on a resource that is not an entity", async () => {
    const handle = await bootWithCoreTables();
    current = handle;

    const seeder = handle.getService("permissionSeedService");
    await seeder.seedCustomPermissions([
      declared({ action: "run", resource: "imports" }),
    ]);

    const row = await permissionRow(handle, "run", "imports");
    expect(row?.owner).toBe("some-plugin");
  });
});
