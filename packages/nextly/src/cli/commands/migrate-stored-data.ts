/**
 * `nextly migrate`'s part in bringing data an earlier release stored up to
 * date: the steps of `MIGRATE_DATA_STEPS`, run once the migrations have
 * applied (`runDataSteps`), and the run's one backup question.
 *
 * One value per run (`migrateStoredData`) holds what the run has learned: a
 * yes at the backup question, which holds for the rest of the run so nobody
 * is asked twice; whether the steps were taken; and the backup refusal they
 * ended with where the work could only be seen after the migrations applied.
 *
 * @module cli/commands/migrate-stored-data
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { countPasswordsStoredAsGiven } from "../../domains/field-groups/stored-plain-passwords";
import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import { describeError, type NextlyError } from "../../errors";
import type { DryRunPlan } from "../dry-run";
import { askYesInTerminal } from "../utils/prompt-cancelled";
import { installRegistryResolver } from "../utils/registry-resolver";

import {
  confirmDataStepsBackup,
  firstDataStepWithWork,
  isDataStepsBackupRefusal,
  previewDataSteps,
  runDataSteps,
  type DataStepsDeps,
} from "./data-steps";
import type { UpgradeSite } from "./upgrade-step";
import { MIGRATE_DATA_STEPS } from "./upgrade-steps";
import {
  storedPasswordsNotice,
  storedPasswordsOn,
  storedPasswordTotal,
} from "./upgrade-steps/stored-passwords";

/** The lines of the command a run reports through. */
interface StoredDataLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  newline: () => void;
}

/** What `nextly migrate` does with the data an earlier release stored, over one run. */
export interface MigrateStoredData {
  /** The run's one backup question; a yes holds for the rest of the run. */
  askBackedUp: () => Promise<boolean>;
  /** `--dry-run`: lists each step with work, read-only. */
  preview: (stepped: boolean) => Promise<void>;
  /** Before any migration applies: refuses work whose backup nobody confirmed. */
  confirmBeforeMigrations: (step: number | undefined) => Promise<void>;
  /** Once every migration has applied: runs the steps. */
  takeAfterMigrations: () => Promise<void>;
  /** Where the steps were not taken: names passwords still stored as given. */
  warnOfPasswordsLeft: () => Promise<void>;
  /** The backup refusal the steps ended with after the migrations applied, if any. */
  refusal: () => NextlyError | null;
}

/** Prints `plan` under the dry run's heading; nothing when it holds neither work nor a refusal. */
function reportPlan(
  plan: DryRunPlan,
  logger: StoredDataLogger,
  stepped: boolean
): void {
  const refusals = plan.refusals ?? [];
  const report = plan.report;
  const listed =
    report !== undefined &&
    report.move.length + report.conflicts.length + report.check.length > 0;
  if (plan.changes.length === 0 && refusals.length === 0 && !listed) return;
  logger.newline();
  logger.info("Data stored by an earlier release, once the migrations apply:");
  for (const { action, target } of plan.changes) {
    logger.info(`  • would ${action} ${target}`);
  }
  // What the steps that move content list of it, each list under its heading.
  if (report !== undefined && listed) {
    const sections = [
      ["Would move:", report.move],
      ["Conflicts, and how a real run settles them:", report.conflicts],
      ["An editor should check:", report.check],
    ] as const;
    for (const [heading, items] of sections) {
      logger.info(`  ${heading}`);
      for (const item of items.length > 0 ? items : ["(none)"]) {
        logger.info(`    - ${item}`);
      }
    }
  }
  if (stepped) {
    // A run with `--step` takes the steps only when it applies the last
    // pending migration, so what it would refuse for them is not said here.
    logger.info(
      "  A run with --step takes these only when it leaves no migration pending."
    );
    return;
  }
  for (const refusal of refusals) {
    logger.info(`  ✖ a real run would refuse: ${refusal}`);
  }
  for (const note of plan.notes ?? []) logger.info(`  ${note}`);
}

export function migrateStoredData(args: {
  adapter: DrizzleAdapter;
  logger: StoredDataLogger;
  /** The operator's `--backup-confirmed`. */
  backupConfirmed: boolean;
  /** The schema lock's lease, in seconds, as the configuration sets it. */
  lockTtlSeconds: number | undefined;
  /** The site's configuration, which the steps that bring content into its model judge by. */
  site?: UpgradeSite;
}): MigrateStoredData {
  const { adapter, logger } = args;
  let confirmed = args.backupConfirmed;
  let taken = false;
  let refused: NextlyError | null = null;

  const askBackedUp = async () => {
    const yes = await askYesInTerminal(
      "Have you backed up your database? [y/N]: "
    );
    if (yes) confirmed = true;
    return yes;
  };
  /** What the steps are run with, before or after the run's migrations. */
  const deps = (afterMigrations: boolean): DataStepsDeps => ({
    afterMigrations,
    adapter: adapter as unknown as DataStepsDeps["adapter"],
    command: "nextly migrate",
    steps: MIGRATE_DATA_STEPS,
    backupConfirmed: confirmed,
    interactive: canPrompt(),
    askBackedUp,
    log: message => logger.info(message),
    warn: message => logger.warn(message),
    ...(args.site !== undefined ? { site: args.site } : {}),
    ...(args.lockTtlSeconds !== undefined
      ? { lockTtlSeconds: args.lockTtlSeconds }
      : {}),
  });

  return {
    askBackedUp,
    refusal: () => refused,

    // A count that cannot be read, on a database whose tables the pending
    // migrations create, is said so rather than guessed.
    preview: async stepped => {
      let plan: DryRunPlan;
      try {
        plan = await previewDataSteps(deps(false));
      } catch (error) {
        logger.info(
          `  Data stored by an earlier release could not be counted: ${describeError(error)}`
        );
        return;
      }
      reportPlan(plan, logger, stepped);
    },

    // Asked before anything changes, so a run that would be refused for the
    // steps leaves the migrations unapplied too. Not under `--step`, which
    // may stop before the steps run. A count that cannot be read yet, on a
    // database whose tables the migrations create, is taken again after
    // them; a refusal made then says that the migrations had applied.
    confirmBeforeMigrations: async step => {
      if (step !== undefined) return;
      try {
        const before = deps(false);
        await confirmDataStepsBackup(
          before,
          await firstDataStepWithWork(before).catch(() => undefined)
        );
      } finally {
        // The count registers the tables it reads as they stand before the
        // migrations. The run goes on with the resolver it started with, so
        // nothing after reads a table in the shape it had before them.
        installRegistryResolver(adapter);
      }
    },

    // A backup nobody confirmed is refused here only where the check before
    // the migrations could not see the work. The migrations have applied, so
    // the refusal is kept for the run to end with once its remaining deploy
    // work is done, rather than thrown past it.
    takeAfterMigrations: async () => {
      try {
        await runDataSteps(deps(true));
        taken = true;
      } catch (error) {
        if (!isDataStepsBackupRefusal(error)) throw error;
        refused = error;
      }
    },

    // Read-only. Only where this run did not take its steps, since
    // migrations are still pending: one that took them has just hashed every
    // password it found, and one refused has named the work already. A count
    // that cannot be read never fails a migrate that succeeded.
    warnOfPasswordsLeft: async () => {
      if (taken || refused !== null) return;
      try {
        const notice = storedPasswordsNotice(
          storedPasswordTotal(
            await countPasswordsStoredAsGiven(storedPasswordsOn(adapter))
          )
        );
        if (notice) logger.warn(notice);
      } catch (err) {
        logger.warn(
          `Could not check for passwords stored before this release: ${describeError(err)}`
        );
      }
    },
  };
}
