/**
 * What `nextly migrate` hands `migrateCore` besides the files: the first run's
 * record, the orphan marks an applied migration sets, and the refusal of a
 * translations column that cannot hold a newly translated field. Built in one
 * place for the command and for the migrations at start, which are the same
 * step run by a production start, so the two write the same bookkeeping.
 *
 * @module domains/schema/migrate/deploy-step-deps
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { MigrateCoreDeps } from "../../../cli/commands/migrate";
import type { CommandContext } from "../../../cli/program";
import type { SupportedDialect } from "../../../cli/utils/adapter";
import { withCommandServicesLent } from "../../../cli/utils/lend-command-services";
import type { DeclaredNames } from "../../../cli/utils/migration-discovery";
import { PermissionSeedService } from "../../auth/services/permission-seed-service";
import type { localizableConfigEntities } from "../../i18n/runtime/localizable-config-entities";
import type { RecordedEntities } from "../../i18n/migration/recorded-before";

import { pluginsRecordedNotInstalled } from "./command-access";
import { configurationRegistryRows } from "./first-run";
import {
  keepingUnrecordedPlugins,
  leavingPluginsNotInstalled,
  type MigrationOrphanScope,
} from "./permission-orphans";

/** The configuration the step runs for, as each of the three reads it. */
type DeployStepConfig = Parameters<typeof configurationRegistryRows>[0] &
  Parameters<typeof keepingUnrecordedPlugins>[1] &
  Parameters<typeof localizableConfigEntities>[0];

/** What the step runs against. */
export interface DeployStepRun {
  adapter: DrizzleAdapter;
  db: unknown;
  dialect: SupportedDialect;
  /** The app's migrations folder. */
  migrationsDir: string;
  logger: CommandContext["logger"];
  /** What the declared schema names, as the run judges old Builder files. */
  declared?: DeclaredNames;
  config: DeployStepConfig;
  /** Every entity as the registry recorded it before the run's first file. */
  recordedBefore: RecordedEntities | undefined;
}

/**
 * What an applied migration orphans (`MigrateCoreDeps.markOrphanedPermissions`), on the run's
 * own connection, lent to the services a permission write retires the cached answers through
 * (`withCommandServicesLent`), as Phase 4 writes. Each mark set or cleared is logged with the
 * grants the permission keeps (`logOrphanMarkChange`), at the operator's level, since a permission
 * leaving the role editor is what the operator needs to hear of. A mark that could not be written
 * is warned of by the service and named here with its migration.
 */
async function markOrphansOnRunConnection(
  adapter: DrizzleAdapter,
  scope: MigrationOrphanScope,
  migration: string,
  logger: CommandContext["logger"]
): Promise<void> {
  const serviceLogger = {
    debug: (message: string) => logger.debug(message),
    info: (message: string) => logger.info(message),
    warn: (message: string) => logger.warn(message),
    error: (message: string) => logger.error(message),
  };
  const result = await withCommandServicesLent(adapter, serviceLogger, () =>
    new PermissionSeedService(adapter, serviceLogger).markOrphanedPermissions(
      scope.declared,
      scope
    )
  );
  if (result.errors > 0) {
    logger.warn(
      `The orphan marks of the permissions ${migration}.sql no longer declares were not all written; those not written stay as they were.`
    );
  }
}

/** The three for `run`; see the module comment. */
export function deployStepDeps(
  run: DeployStepRun
): Required<
  Pick<MigrateCoreDeps, "firstRun" | "markOrphanedPermissions" | "beforeMetadata">
> {
  const { adapter, config, logger } = run;
  return {
    // A database with no registry record has its first run on this release: the record is
    // written once, and where no migration carries the registry, the rows come from this
    // configuration, as the starts before this release wrote them.
    firstRun: {
      configurationRows: () => configurationRegistryRows(config),
    },
    // A permission leaves when the recorded migration whose snapshot drops it applies, on
    // this run's connection, keeping its grants.
    markOrphanedPermissions: async (scope, migration) => {
      await markOrphansOnRunConnection(
        adapter,
        // A configured plugin the migration does not record keeps its permissions, even one
        // stored under the app's own owner key; one recorded uninstalled is not declared by
        // it, so the marks its uninstall wrote stay.
        leavingPluginsNotInstalled(
          keepingUnrecordedPlugins(scope, config),
          await pluginsRecordedNotInstalled(adapter)
        ),
        migration,
        logger
      );
    },
    // A translations column already in place that cannot hold a field the config newly
    // translates, judged as the files left it and before the registry records them: refused
    // here, the registry keeps its definitions and the next run is refused the same way.
    // Judged only once no file is pending, since a later one may still change the column.
    beforeMetadata: async () => {
      const [{ findPendingFiles }, { refuseCompanionColumnsThatCannotHold }] =
        await Promise.all([
          import("../../../cli/commands/migrate"),
          import("../../i18n/runtime/companion-io"),
        ]);
      const pending = await findPendingFiles(
        adapter as never,
        run.db,
        run.dialect,
        run.migrationsDir,
        logger,
        run.declared
      );
      console.log(`DEBUG1492 pending=${pending.length} recordedBefore=${run.recordedBefore === undefined ? "undef" : run.recordedBefore.size}`);
      if (pending.length > 0) return;
      await refuseCompanionColumnsThatCannotHold(
        adapter,
        config,
        run.recordedBefore
      );
    },
  };
}
