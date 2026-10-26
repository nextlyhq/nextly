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
import { getService } from "../di/service-access";
import { PermissionService } from "../domains/auth/services/permission-service";
import {
  permissionIdsBySlug,
  seedPublicReadGrants,
} from "../domains/auth/services/public-read-grant";
import {
  PUBLIC_ROLE_SLUG,
  seedPublicRole,
} from "../domains/auth/services/public-role";
import { RoleMutationService } from "../domains/auth/services/role/role-mutation-service";
import { RoleQueryService } from "../domains/auth/services/role/role-query-service";
import { RolePermissionService } from "../domains/auth/services/role-permission-service";
import { isMissingTable } from "../domains/field-groups/migration/session";
import { describeError } from "../errors/describe-error";
import { NextlyError } from "../errors/nextly-error";
import { collectCustomPermissions } from "../plugins/permissions/collect-permissions";
import { collectRoles } from "../plugins/roles/collect-roles";
import { seedPluginRoles } from "../plugins/roles/seed-roles";
import { permissionSlug, SYSTEM_RESOURCES } from "../schemas/_zod/rbac";
import { consoleLogger } from "../shared/types";

/**
 * Seed system, collection, single and plugin-declared permissions, then grant
 * whatever is new to super_admin.
 *
 * Idempotent, and safe to run on every startup: each seeder matches existing
 * rows rather than inserting blindly, and only the ids it reports as new are
 * granted.
 *
 * Does not catch, so its caller decides what a failure means. The seeders
 * count a permission they could not write rather than throw, so once
 * everything that could be written has been, a count above zero is thrown
 * here: a caller that reads success from the absence of an error would
 * otherwise take a partial seeding for a whole one.
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

  const failed =
    systemResult.errors +
    collectionResult.errors +
    singleResult.errors +
    customResult.errors;
  if (failed > 0) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage: "An unexpected error occurred.",
      logMessage: `${failed} permission(s) could not be seeded`,
      logContext: {
        system: systemResult.errors,
        collections: collectionResult.errors,
        singles: singleResult.errors,
        custom: customResult.errors,
      },
    });
  }
}

/** The value Next.js gives `NEXT_PHASE` while `next build` runs. */
const NEXT_PRODUCTION_BUILD_PHASE = "phase-production-build";

/**
 * The seeding in flight in this process, on `globalThis` for the reason the
 * rest of the boot state is: Next.js and Turbopack can evaluate this module in
 * more than one server graph, and the instrumentation boot and the request-path
 * boot can each hold a different copy.
 */
const globalForSeeding = globalThis as unknown as {
  __nextly_seeding?: Promise<void>;
  __nextly_seedingHolds?: Set<Promise<void>>;
};

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
 * Each step is attempted on its own, except that plugin roles wait for the
 * permissions (see `seedEverything`). A missing table is the one failure kept
 * quiet: a boot must not depend on tables a migration has not created yet.
 * Anything else is logged as an error. Swallowing every error left a site
 * without its preset roles and said nothing about why.
 *
 * One run at a time per process: a second call while one is in flight returns
 * that run, and {@link awaitBootSeeding} waits for it.
 */
export function seedPermissionsAndRolePresets(): Promise<void> {
  // A production build boots Nextly too, when it prerenders a page that reads
  // through it, and it writes nothing here. It serves no request, and the first
  // runtime boot seeds before it does. It may run against a database other
  // deployments share, from a config older or newer than theirs, so its writes
  // would reach data it never serves. Next sets this phase for the build, and
  // skips `instrumentation.register()` in it for the same reason.
  if (process.env.NEXT_PHASE === NEXT_PRODUCTION_BUILD_PHASE) {
    return Promise.resolve();
  }

  // A boot that arrives while another is seeding joins that run rather than
  // starting a second one over the same rows.
  const inFlight = globalForSeeding.__nextly_seeding;
  if (inFlight) return inFlight;

  const run = seedEverything().finally(() => {
    if (globalForSeeding.__nextly_seeding === run) {
      globalForSeeding.__nextly_seeding = undefined;
    }
  });
  globalForSeeding.__nextly_seeding = run;
  return run;
}

/**
 * Hold the seeding gate from before a boot registers the services until it has
 * seeded, and return the release. Releasing twice is harmless, so a `finally`
 * can release whatever path the boot took.
 *
 * The services read as registered as soon as `registerServices` returns, and
 * the registering boot does more before it seeds: a drift check, template
 * setup. A boot arriving in that interval finds the services registered and
 * no seeding in flight yet. Held from before registration, the gate is closed
 * for the whole of it.
 */
export function holdBootSeeding(): () => void {
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const holds = (globalForSeeding.__nextly_seedingHolds ??= new Set());
  holds.add(held);
  return () => {
    holds.delete(held);
    release();
  };
}

/**
 * Wait until no boot is registering or seeding. Resolves at once when none is.
 *
 * The two boot paths keep separate latches, and each seeds only when it is the
 * one that registered the services. The other one then finds the services
 * registered and would serve while the first has yet to write the roles, so a
 * boot that skips the seeding waits here instead: for every hold a registering
 * boot has taken, then for the run in flight. Never rejects: the seeding logs
 * its own failures.
 */
export async function awaitBootSeeding(): Promise<void> {
  const holds = globalForSeeding.__nextly_seedingHolds;
  if (holds) await Promise.all(holds);
  await globalForSeeding.__nextly_seeding;
}

async function seedEverything(): Promise<void> {
  const permissionsSeeded = await seedingStep(
    "permissions",
    seedAllPermissions
  );
  await seedingStep("role presets", () =>
    seedRolePresets(getService("adapter"), getService("logger"))
  );
  // The role visitors are judged by. Made once and then left to the owner,
  // unlike a preset: only its permissions change after it exists.
  const publicRoleSeeded = await seedingStep("public role", () => {
    const roles = new RoleMutationService(
      getService("adapter"),
      getService("logger")
    );
    return seedPublicRole({
      publicSlugHolder: () => roles.publicSlugHolder(),
      moveRoleOffPublicSlug: id => roles.moveRoleOffPublicSlug(id),
      ensurePublicRole: () => roles.ensurePublicRole(),
      meta: getService("metaService"),
      logger: getService("logger"),
    });
  });
  // Public's read where code lets anyone read, granted once per entity so an
  // owner's change to it stands, and the startup listing of what it lacks.
  if (publicRoleSeeded) {
    await seedingStep("public role's reads", seedPublicRoleReads);
  }
  // A plugin role is created once and never revisited: a later boot skips a
  // role whose slug exists, so as not to undo an administrator's edits. Created
  // after a permission step that failed part-way, it would lack the grants that
  // step never wrote, for good. So it waits for a boot whose permissions all
  // seeded. A preset is different: it is brought back to its whole set on every
  // boot, so the next one completes it.
  if (!permissionsSeeded) return;
  await seedingStep("plugin roles", () => {
    const config = getService("config");
    return seedPluginRoles(
      getService("adapter"),
      collectRoles(config, config.plugins ?? []),
      getService("logger")
    );
  });
}

function seedPublicRoleReads(): Promise<void> {
  const adapter = getService("adapter");
  const logger = getService("logger");
  const grants = () => new RolePermissionService(adapter, logger);
  return seedPublicReadGrants({
    publicRoleId: async () =>
      (
        await new RoleQueryService(adapter, logger).findRoleIdBySlug(
          PUBLIC_ROLE_SLUG
        )
      )?.id ?? null,
    targets: async () => {
      const rbac = getService("rbacAccessControlService");
      const [collections, singles] = await Promise.all([
        getService("collectionRegistryService").getAllLabels(),
        getService("singleRegistryService").getAllLabels(),
      ]);
      return [
        ...collections
          .filter(
            ({ slug }) =>
              !(SYSTEM_RESOURCES as readonly string[]).includes(slug)
          )
          .map(({ slug }) => ({ kind: "collection" as const, slug })),
        ...singles.map(({ slug }) => ({ kind: "single" as const, slug })),
      ].map(target => ({
        ...target,
        access: rbac.getRegisteredTarget(target.slug)?.access,
      }));
    },
    permissionIds: () =>
      permissionIdsBySlug(new PermissionService(adapter, logger)),
    publicHolds: async roleId =>
      new Set(
        (await grants().listRolePermissions(roleId)).map(
          ({ action, resource }) => permissionSlug(action, resource)
        )
      ),
    grantRead: (roleId, resource) =>
      grants().addPermissionToRole(roleId, { action: "read", resource }),
    meta: getService("metaService"),
    logger,
  });
}

/**
 * Run one seeding step, keeping quiet only about a table that does not exist
 * yet and logging anything else as an error. Says whether the step completed.
 */
async function seedingStep(
  what: string,
  run: () => Promise<unknown>
): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (error) {
    if (isMissingTableOnThisDatabase(error)) return false;
    const message = `[Nextly] Seeding ${what} failed: ${describeError(error)}`;
    try {
      getService("logger").error(message);
    } catch {
      // No logger registered: the boot that failed this early still says so.
      consoleLogger.error(message);
    }
    return false;
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
