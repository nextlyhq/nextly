/**
 * `nextly upgrade`: what is left of the command that brought an existing
 * database up to date.
 *
 * Its steps over stored data are run by `nextly migrate` once its migrations
 * have applied, and the conversion of translated date columns kept with a
 * time zone by `nextly i18n:convert-zoned-dates`. Run for that work, the
 * command changes nothing, names both, and ends as a failure, so a pipeline
 * still calling it learns where the work went. `--reconcile-core` is still
 * here: the core reconcile alone, as `runReconcileCore` makes it.
 *
 * @module cli/commands/upgrade
 * @since v0.0.3-alpha (Plan B)
 */

import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { resolveRegistryNameFromCatalog } from "../../domains/field-groups/storage/resolve-storage-names";
import { assertNoLegacyBookkeeping } from "../../domains/schema/events/legacy-detection";
import type { EntityContributionSource } from "../../domains/schema/extension/entity-contributions";
import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import {
  planCoreDeletions,
  planCoreReconcile,
  reconcileCore,
} from "../../domains/schema/migrate/core-reconcile";
import {
  consentCovers,
  consentToCover,
  type DataLossConsent,
  type Deletion,
} from "../../domains/schema/migrate/data-loss-consent";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { reportDryRun, type DryRunChange, type DryRunPlan } from "../dry-run";
import { CliError, exitWithError, failWithError } from "../errors";
import { createContext } from "../program";
import {
  createCliAdapter,
  openCommandAdapter,
  type CLIDatabaseAdapter,
} from "../utils/adapter";
import { requireDatabaseEnv } from "../utils/command-prerequisites";
import { loadConfig } from "../utils/config-loader";
import {
  askToDeleteInTerminal,
  deletionChanges,
  readDataLossConsent,
  type AcceptDataLossOption,
} from "../utils/data-loss-consent";

import {
  assertAppHistoryHolds,
  historyRefusalIn,
  maybeForceUnlock,
  migrateExitCode,
} from "./migrate";
import { dryRunRefusalOf } from "./migrate-create";
import type { UpgradeAdapter } from "./upgrade-step";
import { judgeCoreDeletions } from "./upgrade-steps/core-upgrade-consent";

export type { UpgradeAdapter } from "./upgrade-step";

interface UpgradeLogger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
}

/**
 * How `nextly upgrade` ends, having changed nothing, when it is run for the
 * database work it used to do: each part of that work, and the command that
 * does it now.
 */
export function upgradeWorkMoved(): CliError {
  return new CliError("UPGRADE_WORK_MOVED", {
    what: "`nextly upgrade` no longer changes the database, and changed nothing.",
    why: "`nextly migrate` now hashes passwords stored before this release, removes passwords kept in version history and converts roles holding a retired manage permission, once its migrations have applied. `nextly i18n:convert-zoned-dates` converts translated date columns kept with a time zone.",
    next: "Run `nextly migrate` (`nextly migrate --backup-confirmed` where no terminal is attached). Once the release serves every instance, run `nextly i18n:convert-zoned-dates` if a start or `nextly migrate` named such a column.",
  });
}

export interface RunReconcileCoreDeps {
  adapter: UpgradeAdapter;
  logger?: UpgradeLogger;
  /**
   * The run's data-loss consent (`--accept-data-loss` or
   * `NEXTLY_ACCEPT_DATA_LOSS`; `NEXTLY_ALLOW_CORE_DESTRUCTIVE` honoured, as
   * deprecated, for Nextly's own tables).
   */
  consent: DataLossConsent;
  /** Whether a person is at a terminal to be asked. */
  interactive: boolean;
  /** Asks that person a yes-or-no question; only called when `interactive`. */
  askToDelete?: (question: string) => Promise<boolean>;
  /** What plugins and hooks contributed to the core tables (the compiled extension schema). */
  contributions?: EntityContributionSource | undefined;
  /**
   * The app history checks every command that changes core tables makes
   * before its first write (`assertAppHistoryHolds`), asked under the lock
   * before the reconcile. Required, so no caller reconciles past a history
   * this build cannot account for.
   */
  checkAppHistory: () => Promise<void>;
}

/** Injected for tests; defaults to the real reconcileCore and its plan. */
interface ReconcileCoreInjection {
  reconcileCore?: typeof reconcileCore;
  planCoreDeletions?: typeof planCoreDeletions;
}

/**
 * `nextly upgrade --reconcile-core` (spec §4.10.3): the core reconcile alone,
 * gated by the legacy bookkeeping check and the shared migrate lock. Use only
 * when `nextly migrate` reports core schema drift after upgrading.
 *
 * What it deletes (a retired column, a type change, a column made required)
 * is judged by the one data-loss consent, as `nextly migrate` judges it:
 * listed and asked about at a terminal before the lock, refused without a
 * terminal unless the consent covers it, and accepted under the lock only as
 * agreed. A retired column agreed to is dropped once the push has succeeded.
 */
export async function runReconcileCore(
  deps: RunReconcileCoreDeps,
  injection: ReconcileCoreInjection = {}
): Promise<void> {
  const reconcile = injection.reconcileCore ?? reconcileCore;
  const planDeletions = injection.planCoreDeletions ?? planCoreDeletions;
  const { adapter } = deps;
  const dialect = adapter.getCapabilities().dialect;
  const warn = (line: string) => deps.logger?.warn?.(line);

  await assertNoLegacyBookkeeping(adapter);

  const target = await reconcileTarget(adapter, deps.contributions);
  // Before the lock, so a person is asked without other runs waiting on them.
  const agreed = await judgeCoreDeletions({
    deletions: await planDeletions(target),
    consent: deps.consent,
    interactive: deps.interactive,
    askToDelete: deps.askToDelete,
    warn,
  });

  await withMigrateLock(
    adapter as unknown as DrizzleAdapter,
    dialect,
    async () => {
      // Before the reconcile changes core tables, under the lock no other run
      // changes the ledger past: an older build stops with exit 3, an edited
      // applied file with exit 2, an unresolved attempt as it says.
      await deps.checkAppHistory();
      // Read again under the lock: a field-group storage migration this run
      // waited behind may have renamed the registry, and reconciling against
      // the name read before would create the old one empty beside it.
      await reconcile({
        ...(await reconcileTarget(adapter, deps.contributions)),
        // The core tables as they stand under the lock, accepted only as
        // agreed before it, or as the consent covers them.
        judgeDeletions: async deletions => {
          await judgeCoreDeletions({
            deletions,
            consent: deps.consent,
            agreed,
            warn,
          });
        },
        logger: deps.logger,
      });
    },
    { command: "nextly upgrade --reconcile-core", mode: "wait" }
  );
  deps.logger?.info?.("Core schema reconciliation complete.");
}

// ---------------------------------------------------------------------------
// CLI command registration
// ---------------------------------------------------------------------------

/**
 * What `--reconcile-core` reconciles, for the real run and its dry run alike:
 * the database, and what plugins and hooks contributed to its core tables. Same reason as
 * `nextly migrate`: the desired core shape must name the field-group registry
 * this database actually holds, or the reconcile creates the other one empty.
 */
async function reconcileTarget(
  adapter: UpgradeAdapter,
  contributions: EntityContributionSource | undefined
) {
  const dialect = adapter.getCapabilities().dialect;
  const db = adapter.getDrizzle();
  return {
    db,
    dialect,
    fieldGroupRegistryTable: await resolveRegistryNameFromCatalog({
      dialect,
      getDrizzle: <T>() => db as T,
    }),
    // What plugins and hooks contributed to the core tables, as `nextly
    // migrate` passes it: set aside rather than read as retired, so a
    // plugin's column on `users` is never listed, nor dropped, as one this
    // version no longer declares.
    ...(contributions !== undefined ? { contributions } : {}),
  };
}

/**
 * `nextly upgrade --reconcile-core --dry-run`: the reconcile's own plan
 * (`planCoreReconcile`), read-only, with no lock: each statement its push
 * would run, each thing it would delete, and each retired auth table it would
 * drop. What it deletes needs the consent: where nobody can be asked and the
 * consent does not cover it, the real run refuses, and the dry run says so
 * with the consent that would cover it. A second push pass, and the core rows
 * a reconcile fills in, are described, not counted. A database still keeping
 * its migration records the earlier way is refused, as the real run refuses it.
 */
export async function previewReconcileCore(deps: {
  adapter: UpgradeAdapter;
  /** Whether a real run could ask at a terminal. */
  interactive: boolean;
  /** The run's consent, as the real run would read it. */
  consent: DataLossConsent;
  /** As `RunReconcileCoreDeps.contributions`. */
  contributions?: EntityContributionSource | undefined;
  /** As `RunReconcileCoreDeps.checkAppHistory`, read-only: recording no checksum. */
  checkAppHistory: () => Promise<void>;
}): Promise<DryRunPlan> {
  const { adapter } = deps;
  try {
    await assertNoLegacyBookkeeping(adapter);
  } catch (error) {
    const refusal = dryRunRefusalOf(error);
    if (refusal === undefined) throw error;
    return { changes: [], refusals: [refusal] };
  }
  // The real run stops on the app's history before its reconcile, so a dry
  // run reports that refusal and plans nothing past it.
  const history = await historyRefusalIn(deps.checkAppHistory);
  if (history !== undefined) return { changes: [], refusals: [history] };
  const plan = await planCoreReconcile(
    await reconcileTarget(adapter, deps.contributions)
  );
  // A push drizzle-kit cannot plan is refused before anything else, so the
  // dry run plans nothing past it, as the real run does nothing past it.
  if (plan.unsupported !== undefined) {
    return { changes: [], refusals: [plan.unsupported] };
  }
  const changes: DryRunChange[] = [
    ...plan.statements.map(statement => ({ action: "run", target: statement })),
    ...deletionChanges(plan.deletions),
    ...plan.retiredDrops.map(table => ({
      action: "remove",
      target: `retired auth table ${table}`,
    })),
  ];
  const notes = [
    ...(plan.degraded
      ? [
          "The push then takes a second pass over what the first created; its statements are not counted.",
        ]
      : []),
    "A real run also fills in core rows a new column leaves without a value (how an address was verified, the account a reset or verification link belongs to); those are not counted.",
  ];
  const uncovered = plan.deletions.filter(
    deletion => !consentCovers(deps.consent, deletion)
  );
  // As the real run judges it (`judgeDataLoss`): a consent naming targets
  // that leaves one out is refused even at a terminal; with no consent, a
  // terminal is asked and no terminal is refused.
  const asks = deps.interactive && deps.consent.given === null;
  if (uncovered.length > 0 && asks) {
    notes.push(
      `A real run lists what it deletes and asks; to agree without being asked, pass ${consentToCover(uncovered)}.`
    );
  }
  return {
    changes,
    ...(uncovered.length > 0 && !asks
      ? { refusals: [coreDeletionsNeedConsent(uncovered)] }
      : {}),
    notes,
  };
}

/** Why a real run with nobody to ask would refuse `uncovered`. */
function coreDeletionsNeedConsent(uncovered: readonly Deletion[]): string {
  return `Bringing Nextly's own tables up to date deletes data that the consent given does not cover, and no one would be asked. Pass ${consentToCover(uncovered)}.`;
}

export interface UpgradeCommandOptions {
  /** No longer read: they confirmed the backup for the work `nextly migrate` now does. */
  confirmBackedUp?: boolean;
  force?: boolean;
  /**
   * No longer read: it named another table for the migration records, which
   * `nextly migrate` now moves. Given, it is answered with a notice.
   */
  targetTableName?: string;
  reconcileCore?: boolean;
  /** Clear a stale migrate lock before taking it (operator escape hatch). */
  forceUnlock?: boolean;
  /** Show what the upgrade would change, and change nothing. */
  dryRun?: boolean;
  /** The data-loss consent for what `--reconcile-core` deletes. */
  acceptDataLoss?: AcceptDataLossOption;
}

/** Where the config is read from: the command's global options. */
interface ConfigOptions {
  config?: string;
  cwd?: string;
  verbose?: boolean;
}

/**
 * What `upgrade --reconcile-core` reads from the config, loaded as `nextly
 * migrate` loads it (a config that cannot load refuses here, before the lock):
 * the app history checks it makes before its reconcile (`assertAppHistoryHolds`,
 * over the migrations folder the config names; `recordChecksums` false for a
 * dry run), and what plugins and hooks contributed to the core tables.
 */
async function reconcileSetup(
  globalOpts: ConfigOptions,
  configResult: Awaited<ReturnType<typeof loadConfig>>,
  adapter: UpgradeAdapter,
  logger: ReturnType<typeof createContext>["logger"],
  recordChecksums: boolean
): Promise<{
  checkAppHistory: () => Promise<void>;
  /** None where the configuration compiles to no extension schema. */
  contributions: EntityContributionSource | undefined;
}> {
  const migrationsDir = resolve(
    globalOpts.cwd ?? process.cwd(),
    configResult.config.db.migrationsDir
  );
  const dialect = adapter.getCapabilities().dialect;
  const { compileExtensionSchema } = await import(
    "../../domains/schema/extension/publish"
  );
  const contributions = await compileExtensionSchema({
    dialect,
    plugins: configResult.config.plugins ?? [],
    config: configResult.config,
    logger: { warn: m => logger.warn(m) },
  });
  return {
    contributions,
    checkAppHistory: () =>
      assertAppHistoryHolds({
        adapter: adapter as unknown as CLIDatabaseAdapter,
        db: adapter.getDrizzle(),
        dialect,
        migrationsDir,
        logger,
        command: "nextly upgrade --reconcile-core",
        recordChecksums,
      }),
  };
}

/**
 * `--reconcile-core`'s consent: `--accept-data-loss` or
 * `NEXTLY_ACCEPT_DATA_LOSS`, with `NEXTLY_ALLOW_CORE_DESTRUCTIVE` honoured, as
 * deprecated, for what it always covered: Nextly's own tables.
 */
function reconcileConsent(
  cmdOptions: UpgradeCommandOptions,
  logger: ReturnType<typeof createContext>["logger"]
): DataLossConsent {
  return readDataLossConsent({
    flag: cmdOptions.acceptDataLoss,
    honours: ["NEXTLY_ALLOW_CORE_DESTRUCTIVE"],
    warn: line => logger.warn(line),
  });
}

/** The action of `nextly upgrade`, loaded when it runs. */
export async function upgradeAction(
  cmdOptions: UpgradeCommandOptions,
  cmd: Command
) {
  const globalOpts = cmd.optsWithGlobals();
  const context = createContext(globalOpts);

  // Run for the database work it used to do, a dry run of it included, the
  // command opens no database and changes nothing: it names the commands
  // that do that work now, and ends as a failure.
  if (cmdOptions.reconcileCore !== true) {
    exitWithError(context.logger, upgradeWorkMoved());
  }

  const dbValidation = requireDatabaseEnv(context.logger);

  // The configuration is loaded, and judged, before the database is opened: a refused one leaves
  // the database untouched, no lock cleared or taken. It reads the app's entities, so a project
  // with no configuration file is refused rather than reconciled as if it declared none.
  let configResult: Awaited<ReturnType<typeof loadConfig>>;
  try {
    configResult = await loadConfig({
      missing: "refuse",
      configPath: globalOpts.config,
      cwd: globalOpts.cwd,
      debug: globalOpts.verbose,
    });
  } catch (error) {
    exitWithError(context.logger, error);
  }

  if (cmdOptions.targetTableName !== undefined) {
    context.logger.warn(
      "upgrade's --target-table-name no longer does anything: the migration records of an earlier release are moved by `nextly migrate`, into nextly_schema_events."
    );
  }

  if (cmdOptions.dryRun === true) {
    await reportUpgradeDryRun(
      cmdOptions,
      dbValidation,
      context,
      globalOpts,
      configResult
    );
    return;
  }

  let adapter: { disconnect?: () => Promise<void> } & UpgradeAdapter;
  try {
    adapter = (await createCliAdapter({
      dialect: dbValidation.dialect,
      databaseUrl: dbValidation.databaseUrl,
      logger: globalOpts.verbose ? context.logger : undefined,
    })) as unknown as { disconnect?: () => Promise<void> } & UpgradeAdapter;
  } catch (error) {
    exitWithError(context.logger, error);
  }

  try {
    // Clear a stale lock first when --force-unlock is passed (e.g. left
    // by a crashed prior run): the lock-busy error tells operators to
    // re-run with this flag, and the reconcile takes the migrate lock.
    await maybeForceUnlock(
      cmdOptions,
      adapter.getDrizzle(),
      adapter.getCapabilities().dialect
    );

    await runReconcileCore({
      adapter,
      ...(await reconcileSetup(
        globalOpts,
        configResult,
        adapter,
        context.logger,
        true
      )),
      logger: {
        info: msg => context.logger.info(msg),
        warn: msg => context.logger.warn(msg),
      },
      consent: reconcileConsent(cmdOptions, context.logger),
      // Asked only where someone can answer. Otherwise a deletion the
      // consent does not cover is refused before anything changes, with
      // the consent that would cover it.
      interactive: canPrompt(),
      askToDelete: askToDeleteInTerminal,
    });
  } catch (error) {
    // Set rather than exited, so the disconnect below still runs: 2 for an
    // edited applied file, 3 for one the folder lacks.
    failWithError(context.logger, error, migrateExitCode(error));
  } finally {
    await adapter.disconnect?.();
  }
}

/**
 * `nextly upgrade --reconcile-core --dry-run`: the database opened
 * read-only, the reconcile's plan (`previewReconcileCore`) reported, and
 * nothing changed: no lock taken, and under `--force-unlock`
 * none cleared, only named. Whether a real run could ask at a terminal is
 * the CLI's one answer to it (`canPrompt`).
 */
async function reportUpgradeDryRun(
  cmdOptions: UpgradeCommandOptions,
  dbValidation: ReturnType<typeof requireDatabaseEnv>,
  context: ReturnType<typeof createContext>,
  globalOpts: ConfigOptions,
  configResult: Awaited<ReturnType<typeof loadConfig>>
): Promise<void> {
  let adapter:
    | ({ disconnect?: () => Promise<void> } & UpgradeAdapter)
    | undefined;
  try {
    // A dry run whose database is not there has said so, and ends here.
    const opened = await openCommandAdapter(
      {
        dialect: dbValidation.dialect,
        databaseUrl: dbValidation.databaseUrl,
        logger: context.options.verbose ? context.logger : undefined,
        dryRun: true,
      },
      context.logger
    );
    if (opened === undefined) return;
    adapter = opened as unknown as typeof adapter & UpgradeAdapter;
    const interactive = canPrompt();
    const plan = await previewReconcileCore({
      adapter,
      interactive,
      consent: reconcileConsent(cmdOptions, context.logger),
      ...(await reconcileSetup(
        globalOpts,
        configResult,
        adapter,
        context.logger,
        false
      )),
    });
    reportDryRun(
      context.logger,
      cmdOptions.forceUnlock
        ? {
            ...plan,
            changes: [
              { action: "remove", target: "any migrate lock held" },
              ...plan.changes,
            ],
          }
        : plan
    );
  } catch (error) {
    // Set rather than exited, so the disconnect below still runs.
    failWithError(context.logger, error);
  } finally {
    await adapter?.disconnect?.();
  }
}

export { registerUpgradeCommand } from "./upgrade.command";
