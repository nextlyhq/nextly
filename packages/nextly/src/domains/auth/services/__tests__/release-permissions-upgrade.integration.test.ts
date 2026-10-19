/**
 * An existing installation gains `update-content-releases` and
 * `delete-content-releases`, granted so that nobody gains or loses anything.
 *
 * Before these two permissions existed, renaming a release went with
 * assembling it (`create-content-releases`) and abandoning one with the
 * authority that could cancel it (`publish-content-releases`). So the upgrade
 * grants `update-` to every role holding `create-`, `delete-` to every role
 * holding `publish-`, and both to super-admin, and to no other role.
 *
 * The database is put in the shape a release from before this change leaves
 * behind: a seeded install, the two permissions absent, the preset roles, and
 * custom roles holding the older release permissions in each combination. A
 * boot is then run, and every role's grants are compared before and after as
 * a SET of additions, so a seed that granted to every role, or to none, or to
 * the holders of the wrong permission, fails by naming the role it got wrong.
 *
 * And a second boot adds nothing, including to a role an administrator has
 * since taken a granted permission from; while a boot whose grants FAILED
 * leaves no permission behind, so the next boot creates it and grants it
 * whole.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

import { seedPermissionsAndRolePresets } from "../../../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { ServiceContainer } from "../../../../services/index";

const RESOURCE = "content-releases";

/** The custom roles an installation could have made, by what they hold. */
const CUSTOM_ROLES = {
  "release-assembler": ["create"],
  "release-launcher": ["publish"],
  "release-manager": ["create", "publish"],
  "release-reader": ["read"],
} as const;

interface Row {
  id: string;
  slug: string;
  action: string;
  resource: string;
}

function db(handle: TestNextly): DrizzleAdapter {
  return handle.adapter as unknown as DrizzleAdapter;
}

function services(handle: TestNextly): ServiceContainer {
  return new ServiceContainer(db(handle));
}

/** A boot: every permission seeded, then the presets brought into line. */
async function boot(): Promise<void> {
  await seedPermissionsAndRolePresets();
}

async function releasePermissions(handle: TestNextly): Promise<Row[]> {
  return db(handle).select<Row>("permissions", {
    where: { and: [{ column: "resource", op: "=", value: RESOURCE }] },
  });
}

/**
 * Remove the two permissions and every grant of them, as an installation
 * that predates them has neither.
 */
async function withoutTheNewPermissions(handle: TestNextly): Promise<void> {
  const ids = (await releasePermissions(handle))
    .filter(row => row.action === "update" || row.action === "delete")
    .map(row => String(row.id));
  expect(ids).toHaveLength(2);
  await db(handle).delete("role_permissions", {
    and: [{ column: "permissionId", op: "IN", value: ids }],
  });
  await db(handle).delete("permissions", {
    and: [{ column: "id", op: "IN", value: ids }],
  });
}

/**
 * Every release grant on the installation, as `role:permission` pairs, so two
 * snapshots compare as sets.
 */
async function releaseGrants(handle: TestNextly): Promise<Set<string>> {
  const permissions = new Map(
    (await releasePermissions(handle)).map(row => [String(row.id), row.slug])
  );
  const roles = new Map(
    (await db(handle).select<{ id: string; slug: string }>("roles", {})).map(
      row => [String(row.id), row.slug]
    )
  );
  const grants = await db(handle).select<{
    roleId: string;
    permissionId: string;
  }>("role_permissions", {});
  const pairs = new Set<string>();
  for (const grant of grants) {
    const permission = permissions.get(String(grant.permissionId));
    if (permission === undefined) continue;
    pairs.add(`${roles.get(String(grant.roleId))}:${permission}`);
  }
  return pairs;
}

/** Every assignment row on the installation, ids included. */
async function allAssignments(handle: TestNextly): Promise<string[]> {
  const rows = await db(handle).select<{
    id: string;
    roleId: string;
    permissionId: string;
  }>("role_permissions", {});
  return rows.map(row => `${row.id}:${row.roleId}:${row.permissionId}`).sort();
}

/**
 * An installation from before the change: seeded, with a super-admin holding
 * the release permissions it had, the presets, and the custom roles above.
 */
async function olderInstallation(dialect: TestDialect): Promise<TestNextly> {
  const handle = await createTestNextly(
    dialect === "sqlite" ? {} : { dialect }
  );
  await boot();
  await withoutTheNewPermissions(handle);

  const svc = services(handle);
  const byAction = new Map(
    (await releasePermissions(handle)).map(row => [row.action, String(row.id)])
  );
  const superAdmin = await svc.roles.ensureSuperAdminRole();
  for (const action of ["read", "create", "publish"]) {
    await svc.rolePermissions.addPermissionToRole(superAdmin.id, {
      action,
      resource: RESOURCE,
    });
  }
  for (const [slug, actions] of Object.entries(CUSTOM_ROLES)) {
    await svc.roles.createRole({
      name: slug,
      slug,
      permissionIds: actions.map(action => {
        const id = byAction.get(action);
        if (id === undefined) throw new Error(`no ${action} permission`);
        return id;
      }),
    });
  }
  return handle;
}

describe.each(getConfiguredTestDialects())(
  "the two newer release permissions, on an existing installation (%s)",
  dialect => {
    let handle: TestNextly | undefined;

    afterEach(async () => {
      await handle?.destroy();
      handle = undefined;
    });

    it("grants update- to create- holders and delete- to publish- holders, and nothing else", async () => {
      handle = await olderInstallation(dialect);
      const before = await releaseGrants(handle);
      // The fixture is the shape it claims: the older permissions are held,
      // the newer ones are nowhere.
      expect(before).toContain("release-assembler:create-content-releases");
      expect(before).toContain("release-launcher:publish-content-releases");
      expect(
        [...before].filter(
          pair =>
            pair.endsWith(":update-content-releases") ||
            pair.endsWith(":delete-content-releases")
        )
      ).toEqual([]);

      await boot();

      const after = await releaseGrants(handle);
      const added = [...after].filter(pair => !before.has(pair)).sort();
      const removed = [...before].filter(pair => !after.has(pair));
      expect(removed).toEqual([]);
      expect(added).toEqual(
        [
          // The presets: `admin` holds every release permission, and so
          // assembled and published releases before.
          "admin:update-content-releases",
          "admin:delete-content-releases",
          "release-assembler:update-content-releases",
          "release-launcher:delete-content-releases",
          "release-manager:update-content-releases",
          "release-manager:delete-content-releases",
          "super-admin:update-content-releases",
          "super-admin:delete-content-releases",
        ].sort()
      );
    });

    it("leaves no permission when a grant fails midway, and the next boot creates it with every grant", async () => {
      handle = await olderInstallation(dialect);
      const before = await releaseGrants(handle);

      // The seed's own grant write, made to fail on its second call: the
      // update permission has four holders here, so the first of its grants
      // lands and the second throws.
      const seed = handle.getService("permissionSeedService") as unknown as {
        writeGrant: (...args: unknown[]) => Promise<void>;
      };
      const write = seed.writeGrant.bind(seed);
      let calls = 0;
      const failing = vi
        .spyOn(seed, "writeGrant")
        .mockImplementation(async (...args: unknown[]) => {
          calls += 1;
          if (calls === 2) throw new Error("grant write failed");
          return write(...args);
        });
      await boot();
      failing.mockRestore();
      expect(calls).toBeGreaterThanOrEqual(2);

      // Neither the permission nor the grant that landed before the failure:
      // a later boot can only retry what is not there.
      expect(
        (await releasePermissions(handle)).map(row => row.action).sort()
      ).not.toContain("update");
      expect(
        [...(await releaseGrants(handle))].filter(pair =>
          pair.endsWith(":update-content-releases")
        )
      ).toEqual([]);

      await boot();

      const after = await releaseGrants(handle);
      expect([...after].filter(pair => !before.has(pair)).sort()).toEqual(
        [
          "admin:update-content-releases",
          "admin:delete-content-releases",
          "release-assembler:update-content-releases",
          "release-launcher:delete-content-releases",
          "release-manager:update-content-releases",
          "release-manager:delete-content-releases",
          "super-admin:update-content-releases",
          "super-admin:delete-content-releases",
        ].sort()
      );
    });

    it("adds nothing on a second boot, and does not give back a grant an administrator took away", async () => {
      handle = await olderInstallation(dialect);
      await boot();
      expect(await releaseGrants(handle)).toContain(
        "release-assembler:update-content-releases"
      );

      // An administrator decides the assembler should not rename releases.
      const assembler =
        await services(handle).roles.findRoleIdBySlug("release-assembler");
      if (assembler === null) throw new Error("no assembler role");
      await services(handle).rolePermissions.removePermissionFromRole(
        assembler.id,
        { action: "update", resource: RESOURCE }
      );
      const settled = await allAssignments(handle);

      await boot();

      // Every assignment row, ids included: nothing added, nothing rewritten.
      expect(await allAssignments(handle)).toEqual(settled);
      expect(await releaseGrants(handle)).not.toContain(
        "release-assembler:update-content-releases"
      );
    });
  }
);
