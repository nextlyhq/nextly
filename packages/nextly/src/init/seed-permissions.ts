/**
 * The permission seeding every boot performs, in one place.
 *
 * Nextly has two boot paths that both have to leave the same rows behind: the
 * instrumentation boot, which runs post-init tasks explicitly, and the lazy
 * request-path boot in `createDynamicHandlers`, which registers services on the
 * first request. They were separate implementations, and the request path was
 * the shorter one — it seeded system, collection and single permissions but
 * never the plugin-declared custom ones, so an app that cold-booted only
 * through the route handler had no row and no super-admin grant for a
 * permission the admin was already describing.
 *
 * @module init/seed-permissions
 */

import { getService } from "../di/register";
import { collectCustomPermissions } from "../plugins/permissions/collect-permissions";

/**
 * Seed system, collection, single and plugin-declared permissions, then grant
 * whatever is new to super_admin.
 *
 * Idempotent, and safe to run on every startup: each seeder matches existing
 * rows rather than inserting blindly, and only the ids it reports as new are
 * granted.
 *
 * Throws nothing of its own — callers boot regardless of whether the
 * permissions table exists yet — but deliberately does not catch, so the two
 * boot paths keep their own logging.
 */
export async function seedAllPermissions(): Promise<void> {
  const permissionSeedService = getService("permissionSeedService");
  const systemResult = await permissionSeedService.seedSystemPermissions();
  const collectionResult =
    await permissionSeedService.seedAllCollectionPermissions();
  const singleResult = await permissionSeedService.seedAllSinglePermissions();

  const config = getService("config");
  const declared = collectCustomPermissions(config, config.plugins ?? []);
  const customResult =
    await permissionSeedService.seedCustomPermissions(declared);

  // Seeding only ever adds. A permission whose package has stopped declaring
  // it keeps the attribution it had, which is read to decide whether it is a
  // plugin's — so a declaration that goes away quietly changes what the
  // presets grant. Marked here, against the same list that was just seeded;
  // grants are untouched and nothing is deleted.
  await permissionSeedService.markOrphanedPermissions(declared);

  const allNewIds = [
    ...systemResult.newPermissionIds,
    ...collectionResult.newPermissionIds,
    ...singleResult.newPermissionIds,
    ...customResult.newPermissionIds,
  ];

  if (allNewIds.length > 0) {
    await permissionSeedService.assignNewPermissionsToSuperAdmin(allNewIds);
  }
}
