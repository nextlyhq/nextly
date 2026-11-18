/**
 * `nextly i18n:convert-zoned-dates`: converts each translated date column an
 * earlier release made with a time zone on PostgreSQL to a plain timestamp,
 * as the main table keeps a date, each value keeping the date Nextly showed.
 *
 * A command of its own, run once after the release serves every instance,
 * and never a part of `nextly migrate`, which runs before it does: an
 * instance of an earlier release still running writes a date in a
 * non-default language as its own local time, and a converted column would
 * keep that shifted. A start and `nextly migrate` name each such column and
 * this command.
 *
 * It is one data step (`zonedDatesStep`) run as `nextly migrate` runs its
 * own (`runDataSteps`): counted first, a backup confirmed before anything
 * changes, and the schema lock held for the conversion. Run again, it finds
 * nothing to convert.
 *
 * @module cli/commands/i18n-convert-zoned-dates
 */

import type { Command } from "commander";

import { assertNoLegacyBookkeeping } from "../../domains/schema/events/legacy-detection";
import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import { reportDryRun, type DryRunPlan } from "../dry-run";
import { failWithError } from "../errors";
import { createContext } from "../program";
import { openCommandAdapter } from "../utils/adapter";
import { requireDatabaseEnv } from "../utils/command-prerequisites";
import { askYesInTerminal } from "../utils/prompt-cancelled";

import {
  previewDataSteps,
  runDataSteps,
  type DataStepsDeps,
} from "./data-steps";
import { maybeForceUnlock, migrateExitCode } from "./migrate";
import { dryRunRefusalOf } from "./migrate-create";
import { zonedDatesStep } from "./upgrade-steps";

const COMMAND = "nextly i18n:convert-zoned-dates";

/** What a run is handed: the database, and how its operator is asked. */
export type ConvertZonedDatesDeps = Pick<
  DataStepsDeps,
  | "adapter"
  | "backupConfirmed"
  | "interactive"
  | "askBackedUp"
  | "log"
  | "warn"
  | "lockWaitMs"
> & {
  /** The step run: the conversion unless a test narrows it. */
  steps?: DataStepsDeps["steps"];
};

const stepsOf = (deps: ConvertZonedDatesDeps): DataStepsDeps => ({
  ...deps,
  command: COMMAND,
  steps: deps.steps ?? [zonedDatesStep],
});

/**
 * Converts the columns and returns how many it converted; 0, saying so, when
 * none is kept with a time zone. A database still keeping its migration
 * records the way an earlier release did is refused first, naming `nextly
 * migrate`, which moves them: the conversion reads a database that command
 * has brought to this release.
 */
export async function runConvertZonedDates(
  deps: ConvertZonedDatesDeps
): Promise<number> {
  await assertNoLegacyBookkeeping(deps.adapter);
  const ran = await runDataSteps(stepsOf(deps));
  if (ran.length === 0) {
    deps.log(
      "No translated date column is kept with a time zone. Nothing to do."
    );
  }
  return ran.reduce((sum, step) => sum + step.changed, 0);
}

/**
 * `nextly i18n:convert-zoned-dates --dry-run`: how many columns a real run
 * would convert, read-only, with no backup question and no lock, and the
 * refusal a real run would make.
 */
export async function previewConvertZonedDates(
  deps: Pick<
    ConvertZonedDatesDeps,
    "adapter" | "backupConfirmed" | "interactive" | "log" | "warn" | "steps"
  >
): Promise<DryRunPlan> {
  // Refused as the real run refuses it, before anything is counted.
  try {
    await assertNoLegacyBookkeeping(deps.adapter);
  } catch (error) {
    const refusal = dryRunRefusalOf(error);
    if (refusal === undefined) throw error;
    return { changes: [], refusals: [refusal] };
  }
  return previewDataSteps(stepsOf(deps));
}

interface ConvertZonedDatesOptions {
  backupConfirmed?: boolean;
  forceUnlock?: boolean;
  dryRun?: boolean;
}

/** The action of `nextly i18n:convert-zoned-dates`, loaded when it runs. */
export async function i18nConvertZonedDatesAction(
  cmdOptions: ConvertZonedDatesOptions,
  cmd: Command
): Promise<void> {
  const globalOpts = cmd.optsWithGlobals<{ verbose?: boolean }>();
  const context = createContext(globalOpts);
  const { logger } = context;
  const dbValidation = requireDatabaseEnv(logger);

  let adapter: Awaited<ReturnType<typeof openCommandAdapter>>;
  try {
    // A dry run whose database is not there has said so, and ends here.
    adapter = await openCommandAdapter(
      {
        dialect: dbValidation.dialect,
        databaseUrl: dbValidation.databaseUrl,
        logger: globalOpts.verbose ? logger : undefined,
        dryRun: cmdOptions.dryRun === true,
      },
      logger
    );
    if (adapter === undefined) return;
    const deps: ConvertZonedDatesDeps = {
      adapter: adapter as unknown as DataStepsDeps["adapter"],
      backupConfirmed: cmdOptions.backupConfirmed === true,
      // The CLI's one answer to whether anyone can be asked.
      interactive: canPrompt(),
      askBackedUp: () =>
        askYesInTerminal("Have you backed up your database? [y/N]: "),
      log: message => logger.info(message),
      warn: message => logger.warn(message),
    };
    if (cmdOptions.dryRun === true) {
      const plan = await previewConvertZonedDates(deps);
      // Nothing is cleared in a dry run: the lock it would clear is named.
      reportDryRun(
        logger,
        cmdOptions.forceUnlock === true
          ? {
              ...plan,
              changes: [
                { action: "remove", target: "any migrate lock held" },
                ...plan.changes,
              ],
            }
          : plan
      );
      return;
    }
    // A stale lock, left by a run that crashed, is cleared first when asked.
    await maybeForceUnlock(
      cmdOptions,
      deps.adapter.getDrizzle(),
      deps.adapter.getCapabilities().dialect
    );
    await runConvertZonedDates(deps);
  } catch (error) {
    // Set rather than exited, so the disconnect below still runs.
    failWithError(logger, error, migrateExitCode(error));
  } finally {
    await adapter?.disconnect();
  }
}
