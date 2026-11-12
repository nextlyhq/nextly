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

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { isNextBuildPhase } from "@nextlyhq/adapter-drizzle/build-phase";
import { inArray } from "drizzle-orm";

import type { AccessTarget } from "../auth/access/decide";
import { getDialectTables } from "../database";
import {
  ROLE_PRESETS,
  seedRolePresets,
} from "../database/seeders/role-presets";
import type { NextlyServiceConfig } from "../di/register";
import { getService } from "../di/service-access";
import { PermissionSeedService } from "../domains/auth/services/permission-seed-service";
import { PermissionService } from "../domains/auth/services/permission-service";
import {
  permissionIdsBySlug,
  recordPublicReadNotice,
  seedPublicReadGrants,
  withdrawUndeclaredPluginGrants,
} from "../domains/auth/services/public-read-grant";
import {
  PUBLIC_ROLE_SLUG,
  publicRoleMade,
  seedPublicRole,
  type PublicRoleSeeded,
} from "../domains/auth/services/public-role";
import { RoleMutationService } from "../domains/auth/services/role/role-mutation-service";
import { RoleQueryService } from "../domains/auth/services/role/role-query-service";
import { RolePermissionService } from "../domains/auth/services/role-permission-service";
import { isMissingTable } from "../domains/field-groups/migration/session";
import type { MetaService } from "../domains/meta/services/meta-service";
import { describeError } from "../errors/describe-error";
import { NextlyError } from "../errors/nextly-error";
import {
  collectCustomPermissions,
  type PermissionConfigSource,
} from "../plugins/permissions/collect-permissions";
import type { PluginDefinition } from "../plugins/plugin-context";
import { collectPublicGrants } from "../plugins/public-grants/collect-public-grants";
import { collectRoles } from "../plugins/roles/collect-roles";
import { seedPluginRoles } from "../plugins/roles/seed-roles";
import { permissionSlug, SYSTEM_RESOURCES } from "../schemas/_zod/rbac";
import { consoleLogger, type Logger } from "../shared/types";

import { runBoundedDiagnostic } from "./bounded-diagnostic";
import type { RuleContextConfig } from "./code-rule-context";

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
  // What a start reads and writes comes from the registered services. It adds
  // and updates, and marks nothing orphaned: a permission its build no longer
  // declares leaves only when `nextly migrate` applies the recorded migration
  // that drops it, so an older or a misconfigured build starting against the
  // database cannot take a permission away.
  await seedDeclaredPermissions({
    permissionSeedService: getService("permissionSeedService"),
    config: getService("config"),
  });
}

/** What seeding the declared permissions reads the declarations from and writes through. */
interface PermissionSeeding {
  permissionSeedService: PermissionSeedService;
  /** The configuration: its collections, Singles, own permissions and plugins. */
  config: PermissionConfigSource & { plugins?: PluginDefinition[] };
}

/**
 * Seed system, collection, single and app- and plugin-declared permissions,
 * then grant whatever is new to super_admin: the one implementation a start
 * (`seedAllPermissions`) and `nextly migrate`
 * (`seedPermissionsRolesAndPresets`) share, so the two never add a different
 * set. Neither marks a permission orphaned here: `nextly migrate` does that
 * as each recorded migration applies, from the permissions its snapshot
 * declares, never from the configuration a run or a start happens to have.
 *
 * Throws once everything that could be written has been, when a seeder
 * counted a permission it could not write (see `seedAllPermissions`).
 */
async function seedDeclaredPermissions({
  permissionSeedService,
  config,
}: PermissionSeeding): Promise<void> {
  const systemResult = await permissionSeedService.seedSystemPermissions();
  // Every entity's permissions against one read of the table: the start's one
  // ensuring of them, which the registry syncs leave to it.
  const { collections: collectionResult, singles: singleResult } =
    await permissionSeedService.seedAllEntityPermissions();

  const declared = collectCustomPermissions(config, config.plugins ?? []);
  const customResult =
    await permissionSeedService.seedCustomPermissions(declared);

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

/**
 * The permissions, the declared roles and the preset roles' grants, as
 * `nextly migrate` writes them once its migrations and registry rows are in
 * place: every missing permission (core's, each registered collection's and
 * Single's, the app's and each configured plugin's), then each preset role's
 * grants set by difference, then the roles the app and its plugins declare.
 *
 * The same services a start seeds through, on the command's own connection
 * and configuration rather than the registered ones, which a command never
 * has: `seedDeclaredPermissions`, `seedRolePresets`, the Public role's steps
 * and `seedPluginRoles`. Each writes only where it finds a difference, so a
 * database already in step is read and not written. It marks nothing orphaned
 * (the command does that as each migration applies).
 *
 * The Public role, the role visitors are judged by, is made here too, and
 * granted the read of each collection and Single whose read rule answers a
 * visitor `true`, `read-media`, and what the plugins declare for it, each once
 * (`seedPublicReadGrants`). A production start makes none of it, so without
 * this a site set up by `nextly migrate` alone would refuse every visitor. The
 * rules are asked as a start asks them, with what a start of this
 * configuration would tell them (`withRuleContextOf`).
 *
 * Throws when a permission could not be written, before any role is set: a
 * declared role is made once and never revisited, so made against a partial
 * set it would lack those grants for good. A run that throws is repeated
 * whole by the next.
 */
export async function seedPermissionsRolesAndPresets(args: {
  adapter: DrizzleAdapter;
  logger: Logger;
  /** The configuration the command loaded; `roles` only where a caller has them. */
  config: PermissionSeeding["config"] &
    Pick<NextlyServiceConfig, "roles"> &
    RuleContextConfig;
}): Promise<void> {
  const { adapter, logger, config } = args;
  // Loaded here, where a command needs them, rather than with this module,
  // which every start imports.
  const { withRuleContextOf } = await import("./code-rule-context");
  const publicRole = publicRoleSteps(
    await commandPublicRoleDeps(adapter, logger, config)
  );
  // Decided before anything is seeded, as a start decides it (`seedEverything`).
  await publicRole.recordNotice();
  await seedDeclaredPermissions({
    permissionSeedService: new PermissionSeedService(adapter, logger),
    config,
  });
  await seedRolePresets(adapter, logger);
  const made = await publicRole.make();
  if (made.made) {
    await withRuleContextOf(adapter, config, () =>
      seedPublicReadGrants(publicRole.grantSeeding())
    );
  } else {
    // A start in development holds the claim to make it: the next run makes it.
    logger.warn(
      "The Public role is being made by a start in another process, so its grants were not set. Run `nextly migrate` again to set them."
    );
  }
  // A declared role bundling a permission not seeded yet waits for a run that
  // has it, rather than being made without it for good.
  await seedPluginRoles(
    adapter,
    collectRoles(config, config.plugins ?? []),
    logger,
    { deferIncomplete: true }
  );
}

/** What the Public role's steps read and write through. */
interface PublicRoleDeps {
  adapter: DrizzleAdapter;
  logger: Logger;
  meta: MetaService;
  /** The roles the app and its plugins declare, and the plugins' public grants. */
  config: Pick<NextlyServiceConfig, "roles"> & {
    plugins?: PluginDefinition[];
  };
  /** Every collection's and Single's slug, as the registry holds them. */
  entities: () => Promise<{
    collections: ReadonlyArray<{ slug: string }>;
    singles: ReadonlyArray<{ slug: string }>;
  }>;
  /** The target an entity's code-defined rules are registered under, if any. */
  registeredTarget: (slug: string) => AccessTarget | undefined;
}

/** The Public role's steps, as a start's seeding and `nextly migrate` both take them. */
function publicRoleSteps(deps: PublicRoleDeps): {
  /** Whether this site is told once which reads its visitors lost. */
  recordNotice: () => Promise<void>;
  /** Makes the Public role, once per install; who holds the claim where another does. */
  make: () => Promise<PublicRoleSeeded>;
  /** What the Public role's grants are seeded through. */
  grantSeeding: () => Parameters<typeof seedPublicReadGrants>[0];
} {
  const { adapter, logger, meta, config } = deps;
  return {
    recordNotice: () =>
      recordPublicReadNotice({
        meta,
        publicRoleMade: () => publicRoleMade(meta),
        seededBefore: () => presetRoleExists(adapter),
      }),
    make: () => {
      const roles = new RoleMutationService(adapter, logger);
      // The names roles the app and its plugins declare go by, which the
      // built-in role leaves to them though they are made after it.
      const declaredNames = [
        ...(config.roles ?? []),
        ...(config.plugins ?? []).flatMap(
          plugin => plugin.contributes?.roles ?? []
        ),
      ].map(role => role.name);
      return seedPublicRole({
        publicSlugHolder: () => roles.publicSlugHolder(),
        moveRoleOffPublicSlug: id => roles.moveRoleOffPublicSlug(id),
        ensurePublicRole: () => roles.ensurePublicRole(declaredNames),
        unlinkPublicRole: async () => {
          const holder = await roles.publicSlugHolder();
          if (holder?.builtIn) await roles.unlinkPublicRole(holder.id);
        },
        meta,
        logger,
      });
    },
    grantSeeding: () => publicGrantSeeding(deps),
  };
}

/** The Public role's steps on a start's registered services. */
function startPublicRoleDeps(): PublicRoleDeps {
  return {
    adapter: getService("adapter"),
    logger: getService("logger"),
    meta: getService("metaService"),
    config: getService("config"),
    entities: async () => {
      const [collections, singles] = await Promise.all([
        getService("collectionRegistryService").getAllLabels(),
        getService("singleRegistryService").getAllLabels(),
      ]);
      return { collections, singles };
    },
    registeredTarget: slug =>
      getService("rbacAccessControlService").getRegisteredTarget(slug),
  };
}

/**
 * The Public role's steps on a command's own connection and configuration:
 * the registry as the command's migrations left it, and the code-defined
 * access its configuration declares, as a start of it registers them.
 */
async function commandPublicRoleDeps(
  adapter: DrizzleAdapter,
  logger: Logger,
  config: PublicRoleDeps["config"] &
    Pick<NextlyServiceConfig, "collections" | "singles">
): Promise<PublicRoleDeps> {
  const [
    { codeDefinedAccessTargets },
    { CollectionRegistryService },
    { MetaService },
    { SingleRegistryService },
  ] = await Promise.all([
    import("./code-rule-context"),
    import("../domains/collections/services/collection-registry-service"),
    import("../domains/meta/services/meta-service"),
    import("../domains/singles/services/single-registry-service"),
  ]);
  const targets = new Map(
    codeDefinedAccessTargets(config).map(target => [target.slug, target])
  );
  return {
    adapter,
    logger,
    meta: new MetaService(adapter, logger),
    config,
    entities: async () => {
      const [collections, singles] = await Promise.all([
        new CollectionRegistryService(adapter, logger).getAllLabels(),
        new SingleRegistryService(adapter, logger).getAllLabels(),
      ]);
      return { collections, singles };
    },
    registeredTarget: slug => targets.get(slug),
  };
}

/** How long after a failure to make the Public role it is tried again. */
const RETRY_AFTER_FAILURE_MS = 60_000;

/**
 * The seeding in flight in this process, on `globalThis` for the reason the
 * rest of the boot state is: Next.js and Turbopack can evaluate this module in
 * more than one server graph, and the instrumentation boot and the request-path
 * boot can each hold a different copy.
 */
const globalForSeeding = globalThis as unknown as {
  __nextly_seeding?: Promise<void>;
  __nextly_seedingHolds?: Set<Promise<void>>;
  /** How many seeding runs have been asked for in this process. */
  __nextly_seedingAsked?: number;
  /** Each hold, with how many seeding runs had been asked for when it was taken. */
  __nextly_seedingHeldAt?: Map<Promise<void>, number>;
  /** How many seeding runs had been asked for when the run in flight began. */
  __nextly_seedingBeganAt?: number;
  __nextly_publicRoleRetry?: ReturnType<typeof setTimeout>;
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
  // Asked for, whatever happens next: a hold taken before this no longer has a
  // seeding to come (`bootSeedingFollows`).
  globalForSeeding.__nextly_seedingAsked =
    (globalForSeeding.__nextly_seedingAsked ?? 0) + 1;
  // A production build boots Nextly too, when it prerenders a page that reads
  // through it, and it writes nothing here. It serves no request, and the first
  // runtime boot seeds before it does. It may run against a database other
  // deployments share, from a config older or newer than theirs, so its writes
  // would reach data it never serves. Next sets this phase for the build, and
  // skips `instrumentation.register()` in it for the same reason.
  if (isNextBuildPhase()) {
    return Promise.resolve();
  }

  // A boot that arrives while another is seeding joins that run rather than
  // starting a second one over the same rows.
  const inFlight = globalForSeeding.__nextly_seeding;
  if (inFlight) {
    // A boot that took its hold after the run in flight began registered what
    // that run may already have read past, so it seeds once that run is done
    // rather than taking it for its own.
    const began = globalForSeeding.__nextly_seedingBeganAt ?? 0;
    const heldSince = [
      ...(globalForSeeding.__nextly_seedingHeldAt?.values() ?? []),
    ].some(askedWhenHeld => askedWhenHeld >= began);
    if (!heldSince) return inFlight;
    return inFlight
      .catch(() => undefined)
      .then(() => seedPermissionsAndRolePresets());
  }

  globalForSeeding.__nextly_seedingBeganAt =
    globalForSeeding.__nextly_seedingAsked;
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
  const heldAt = (globalForSeeding.__nextly_seedingHeldAt ??= new Map());
  heldAt.set(held, globalForSeeding.__nextly_seedingAsked ?? 0);
  return () => {
    holds.delete(held);
    heldAt.delete(held);
    release();
  };
}

/**
 * Whether a start's own seeding is still to come: a boot holds the seeding gate
 * (`holdBootSeeding`) and no seeding run has been asked for since it took it.
 * Work the seeding would repeat, such as a registry sync ensuring each entity's
 * permissions, is left to it then, so a start ensures each permission once.
 * Once a run has been asked for, the start's seeding is behind it, and work
 * done after it (an entity the request-path boot's apply registers from a
 * migration) seeds for itself.
 */
export function bootSeedingFollows(): boolean {
  const asked = globalForSeeding.__nextly_seedingAsked ?? 0;
  for (const askedWhenHeld of globalForSeeding.__nextly_seedingHeldAt?.values() ??
    []) {
    if (askedWhenHeld === asked) return true;
  }
  return false;
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
  // Whether this site is told once which reads its visitors lost to the
  // Public role: decided before anything is seeded, the one time a site an
  // earlier release ran on can be told from a new install. The Public role
  // waits for it: made first, it would leave such a site recorded as not due
  // at the next boot, and never told. Tried again in a while, as a failure to
  // make the role is.
  // Built in each step, so a service a step cannot reach fails that step
  // alone, as each step's own lookups did.
  const publicRole = () => publicRoleSteps(startPublicRoleDeps());
  const noticeRecorded = await seedingStep("public read notice", async () => {
    try {
      await publicRole().recordNotice();
    } catch (error) {
      if (!isMissingTableOnThisDatabase(error)) {
        retrySeedingAt(Date.now() + RETRY_AFTER_FAILURE_MS);
      }
      throw error;
    }
  });
  const permissionsSeeded = await seedingStep(
    "permissions",
    seedAllPermissions
  );
  await seedingStep("role presets", () =>
    seedRolePresets(getService("adapter"), getService("logger"))
  );
  // The role visitors are judged by. Made once and then left to the owner,
  // unlike a preset: only its permissions change after it exists.
  const publicRoleSeeded =
    noticeRecorded &&
    (await seedingStep("public role", async () => {
      try {
        const seeded = await publicRole().make();
        if (!seeded.made) retrySeedingAt(seeded.retryAt);
      } catch (error) {
        // Not left unmade until the next start: tried again in a while, as
        // when another boot holds the claim. A table not created yet is the
        // migrations' to make, not this retry's.
        if (!isMissingTableOnThisDatabase(error)) {
          retrySeedingAt(Date.now() + RETRY_AFTER_FAILURE_MS);
        }
        throw error;
      }
    }));
  // Public's read where code lets anyone read, and what plugins declare for
  // it, each granted once so an owner's change to it stands, and the startup
  // listing of what it lacks. Only after every permission seeded: a grant
  // whose permission is missing could be neither made nor listed, so a later
  // boot does it whole.
  if (publicRoleSeeded && permissionsSeeded) {
    await seedingStep("public role's grants", () =>
      seedPublicReadGrants(publicRole().grantSeeding())
    );
  } else if (publicRoleSeeded) {
    // Taking back a plugin grant no enabled plugin declares any longer needs
    // no permission made, so it is not left for a later boot.
    await seedingStep("public role's undeclared plugin grants", () =>
      withdrawUndeclaredPluginGrants(publicRole().grantSeeding())
    );
  }
  // A plugin role is created once and never revisited: a later boot skips a
  // role whose slug exists, so as not to undo an administrator's edits. Created
  // after a permission step that failed part-way, it would lack the grants that
  // step never wrote, for good. So it waits for a boot whose permissions all
  // seeded. A preset is different: it is brought back to its whole set on every
  // boot, so the next one completes it.
  if (permissionsSeeded) {
    await seedingStep("plugin roles", () => {
      const config = getService("config");
      return seedPluginRoles(
        getService("adapter"),
        collectRoles(config, config.plugins ?? []),
        getService("logger")
      );
    });
  }
  // Roles an earlier release gave a retired `manage-` permission, each named
  // at every start until `nextly upgrade` converts it. Named last: the writers
  // above store a retired permission as the plain four, so a preset, the
  // Public role or a plugin role holding one is converted by this seeding, and
  // naming it before would ask for an upgrade this boot already did.
  // The scan reads `role_permissions` by a column no dialect indexes, so it is
  // bounded as the core schema check is: a slow or stalled read lets the boot
  // go on without the warning rather than wait for the driver's own timeout.
  await seedingStep("retired manage check", () =>
    runBoundedDiagnostic({
      run: async () => {
        const { formatRetiredManageWarning, rolesHoldingRetiredManage } =
          await import("../domains/auth/retired-manage");
        const holding = await rolesHoldingRetiredManage(getService("adapter"));
        if (holding.length > 0) {
          getService("logger").warn(formatRetiredManageWarning(holding));
        }
      },
      logger: getService("logger"),
      timeoutMs: RETIRED_MANAGE_CHECK_TIMEOUT_MS,
      timedOutMessage:
        "[nextly] Retired manage permission check timed out; continuing startup.",
      failedMessagePrefix:
        "[nextly] Could not check for roles holding a retired manage permission: ",
    })
  );
}

/**
 * Whether a boot's seeding has run on this database: a preset role exists,
 * as every boot's seeding makes them and nothing else does.
 */
async function presetRoleExists(adapter: DrizzleAdapter): Promise<boolean> {
  const { roles } = getDialectTables();
  const db = adapter.getDrizzle<{
    select(fields: Record<string, unknown>): {
      from(table: unknown): {
        where(condition: unknown): { limit(count: number): Promise<unknown[]> };
      };
    };
  }>();
  const found = await db
    .select({ id: roles.id })
    .from(roles)
    .where(
      inArray(
        roles.slug,
        ROLE_PRESETS.map(({ slug }) => slug)
      )
    )
    .limit(1);
  return found.length > 0;
}

/** How long the retired manage check may hold a boot, as the schema check may. */
const RETIRED_MANAGE_CHECK_TIMEOUT_MS = 2_000;

/** What the Public role's grant steps need, from `deps`. */
function publicGrantSeeding(
  deps: PublicRoleDeps
): Parameters<typeof seedPublicReadGrants>[0] {
  const { adapter, logger, meta } = deps;
  const grants = new RolePermissionService(adapter, logger);
  return {
    // Only once the Public role is made and recorded: before that, another
    // boot may still be moving a site's own role off the slug.
    publicRoleId: async () =>
      (await publicRoleMade(meta))
        ? ((
            await new RoleQueryService(adapter, logger).findRoleIdBySlug(
              PUBLIC_ROLE_SLUG
            )
          )?.id ?? null)
        : null,
    targets: async () => {
      const { collections, singles } = await deps.entities();
      // Each slug once, as a request finds it: the target the rules are
      // registered under, kind and rules together. Boot keeps one slug to
      // one kind, so this is the entity itself.
      const bySlug = new Map<string, AccessTarget>();
      for (const target of [
        ...collections
          .filter(
            ({ slug }) =>
              !(SYSTEM_RESOURCES as readonly string[]).includes(slug)
          )
          .map(({ slug }) => ({ kind: "collection" as const, slug })),
        ...singles.map(({ slug }) => ({ kind: "single" as const, slug })),
      ]) {
        if (bySlug.has(target.slug)) continue;
        bySlug.set(target.slug, deps.registeredTarget(target.slug) ?? target);
      }
      return [...bySlug.values()];
    },
    permissionIds: () =>
      permissionIdsBySlug(new PermissionService(adapter, logger)),
    publicHolds: async roleId =>
      new Set(
        (await grants.listRolePermissions(roleId)).map(({ action, resource }) =>
          permissionSlug(action, resource)
        )
      ),
    declared: () => collectPublicGrants(deps.config.plugins ?? []),
    addOnce: (roleId, wanted, pick) =>
      grants.addRolePermissionsOnce(roleId, wanted, pick),
    withdraw: (roleId, unwanted, pick) =>
      grants.withdrawRolePermissions(roleId, unwanted, pick),
    meta,
    logger,
  };
}

/**
 * Seeds again at `at`, once: where another boot held the claim to make the
 * Public role, that boot may have stopped, and its claim lapses then. Not
 * holding the process open for it, and replacing any retry already waiting.
 * Only against the services it was scheduled under: after they are shut
 * down, or replaced by another registration, there is nothing of this boot's
 * left to seed.
 */
function retrySeedingAt(at: number): void {
  clearTimeout(globalForSeeding.__nextly_publicRoleRetry);
  const adapter = getService("adapter");
  const timer = setTimeout(
    () => {
      globalForSeeding.__nextly_publicRoleRetry = undefined;
      if (stillRegistered(adapter)) void seedPermissionsAndRolePresets();
    },
    Math.max(0, at - Date.now())
  );
  timer.unref?.();
  globalForSeeding.__nextly_publicRoleRetry = timer;
}

/** Whether `adapter` is still the registered services' adapter. */
function stillRegistered(adapter: unknown): boolean {
  try {
    return getService("adapter") === adapter;
  } catch {
    // No services registered.
    return false;
  }
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
