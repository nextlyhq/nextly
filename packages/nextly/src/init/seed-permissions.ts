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

import { seedRolePresets } from "../database/seeders/role-presets";
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

/**
 * Seed every permission, then bring the preset roles in line with what now
 * exists -- the pair, because a boot that does one without the other leaves a
 * role describing content it has no grants for.
 *
 * 🔴 Preset seeding was in exactly the position custom permissions were in
 * before this module existed: performed by the instrumentation boot's post-init
 * tasks and by nothing else. An app that cold boots only through
 * `createDynamicHandlers` got its permissions and not the presets that are
 * supposed to cover them, so an administrator never received a new collection's
 * grants however many times it restarted. The dashboard's onboarding checklist
 * reads the preset predicates to decide whether creating a collection is a step
 * this reader could finish, so on that path it offered one that could not be.
 *
 * Ordered rather than merely grouped: a preset resolves against the permission
 * list as it then stands, so the seeding has to have happened first.
 *
 * Each half is attempted independently and neither failure propagates, because
 * a boot must not depend on tables a migration has not created yet. That is the
 * behaviour both call sites already had, moved here so they cannot drift apart
 * again.
 */
export async function seedPermissionsAndRolePresets(): Promise<void> {
  try {
    await seedAllPermissions();
  } catch {
    // Silently skip — permissions table may not exist yet (migrations not run),
    // or permissionSeedService may not be registered.
  }

  try {
    await seedRolePresets(getService("adapter"), getService("logger"));
  } catch {
    // Silently skip — roles/permissions tables may not exist yet.
  }
}
