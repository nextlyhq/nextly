/**
 * The steps `nextly migrate` runs over data an earlier release stored, run
 * as that command runs them once its migrations have applied
 * (`runDataSteps`), with the backup confirmed: for a test of a step's own
 * work, which has no need of a migration folder.
 */
import { runDataSteps, type DataStepsDeps } from "../../data-steps";
import { MIGRATE_DATA_STEPS } from "../../upgrade-steps";

export function runMigrateDataSteps(
  adapter: unknown,
  options: {
    log?: (message: string) => void;
    warn?: (message: string) => void;
    steps?: DataStepsDeps["steps"];
    lockWaitMs?: number;
  } = {}
): ReturnType<typeof runDataSteps> {
  return runDataSteps({
    adapter: adapter as DataStepsDeps["adapter"],
    command: "nextly migrate",
    steps: options.steps ?? MIGRATE_DATA_STEPS,
    backupConfirmed: true,
    interactive: false,
    log: options.log ?? (() => {}),
    warn: options.warn ?? options.log ?? (() => {}),
    ...(options.lockWaitMs !== undefined
      ? { lockWaitMs: options.lockWaitMs }
      : {}),
  });
}
