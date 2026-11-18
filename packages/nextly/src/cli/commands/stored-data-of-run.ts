/**
 * What a command that brings a database's schema up to date does with the
 * data an earlier release stored: `nextly migrate`, once its migrations have
 * applied, and `nextly db:sync`, once it has synced. Both take the steps of
 * `MIGRATE_DATA_STEPS` (`runDataSteps`) and share the run's one backup
 * question.
 *
 * One value per run (`storedDataOfRun`) holds what the run has learned: a
 * yes at the backup question, which holds for the rest of the run so nobody
 * is asked twice; whether the steps were taken; and the backup refusal they
 * ended with where the work could only be seen after the schema changed.
 *
 * @module cli/commands/stored-data-of-run
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

/** What a command does with the data an earlier release stored, over one run. */
export interface StoredDataOfRun {
  /** The run's one backup question; a yes holds for the rest of the run. */
  askBackedUp: () => Promise<boolean>;
  /** `--dry-run`: lists each step with work, read-only. */
  preview: (stepped: boolean) => Promise<void>;
  /**
   * `--dry-run`, for a command that reports one plan: the steps' work as
   * that plan's changes, refusals and notes, read-only. A count that cannot
   * be read, on a database whose tables the run creates, is a note.
   */
  plan: () => Promise<DryRunPlan>;
  /**
   * Before the command changes the schema: refuses work whose backup nobody
   * confirmed. Not made for a run limited by `--step`, which may stop before
   * the steps.
   */
  confirmBeforeSchemaChanges: (step?: number) => Promise<void>;
  /** Once the schema is up to date: runs the steps. */
  takeAfterSchemaChanges: () => Promise<void>;
  /** Where the steps were not taken: names passwords still stored as given. */
  warnOfPasswordsLeft: () => Promise<void>;
  /** The backup refusal the steps ended with after the schema changed, if any. */
  refusal: () => NextlyError | null;
}

/** Prints `plan` under the dry run's heading; nothing when it holds neither work nor a refusal. */
function reportPlan(
  plan: DryRunPlan,
  logger: StoredDataLogger,
  stepped: boolean
): void {
  const refusals = plan.refusals ?? [];
  const notes = plan.notes ?? [];
  if (plan.changes.length + refusals.length + notes.length === 0) return;
  logger.newline();
  logger.info(
    "Data stored by an earlier release, once the schema is up to date:"
  );
  for (const { action, target } of plan.changes) {
    logger.info(`  • would ${action} ${target}`);
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
  for (const note of notes) logger.info(`  ${note}`);
}

export function storedDataOfRun(args: {
  adapter: DrizzleAdapter;
  /** The command, as a refusal and the schema lock's holder name it: "nextly migrate". */
  command: string;
  /**
   * Puts back the table resolver the command runs with. The count before the
   * schema changes registers the tables it reads as they stand then, and the
   * command must not go on to read one in that shape. Absent, the CLI's
   * registry resolver is installed.
   */
  restoreResolver?: () => void;
  logger: StoredDataLogger;
  /** The operator's `--backup-confirmed`. */
  backupConfirmed: boolean;
  /** The schema lock's lease, in seconds, as the configuration sets it. */
  lockTtlSeconds: number | undefined;
}): StoredDataOfRun {
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
  /** What the steps are run with, before or after the run's schema changes. */
  const deps = (afterMigrations: boolean): DataStepsDeps => ({
    afterMigrations,
    adapter: adapter as unknown as DataStepsDeps["adapter"],
    command: args.command,
    steps: MIGRATE_DATA_STEPS,
    backupConfirmed: confirmed,
    interactive: canPrompt(),
    askBackedUp,
    log: message => logger.info(message),
    warn: message => logger.warn(message),
    ...(args.lockTtlSeconds !== undefined
      ? { lockTtlSeconds: args.lockTtlSeconds }
      : {}),
  });

  // A count that cannot be read, on a database whose tables the run
  // creates, is said so in a note rather than guessed.
  const plan = async (): Promise<DryRunPlan> => {
    try {
      return await previewDataSteps(deps(false));
    } catch (error) {
      return {
        changes: [],
        notes: [
          `Data stored by an earlier release could not be counted: ${describeError(error)}`,
        ],
      };
    }
  };
  /** Puts back the resolver the command runs with, after a count or the steps replaced it. */
  const restoreResolver =
    args.restoreResolver ?? (() => installRegistryResolver(adapter));

  return {
    askBackedUp,
    refusal: () => refused,

    plan,

    // The same plan, printed under a heading of its own.
    preview: async stepped => {
      reportPlan(await plan(), logger, stepped);
    },

    // Asked before anything changes, so a run that would be refused for the
    // steps leaves the schema as it was too. A count that cannot be read
    // yet, on a database whose tables the run creates, is taken again after
    // it; a refusal made then says that the schema changes had applied.
    confirmBeforeSchemaChanges: async step => {
      if (step !== undefined) return;
      try {
        const before = deps(false);
        await confirmDataStepsBackup(
          before,
          await firstDataStepWithWork(before).catch(() => undefined)
        );
      } finally {
        // The run goes on with the resolver it started with, so nothing
        // after reads a table in the shape it had before the schema changed.
        restoreResolver();
      }
    },

    // A backup nobody confirmed is refused here only where the check before
    // the schema changes could not see the work. Those have applied, so
    // the refusal is kept for the run to end with once its remaining deploy
    // work is done, rather than thrown past it.
    takeAfterSchemaChanges: async () => {
      try {
        await runDataSteps(deps(true));
        taken = true;
      } catch (error) {
        if (!isDataStepsBackupRefusal(error)) throw error;
        refused = error;
      } finally {
        // The steps read through a registry of their own. A command that
        // goes on working, as a watched sync does, gets its own back.
        if (args.restoreResolver !== undefined) restoreResolver();
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
