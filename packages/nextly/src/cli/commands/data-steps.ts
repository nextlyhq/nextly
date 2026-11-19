/**
 * Running the steps that bring data an earlier release stored up to date.
 *
 * A step (`UpgradeStep`) counts what it would change and changes it, and is
 * idempotent. `nextly migrate` runs the steps of `MIGRATE_DATA_STEPS` once
 * its migrations have applied, and `nextly i18n:convert-zoned-dates` runs its
 * one step; both run them through here, so both ask for a backup the same
 * way and hold the schema lock the same way.
 *
 * In order: the steps are counted, read-only and with no lock, up to the
 * first with work, and a run with nothing to change ends there, asking
 * nothing. With work, a backup is
 * confirmed, by the command's flag or by a yes at a terminal, before the
 * lock, so no other run waits on a person. Then the schema lock is held
 * while each step is counted again and run, each before the next is counted,
 * so a step reads what the steps before it repaired.
 *
 * @module cli/commands/data-steps
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { NextlyError } from "../../errors";
import type { DryRunChange, DryRunPlan } from "../dry-run";

import { confirmBackup } from "./backup-confirmation";
import { dryRunRefusalOf } from "./migrate-create";

import type {
  UpgradeAdapter,
  UpgradeReport,
  UpgradeSite,
  UpgradeStep,
  UpgradeStepContext,
} from "./upgrade-step";

/** What a run of the steps is handed by its command. */
export interface DataStepsDeps {
  adapter: UpgradeAdapter;
  /** The site's configuration, which the steps that bring content into its model judge by. */
  site?: UpgradeSite;
  /** The command running them, as a refusal and the lock's holder name it: "nextly migrate". */
  command: string;
  /** The steps, in the order they run. */
  steps: readonly UpgradeStep[];
  /** Whether the operator stated a backup exists (`--backup-confirmed`). */
  backupConfirmed: boolean;
  /** Whether a person is at a terminal to be asked. */
  interactive: boolean;
  /** Asks that person whether the database is backed up; only called when `interactive`. */
  askBackedUp?: () => Promise<boolean>;
  log: (message: string) => void;
  warn: (message: string) => void;
  /**
   * Set where the command has already changed the database by the time the
   * steps are reached, as `nextly migrate` has once its migrations applied:
   * a refusal then says so, rather than that nothing was changed.
   */
  afterMigrations?: boolean;
  /** How long a held schema lock is waited for, in milliseconds. Absent, about a minute. */
  lockWaitMs?: number;
  /** The schema lock's lease, in seconds, as the configuration sets it. */
  lockTtlSeconds?: number;
}

/** A step with work, and how much. */
export interface PendingDataStep {
  step: UpgradeStep;
  pending: number;
}

/** What each step is handed: the database, the site and the command's log. */
function stepContext(
  deps: Pick<DataStepsDeps, "adapter" | "log" | "warn" | "site">
): UpgradeStepContext {
  const { adapter } = deps;
  return {
    adapter,
    db: adapter.getDrizzle(),
    dialect: adapter.getCapabilities().dialect,
    ...(deps.site === undefined ? {} : { site: deps.site }),
    log: deps.log,
    warn: deps.warn,
  };
}

/** A step with work as a run reports it and a refusal names it: `<title>: <count>`. */
const named = ({ step, pending }: PendingDataStep) =>
  `${step.title}: ${String(pending)}`;

/**
 * The first step with work on the database as it stands, read-only and with
 * no lock; undefined when none has any. Counted in order and no further than
 * the first with work: a later step may read what that one repairs, so its
 * count means nothing until it has run. A step whose count refuses stops the
 * read with that refusal.
 */
export async function firstDataStepWithWork(
  deps: Pick<DataStepsDeps, "adapter" | "steps" | "log" | "warn" | "site">
): Promise<PendingDataStep | undefined> {
  const context = stepContext(deps);
  for (const step of deps.steps) {
    const pending = await step.pending(context);
    if (pending > 0) return { step, pending };
  }
  return undefined;
}

/** The refusal of steps with work whose backup nobody confirmed, and nobody can be asked about. */
function backupNotConfirmed(
  command: string,
  first: PendingDataStep,
  afterMigrations = false
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_UPGRADE_IN_PROGRESS",
    publicMessage:
      `\`${command}\` would change data an earlier Nextly release stored (${named(first)}), and does so only once a backup is confirmed. ` +
      `Back up the database, then run \`${command} --backup-confirmed\`.`,
    logContext: {
      reason: "data-steps-backup-not-confirmed",
      command,
      afterMigrations,
    },
  });
}

/** The refusal of steps with work whose backup question was answered no. */
function backupDeclined(
  command: string,
  first: PendingDataStep,
  afterMigrations = false
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_UPGRADE_IN_PROGRESS",
    publicMessage:
      `The data an earlier Nextly release stored was left as it is (${named(first)}): the backup question was answered no. ` +
      `Back up the database, then run \`${command}\` again and answer yes, or pass \`--backup-confirmed\`.`,
    logContext: {
      reason: "data-steps-backup-declined",
      command,
      afterMigrations,
    },
  });
}

/** Whether `error` is one of the two backup refusals of the steps. */
export function isDataStepsBackupRefusal(error: unknown): error is NextlyError {
  if (!NextlyError.isCode(error, "NEXTLY_UPGRADE_IN_PROGRESS")) return false;
  const reason = error.logContext?.reason;
  return (
    reason === "data-steps-backup-not-confirmed" ||
    reason === "data-steps-backup-declined"
  );
}

/**
 * Confirms a backup for the work `first` starts (`confirmBackup`): by the
 * flag, or by a yes at a terminal. With neither it refuses, the stored data
 * as it was. With no work it asks nothing, whatever the flag says.
 */
export async function confirmDataStepsBackup(
  deps: Pick<
    DataStepsDeps,
    | "command"
    | "backupConfirmed"
    | "interactive"
    | "askBackedUp"
    | "afterMigrations"
  >,
  first: PendingDataStep | undefined
): Promise<void> {
  if (first === undefined) return;
  await confirmBackup({
    backupConfirmed: deps.backupConfirmed,
    interactive: deps.interactive,
    askBackedUp: deps.askBackedUp,
    notConfirmed: () =>
      backupNotConfirmed(deps.command, first, deps.afterMigrations),
    declined: () => backupDeclined(deps.command, first, deps.afterMigrations),
  });
}

/**
 * Runs the steps with work and returns how many things each changed, in
 * order; empty when no step had anything to do, in which case nothing was
 * asked and no lock was taken.
 */
export async function runDataSteps(
  deps: DataStepsDeps
): Promise<{ title: string; changed: number }[]> {
  const first = await firstDataStepWithWork(deps);
  if (first === undefined) return [];
  await confirmDataStepsBackup(deps, first);

  const context = stepContext(deps);
  const ran: { title: string; changed: number }[] = [];
  await withMigrateLock(
    deps.adapter as unknown as DrizzleAdapter,
    context.dialect,
    async () => {
      // Counted again under the lock, each once the steps before it have
      // run: a run this one waited behind may have done the work already,
      // and a step reads what the steps before it repaired.
      for (const step of deps.steps) {
        if ((await step.pending(context)) === 0) continue;
        const changed = await step.run(context);
        deps.log(`${step.title}: ${String(changed)}`);
        ran.push({ title: step.title, changed });
      }
    },
    {
      command: deps.command,
      mode: "wait",
      waitMs: deps.lockWaitMs,
      ttlSeconds: deps.lockTtlSeconds,
      releaseOnInterrupt: true,
      logger: { warn: deps.warn, info: deps.log },
    }
  );
  return ran;
}

/**
 * A step with work as a dry run names it, in the words the real run reports
 * it with (`<title>: <count>`): a step's title starts with its verb.
 */
function stepChange({ step, pending }: PendingDataStep): DryRunChange {
  const [verb = "", ...rest] = step.title.split(" ");
  return { action: verb, target: `${rest.join(" ")}: ${String(pending)}` };
}

/**
 * The steps' work as a dry run reports it: each step's count against the
 * database as it stands, read-only, with no backup question and no lock.
 * With work, a backup nobody confirmed and nobody can be asked about refuses
 * a real run before its first step, so that is the refusal named.
 */
export async function previewDataSteps(
  deps: Pick<
    DataStepsDeps,
    | "adapter"
    | "command"
    | "steps"
    | "backupConfirmed"
    | "interactive"
    | "log"
    | "warn"
    | "site"
  >
): Promise<DryRunPlan> {
  const { withWork, refusal: countRefusal, report } =
    await countForPreview(deps);
  const [first] = withWork;
  // A step whose count refused is the run's refusal, before any question.
  const outlook =
    first !== undefined && countRefusal === undefined
      ? backupOutlook(deps, first)
      : {};
  const refusal = countRefusal ?? outlook.refusal;
  return {
    changes: withWork.map(stepChange),
    ...(refusal !== undefined ? { refusals: [refusal] } : {}),
    notes: [
      ...(first !== undefined
        ? [
            "Each count is taken before any step runs; a real run counts each step once the steps before it have run.",
          ]
        : []),
      ...(outlook.note !== undefined ? [outlook.note] : []),
    ],
    report,
  };
}

/**
 * Each step's count for a dry run, in order. A step whose count refuses
 * stops the counting there, as it stops the run, and is the refusal named.
 */
async function countForPreview(
  deps: Pick<DataStepsDeps, "adapter" | "steps" | "log" | "warn" | "site">
): Promise<{
  withWork: PendingDataStep[];
  refusal?: string;
  report: UpgradeReport;
}> {
  const context = stepContext(deps);
  const withWork: PendingDataStep[] = [];
  // What the steps that move content list of it, each step's lists in step order. Each is asked of
  // the database as it stands, as each count is, before any step runs.
  const report: UpgradeReport = { move: [], conflicts: [], check: [] };
  for (const step of deps.steps) {
    let pending: number;
    try {
      pending = await step.pending(context);
    } catch (error) {
      const refusal = dryRunRefusalOf(error);
      if (refusal === undefined) throw error;
      return { withWork, refusal, report };
    }
    if (pending > 0) withWork.push({ step, pending });
    // Asked of every step that lists anything, with work or without: a step can have nothing to
    // change and still something an editor should check.
    if (step.report) {
      const listed = await step.report(context);
      report.move.push(...listed.move);
      report.conflicts.push(...listed.conflicts);
      report.check.push(...listed.check);
    }
  }
  return { withWork, report };
}

/**
 * What a real run with work does about the backup, as a dry run says it:
 * nothing to say once it is confirmed, a note where it would ask, and the
 * refusal where nobody could be asked.
 */
function backupOutlook(
  deps: Pick<DataStepsDeps, "command" | "backupConfirmed" | "interactive">,
  first: PendingDataStep
): { note?: string; refusal?: string } {
  if (deps.backupConfirmed) return {};
  if (!deps.interactive) {
    return { refusal: backupNotConfirmed(deps.command, first).publicMessage };
  }
  return {
    note: "A real run first asks whether the database is backed up; pass --backup-confirmed to confirm it without being asked.",
  };
}
