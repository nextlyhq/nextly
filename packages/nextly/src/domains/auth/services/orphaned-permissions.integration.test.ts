/**
 * Marking a permission whose package stopped declaring it.
 *
 * `ensurePermission` writes `owner` only for a permission that is declared, so
 * the attribution freezes the moment a declaration goes. That was cosmetic
 * until presets began reading `owner` to tell a plugin's permission from a
 * content type's — a stale attribution now silently changes what a preset
 * grants.
 *
 * Marked rather than deleted, and grants left alone: absence from config is
 * not an uninstall. A disabled plugin still declares its permissions, a config
 * can be edited by mistake, and there is no uninstall event to tell the
 * difference — so revoking on that evidence would take access away as a side
 * effect of a config change.
 */
import { afterEach, describe, expect, it } from "vitest";

import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { Logger } from "../../../services/shared";

import { PermissionService } from "./permission-service";

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as Logger;

/** Not in the DI container — the seeder builds its own too. */
const permissionsOf = (handle: TestNextly) =>
  new PermissionService(handle.adapter, silentLogger);

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

const EXPORT_SUBMISSIONS = {
  action: "export",
  resource: "submissions",
  slug: "export-submissions",
  name: "Export Submissions",
  owner: "@nextlyhq/plugin-form-builder",
};

/** A declaration that speaks for the plugin owning `EXPORT_SUBMISSIONS`. */
const FORMS = { owners: new Set([EXPORT_SUBMISSIONS.owner]) };

async function orphanedAtFor(
  handle: TestNextly,
  slug: string
): Promise<unknown> {
  const rows = (await handle.adapter.executeQuery(
    `SELECT orphaned_at FROM permissions WHERE slug = '${slug}'`
  )) as unknown as Array<{ orphaned_at: unknown }>;
  return rows[0]?.orphaned_at ?? null;
}

describe("markOrphanedPermissions", () => {
  it("leaves a declared permission alone", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");

    await seed.seedCustomPermissions([EXPORT_SUBMISSIONS]);
    await seed.markOrphanedPermissions([EXPORT_SUBMISSIONS], FORMS);

    expect(await orphanedAtFor(current, "export-submissions")).toBeNull();
  });

  it("marks a permission its package has stopped declaring", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");

    await seed.seedCustomPermissions([EXPORT_SUBMISSIONS]);
    // The plugin dropped the declaration; nothing else changed.
    await seed.markOrphanedPermissions([], FORMS);

    expect(await orphanedAtFor(current, "export-submissions")).not.toBeNull();
  });

  it("unmarks a permission that is declared again", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");

    await seed.seedCustomPermissions([EXPORT_SUBMISSIONS]);
    await seed.markOrphanedPermissions([], FORMS);
    expect(await orphanedAtFor(current, "export-submissions")).not.toBeNull();

    await seed.markOrphanedPermissions([EXPORT_SUBMISSIONS], FORMS);

    expect(await orphanedAtFor(current, "export-submissions")).toBeNull();
  });

  it("keeps the grants of a permission it marks", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");

    const seeded = await seed.seedCustomPermissions([EXPORT_SUBMISSIONS]);
    const permissionId = seeded.newPermissionIds[0];

    await current.adapter.executeQuery(
      `INSERT INTO roles (id, name, slug, level, is_system, created_at, updated_at)
       VALUES ('role-1', 'Exporter', 'exporter', 0, 0, 0, 0)`
    );
    await current.adapter.executeQuery(
      `INSERT INTO role_permissions (id, role_id, permission_id, created_at)
       VALUES ('rp-1', 'role-1', '${permissionId}', 0)`
    );

    await seed.markOrphanedPermissions([], FORMS);

    const grants = (await current.adapter.executeQuery(
      "SELECT permission_id FROM role_permissions WHERE role_id = 'role-1'"
    )) as unknown as unknown[];
    expect(grants).toHaveLength(1);
  });

  // An owner the declaration does not speak for may have added the permission
  // outside it (a plugin installed after the migration was written), so its
  // permission keeps its state.
  it("leaves a permission whose owner it does not speak for", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");

    await seed.seedCustomPermissions([EXPORT_SUBMISSIONS]);
    await seed.markOrphanedPermissions([], { owners: new Set(["app"]) });

    expect(await orphanedAtFor(current, "export-submissions")).toBeNull();
  });

  // The point before a migration may be a list of live permissions rather
  // than a declaration by owner: each owner of one it held is spoken for.
  it("speaks for the owner of a permission the point before held", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");

    await seed.seedCustomPermissions([EXPORT_SUBMISSIONS]);
    await seed.markOrphanedPermissions([], {
      owners: new Set(["app"]),
      heldSlugs: new Set(["export-submissions"]),
    });

    expect(await orphanedAtFor(current, "export-submissions")).not.toBeNull();
  });

  // A content type's CRUD has no declaring package, so nothing here applies to
  // it — its lifecycle follows the collection.
  it("ignores a permission with no owner", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");
    await seed.seedSystemPermissions();

    await seed.markOrphanedPermissions([], FORMS);

    expect(await orphanedAtFor(current, "read-users")).toBeNull();
  });
});

describe("a marked permission", () => {
  it("stops being offered as a choice", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");
    const permissions = permissionsOf(current);

    await seed.seedCustomPermissions([EXPORT_SUBMISSIONS]);
    await seed.markOrphanedPermissions([], FORMS);

    const listed = await permissions.listPermissions({ page: 1, limit: 1000 });

    expect(listed.data.map(p => p.slug)).not.toContain("export-submissions");
  });

  it("is still visible to the cleanup that retires it", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");
    const permissions = permissionsOf(current);

    await seed.seedCustomPermissions([EXPORT_SUBMISSIONS]);
    await seed.markOrphanedPermissions([], FORMS);

    const listed = await permissions.listPermissions({
      page: 1,
      limit: 1000,
      includeOrphaned: true,
    });

    expect(listed.data.map(p => p.slug)).toContain("export-submissions");
  });

  it("is retired by cleanup, which a declared one is not", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");

    await seed.seedCustomPermissions([EXPORT_SUBMISSIONS]);

    // Still declared: cleanup must not touch it, even though `submissions` is
    // not a collection and never will be.
    await seed.markOrphanedPermissions([EXPORT_SUBMISSIONS], FORMS);
    await seed.cleanupOrphanedPermissions();
    expect(await orphanedAtFor(current, "export-submissions")).toBeNull();

    // Declaration gone, then an explicit cleanup: now it goes.
    await seed.markOrphanedPermissions([], FORMS);
    await seed.cleanupOrphanedPermissions();

    const rows = (await current.adapter.executeQuery(
      "SELECT slug FROM permissions WHERE slug = 'export-submissions'"
    )) as unknown as unknown[];
    expect(rows).toHaveLength(0);
  });
});

describe("re-declaring a permission that was marked orphaned", () => {
  it("clears the mark, so it returns to the menu", async () => {
    // `listPermissions` hides orphans by default, and preset-role syncing reads
    // that list. A permission left marked after its declaration came back
    // exists, is declared, and is still ungrantable.
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");

    await seed.seedCustomPermissions([EXPORT_SUBMISSIONS]);
    await seed.markOrphanedPermissions([], FORMS);
    expect(await orphanedAtFor(current, "export-submissions")).not.toBeNull();

    // The declaration returns — a plugin reinstalled, or a built-in seeder
    // adopting a slug a plugin used to own.
    await seed.seedCustomPermissions([EXPORT_SUBMISSIONS]);

    expect(await orphanedAtFor(current, "export-submissions")).toBeNull();
  });

  it("makes it visible to the default permission listing again", async () => {
    current = await bootWithCoreTables();
    const seed = current.getService("permissionSeedService");
    const permissions = permissionsOf(current);

    await seed.seedCustomPermissions([EXPORT_SUBMISSIONS]);
    await seed.markOrphanedPermissions([], FORMS);

    const hidden = await permissions.listPermissions({ limit: 1000 });
    expect(hidden.data.some(p => p.slug === "export-submissions")).toBe(false);

    await seed.seedCustomPermissions([EXPORT_SUBMISSIONS]);

    const shown = await permissions.listPermissions({ limit: 1000 });
    expect(shown.data.some(p => p.slug === "export-submissions")).toBe(true);
  });
});
