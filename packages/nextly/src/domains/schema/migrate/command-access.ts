/**
 * The permission, role and grant writes a command makes on its own
 * connection: `nextly migrate`'s Phase 4, and the access a plugin's install
 * adds and its uninstall orphans.
 *
 * One implementation for both commands, so a plugin's install sets the
 * permissions, the declared roles and every preset role's grants, with the
 * release record, exactly as `nextly migrate` from the same release would,
 * and a plugin's uninstall orphans through the same service an applied
 * migration does.
 *
 * Each write runs on the command's connection, lent to the services a grants
 * change goes through (`withCommandServicesLent`), so the cached permission
 * answers and content reads of every running instance are retired when it
 * changes a grant. Called inside a registry write's transaction
 * (`writeRegistryRows`: a first `nextly migrate` run's one commit, or the
 * transaction a plugin's install or uninstall records its state in), it
 * writes on that transaction, so it commits or rolls back with the rest.
 *
 * @module domains/schema/migrate/command-access
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { withCommandServicesLent } from "../../../cli/utils/lend-command-services";
import type { Logger } from "../../../cli/utils/logger";
import type { SanitizedNextlyConfig } from "../../../collections/config/define-config";
import { describeError } from "../../../errors/describe-error";
import { NextlyError } from "../../../errors/nextly-error";
import { seedPermissionsRolesAndPresets } from "../../../init/seed-permissions";
import { getCoreVersion } from "../../../plugins/core-version";
import {
  collectCustomPermissions,
  type PermissionConfigSource,
} from "../../../plugins/permissions/collect-permissions";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import { SCHEMA_OWNERS_TABLE } from "../../../schemas/schema-owners";
import { adapterForReads } from "../../../shared/lib/read-transaction-scope";
import { PermissionSeedService } from "../../auth/services/permission-seed-service";
import { withPresetGrantsRecorded } from "../../meta/preset-grants-release";
import {
  buildWorkflowRegistry,
  publishWorkflows,
} from "../../workflows/registry";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import { readPluginLifecycle } from "../ownership/plugin-lifecycle-state";
import { SchemaOwnersRepository } from "../ownership/schema-owners-repository";

/** The logger the services a write goes through are handed. */
interface ServiceLogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/**
 * Runs `write` with the adapter it writes through: inside a registry write's
 * transaction, the view that reads and writes on it (`adapterForReads`), so
 * everything written, the grants' cache retirement and the content expiry they
 * owe included, commits or rolls back with the transaction, and nothing waits
 * on a second connection behind its locks. Anywhere else, the adapter itself,
 * and each write commits as it always has.
 *
 * Inside a transaction no job is queued ahead of a grants change, since its
 * content expiry is recorded on the transaction: an expiry that cannot be
 * recorded there fails the write (`withGrantsExpiryRequired`), so the grants
 * never commit without it.
 */
async function onCommandConnection<T>(
  pooled: DrizzleAdapter,
  logger: ServiceLogger,
  write: (adapter: DrizzleAdapter) => Promise<T>
): Promise<T> {
  const adapter = adapterForReads(pooled);
  const inCommit = adapter !== pooled;
  const { withGrantsExpiryRequired } = await import(
    "../../flush-content-change"
  );
  const writing = inCommit
    ? withGrantsExpiryRequired
    : <R>(run: () => Promise<R>): Promise<R> => run();
  return withCommandServicesLent(
    adapter,
    logger,
    () => writing(() => write(adapter)),
    { queue: !inCommit }
  );
}

/** The ledger table the plugins' lifecycle records are kept in. */
const LIFECYCLE_RECORDS_TABLE = "nextly_schema_events";

/**
 * The plugins recorded as anything but installed: uninstalled, kept data or
 * not, or with an uninstall begun. Read by the reader a production start
 * judges the plugins with (`readPluginLifecycle`). Their uninstall marked
 * their permissions orphaned, and only their install declares them again, so
 * neither `nextly migrate`'s seeding (`pluginsDeclared`) nor an applied
 * migration's orphan pass (`leavingPluginsNotInstalled`) takes them for
 * declared. A plugin with no record is not among them. A database without the
 * ledger or the owner registry holds no record.
 */
export async function pluginsRecordedNotInstalled(
  adapter: DrizzleAdapter
): Promise<ReadonlySet<string>> {
  const [ledger, owners] = await Promise.all([
    adapter.tableExists(LIFECYCLE_RECORDS_TABLE),
    adapter.tableExists(SCHEMA_OWNERS_TABLE),
  ]);
  if (!ledger || !owners) return new Set();
  const db = adapter.getDrizzle();
  const dialect = adapter.getCapabilities().dialect;
  const states = await readPluginLifecycle(
    new SchemaEventsRepository(db, dialect),
    await new SchemaOwnersRepository(db, dialect).read()
  );
  return new Set(
    [...states]
      .filter(([, record]) => record.state !== "installed")
      .map(([name]) => name)
  );
}

/**
 * The configured plugins whose permissions and roles a run declares: each one
 * recorded installed, and each with no lifecycle record. One recorded as
 * anything else (`pluginsRecordedNotInstalled`) is left out, so a run with it
 * still listed leaves its marks and grants as its uninstall left them.
 *
 * A plugin with no record is declared as before: a site set up before the
 * records were written, or one whose plugin is configured and not installed
 * yet, as on a new site, whose first `nextly migrate` comes before any install
 * can. Declaring only adds, and its permissions have no mark to clear.
 */
async function pluginsDeclared(
  adapter: DrizzleAdapter,
  plugins: readonly PluginDefinition[]
): Promise<PluginDefinition[]> {
  if (plugins.length === 0) return [];
  const notInstalled = await pluginsRecordedNotInstalled(adapter);
  return plugins.filter(plugin => !notInstalled.has(plugin.name));
}

/**
 * Phase 4 of `nextly migrate`, and the access a plugin's install writes: the
 * permissions, declared roles and preset grants
 * (`seedPermissionsRolesAndPresets`) for `configResult.config`, on the
 * command's own connection (`onCommandConnection`).
 *
 * The configuration's attached workflows are judged and published first, as a
 * start publishes them before it seeds: the permissions a workflow's steps add
 * are seeded with their collection's, and the presets leave them out, so a
 * declared role bundling one is made with it. A configuration whose workflows
 * cannot attach is refused by every start; here it is said, its workflows'
 * permissions are left to a later run, and a role bundling one is not made yet.
 * The workflows published before are put back after.
 *
 * The preset grants are set with a record of this Nextly release, in one
 * transaction, and a release older than the one recorded leaves them as they
 * are and says so (`withPresetGrantsRecorded`); the rest of the phase runs
 * either way.
 *
 * The configured plugins declared are those `pluginsDeclared` names, so a
 * plugin recorded uninstalled keeps its marks. A plugin's install passes
 * `pluginsAsGiven`: it declares the plugin it is installing, whose record it
 * writes in the same transaction, and a reinstall is what clears the marks.
 */
export async function seedAccessOnCommandConnection(
  pooled: DrizzleAdapter,
  configResult: { config: SanitizedNextlyConfig; configPath?: string | null },
  logger: Logger,
  options: { pluginsAsGiven?: boolean } = {}
): Promise<void> {
  // Each seeder's progress is detail here; its warnings and errors are the operator's.
  const seedLogger: ServiceLogger = {
    debug: message => logger.debug(message),
    info: message => logger.debug(message),
    warn: message => logger.warn(message),
    error: message => logger.error(message),
  };
  const { config } = configResult;
  await onCommandConnection(pooled, seedLogger, async adapter => {
    let previous: ReturnType<typeof publishWorkflows> | undefined;
    try {
      // Judged as a configuration reload judges them: the configuration's own
      // components as written, any other from the registry Phase 3 just wrote.
      previous = publishWorkflows(
        await buildWorkflowRegistry(config, configResult.configPath ?? null, {
          components: config.fieldGroups ?? [],
        })
      );
    } catch (error) {
      logger.warn(
        `The configuration's workflows could not be attached, so their permissions were not added: ${describeError(error)}`
      );
    }
    try {
      // The preset grants are set with the record of this release, in one
      // transaction, and left as they are where a newer release set them.
      // Inside a registry write's transaction that transaction joins it, as a
      // savepoint on its connection (the adapter's `transaction()` joins the
      // one the flow is in), and the grants it changes are announced on it
      // too, so they, the release record and the announcements commit with
      // the registry write or not at all.
      const release = getCoreVersion();
      const declaring =
        options.pluginsAsGiven === true
          ? config
          : {
              ...config,
              plugins: await pluginsDeclared(adapter, config.plugins ?? []),
            };
      const { leftTo } = await withPresetGrantsRecorded(release, () =>
        seedPermissionsRolesAndPresets({
          adapter,
          config: declaring,
          logger: seedLogger,
        })
      );
      if (leftTo !== undefined) {
        logger.info(
          `The preset roles' grants were set by Nextly ${leftTo}, newer than this release (${release}), so they were left as they were. Run \`nextly migrate\` from ${leftTo} or newer to set them again.`
        );
      }
    } finally {
      if (previous !== undefined) publishWorkflows(previous);
    }
  });
}

/**
 * Marks orphaned every live permission `owner` owns, on the command's own
 * connection (`onCommandConnection`): what a plugin's uninstall does in the
 * transaction that records it uninstalled. Through the service an applied
 * migration orphans with (`PermissionSeedService.markOrphanedPermissions`),
 * declaring nothing and speaking for `owner` alone, so every grant is kept
 * and each mark set is logged with the grants the permission keeps
 * (`logOrphanMarkChange`), at the operator's level, since a permission
 * leaving the role editor is what the operator needs to hear of.
 *
 * Rows a permission of `config`'s other owners names are left as they are
 * (`OrphanMarkScope.kept`): the app's own permissions are stored under the
 * owner key `app`, and a plugin may be named `app` too, so the key alone would
 * take the app's permissions for the plugin's. Who declares what is read from
 * the configuration's one collection of declarations
 * (`collectCustomPermissions`), which keeps the app's apart by their source.
 *
 * Throws when a mark could not be written, so the state is not recorded with
 * the owner's permissions still live: the transaction rolls back, and the
 * command run again writes both.
 */
export async function orphanOwnedPermissionsOnCommandConnection(
  pooled: DrizzleAdapter,
  owner: string,
  config: PermissionConfigSource & { plugins?: PluginDefinition[] },
  logger: Logger
): Promise<void> {
  const kept = collectCustomPermissions(config, config.plugins ?? []).filter(
    p => !(p.source === "plugin" && p.owner === owner)
  );
  // The command's own logger, each level as it is: a mark set is the operator's to hear.
  const serviceLogger: ServiceLogger = logger;
  const result = await onCommandConnection(pooled, serviceLogger, adapter =>
    new PermissionSeedService(adapter, serviceLogger).markOrphanedPermissions(
      [],
      { owners: new Set([owner]), kept }
    )
  );
  if (result.errors > 0) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage: `The permissions of ${owner} could not all be marked orphaned, so nothing was recorded. Run the command again once the cause is fixed.`,
      logMessage: `${result.errors} orphan mark(s) of ${owner}'s permissions could not be written`,
      logContext: { reason: "owned-permissions-not-orphaned", owner },
    });
  }
}
