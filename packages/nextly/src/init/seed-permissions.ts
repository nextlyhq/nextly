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
import { isMissingTable } from "../domains/field-groups/migration/session";
import { describeError } from "../errors/describe-error";
import { collectCustomPermissions } from "../plugins/permissions/collect-permissions";
import { collectRoles } from "../plugins/roles/collect-roles";
import { seedPluginRoles } from "../plugins/roles/seed-roles";

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

/** The value Next.js gives `NEXT_PHASE` while `next build` runs. */
const NEXT_PRODUCTION_BUILD_PHASE = "phase-production-build";

/**
 * Seed every permission, then bring the preset roles and the plugin-declared
 * roles in line with what now exists -- together, because a boot that does one
 * without the others leaves a role describing content it has no grants for.
 *
 * 🔴 Preset seeding was in exactly the position custom permissions were in
 * before this module existed: performed by the instrumentation boot's post-init
 * tasks and by nothing else. An app that cold boots only through
 * `createDynamicHandlers` got its permissions and not the presets that are
 * supposed to cover them, so an administrator never received a new collection's
 * grants however many times it restarted. The dashboard's onboarding checklist
 * reads the preset predicates to decide whether creating a collection is a step
 * this reader could finish, so on that path it offered one that could not be.
 * Plugin-declared roles were the same again, seeded only by the post-init tasks,
 * so they are part of this one call too.
 *
 * Ordered rather than merely grouped: a role resolves against the permission
 * list as it then stands, so the permissions have to be seeded first.
 *
 * Each step is attempted independently, and a missing table is the one failure
 * kept quiet: a boot must not depend on tables a migration has not created yet.
 * Anything else is logged as an error. Swallowing every error left a site
 * without its preset roles and said nothing about why.
 */
export async function seedPermissionsAndRolePresets(): Promise<void> {
  // A production build boots Nextly too, when it prerenders a page that reads
  // through it, and it writes nothing here. It serves no request, and the first
  // runtime boot seeds before it does. It may run against a database other
  // deployments share, from a config older or newer than theirs, so its writes
  // would reach data it never serves. Next sets this phase for the build, and
  // skips `instrumentation.register()` in it for the same reason.
  if (process.env.NEXT_PHASE === NEXT_PRODUCTION_BUILD_PHASE) return;

  await seedingStep("permissions", seedAllPermissions);
  await seedingStep("role presets", () =>
    seedRolePresets(getService("adapter"), getService("logger"))
  );
  await seedingStep("plugin roles", () => {
    const config = getService("config");
    return seedPluginRoles(
      getService("adapter"),
      collectRoles(config, config.plugins ?? []),
      getService("logger")
    );
  });
}

/**
 * Run one seeding step, keeping quiet only about a table that does not exist
 * yet and logging anything else as an error.
 */
async function seedingStep(
  what: string,
  run: () => Promise<unknown>
): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (isMissingTableOnThisDatabase(error)) return;
    const message = `[Nextly] Seeding ${what} failed: ${describeError(error)}`;
    try {
      getService("logger").error(message);
    } catch {
      // No logger registered: the boot that failed this early still says so.
      console.error(message);
    }
  }
}

/**
 * Whether the error is the database saying a table does not exist, read by the
 * driver's own code for the dialect in use. Without an adapter there is no
 * dialect to read it by, and nothing is assumed.
 */
function isMissingTableOnThisDatabase(error: unknown): boolean {
  try {
    return isMissingTable(
      error,
      getService("adapter").getCapabilities().dialect
    );
  } catch {
    return false;
  }
}
