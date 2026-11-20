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
import {
  NOTHING_CHANGED,
  type UpgradeAdapter,
  type UpgradeReport,
  type UpgradeSite,
  type UpgradeStep,
  type UpgradeStepContext,
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
  /**
   * The schema changes the command applied before the steps, as a refusal made after them names
   * them: "the 2 migrations this run applied". Absent where it applied none.
   */
  schemaChanges?: string;
  /**
   * A precondition of the command's own, asked under the lock before any
   * step is counted or run: holding the lock is necessary for the steps and
   * may not be sufficient, as where a change another run left half done is
   * recorded apart from the lock. It refuses by throwing.
   */
  underLock?: () => Promise<void>;
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

/**
 * Which steps' counts mean something ahead of the run: a step's count is read from the database
 * as it stands, so it holds only where no earlier step of its group (`UpgradeStep.group`) has work
 * to do first, or a count that could not be read. `waits` says whether a step's count waits so;
 * `hasWork` records a step's group as having work, or as unreadable, from then on.
 */
function countsAhead(steps: readonly UpgradeStep[]): {
  waits: (step: UpgradeStep) => boolean;
  /** The earlier step of `step`'s group whose work its count waits for, if any. */
  waitingOn: (step: UpgradeStep) => UpgradeStep | undefined;
  hasWork: (step: UpgradeStep) => void;
} {
  const groupOf = (step: UpgradeStep) =>
    step.group ?? `step ${String(steps.indexOf(step))}`;
  // Each group with work, and the first of its steps that has it.
  const withWork = new Map<string, UpgradeStep>();
  return {
    waits: step => withWork.has(groupOf(step)),
    waitingOn: step => withWork.get(groupOf(step)),
    hasWork: step => {
      const group = groupOf(step);
      if (!withWork.has(group)) withWork.set(group, step);
    },
  };
}

/**
 * The refusal a step's count makes on the database as it stands, read-only and with no lock, as
 * `refuses` tells a refusal from a count that cannot be read. Steps are counted past those with
 * work, so a refusal later in the order is made before an earlier step changes anything; but only
 * a step whose count holds ahead of the run (`countsAhead`): one whose group has earlier work
 * reads what that work repairs, so it waits for the run. A count that fails for another reason
 * refuses nothing, and the rest of its group waits too.
 */
export async function refusalOfSteps(
  deps: Pick<DataStepsDeps, "adapter" | "steps" | "log" | "warn" | "site">,
  refuses: (error: unknown) => boolean
): Promise<NextlyError | undefined> {
  const context = stepContext(deps);
  const ahead = countsAhead(deps.steps);
  for (const step of deps.steps) {
    if (ahead.waits(step)) continue;
    try {
      if ((await step.pending(context)) > 0) ahead.hasWork(step);
    } catch (error) {
      if (NextlyError.is(error) && refuses(error)) return error;
      ahead.hasWork(step);
    }
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
      await deps.underLock?.();
      // Counted again under the lock, each once the steps before it have
      // run: a run this one waited behind may have done the work already,
      // and a step reads what the steps before it repaired.
      for (const step of deps.steps) {
        try {
          if ((await step.pending(context)) === 0) continue;
          const changed = await step.run(context);
          deps.log(`${step.title}: ${String(changed)}`);
          ran.push({ title: step.title, changed });
        } catch (error) {
          throw refusalAfterWork(error, deps, ran);
        }
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
 * A step's refusal as the run makes it: as the step made it where nothing had applied before it,
 * and otherwise with what had: the command's schema changes (`schemaChanges`) and the steps that
 * ran before it, which stay applied. Each is a repair that is safe to keep, and the next run
 * carries on from it, so the refusal says that, in place of "Nothing was changed", and that the
 * cause it names is what to fix first. Anything that is not a step's refusal is left as it is.
 */
function refusalAfterWork(
  error: unknown,
  deps: Pick<DataStepsDeps, "command" | "schemaChanges">,
  ran: readonly { title: string; changed: number }[]
): unknown {
  if (!NextlyError.is(error) || dryRunRefusalOf(error) === undefined) {
    return error;
  }
  const applied = [
    ...(deps.schemaChanges === undefined ? [] : [deps.schemaChanges]),
    ...ran.map(
      ({ title, changed }) => `the step "${title}" (${String(changed)})`
    ),
  ];
  if (applied.length === 0) return error;
  const cause = error.publicMessage.endsWith(NOTHING_CHANGED)
    ? error.publicMessage.slice(0, -NOTHING_CHANGED.length).trimEnd()
    : error.publicMessage;
  return new NextlyError({
    code: error.code,
    publicMessage:
      `${cause} Before this refusal, ${applied.join(" and ")} had applied, and stay applied: ` +
      `each is a repair that is safe to keep, and the next run carries on from it. Nothing else ` +
      `was changed. Fix what is named above, then run \`${deps.command}\` again.`,
    ...(error.publicData === undefined ? {} : { publicData: error.publicData }),
    logContext: {
      ...error.logContext,
      appliedBefore: {
        schemaChanges: deps.schemaChanges ?? null,
        steps: ran.map(({ title }) => title),
      },
    },
  });
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
  const {
    withWork,
    refusal: countRefusal,
    report,
    deferred,
  } = await countForPreview(deps);
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
      ...deferred,
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
  /** The refusals a step whose count waits for an earlier one's work may make once that runs. */
  deferred: string[];
}> {
  const context = stepContext(deps);
  const withWork: PendingDataStep[] = [];
  // What the steps that move content list of it, each step's lists in step order. Each is asked of
  // the database as it stands, as each count is, before any step runs.
  const report: UpgradeReport = { move: [], conflicts: [], check: [] };
  const ahead = countsAhead(deps.steps);
  const deferred: string[] = [];
  for (const step of deps.steps) {
    let pending: number;
    try {
      pending = await step.pending(context);
    } catch (error) {
      // A step whose group has earlier work reads what that work repairs: its count waits for the
      // run, and so does any refusal it makes now (`refusalOfSteps`), which is named as one the
      // run may make once that work is done, after the schema changes.
      const earlier = ahead.waitingOn(step);
      if (earlier) {
        const refusal = dryRunRefusalOf(error);
        if (refusal !== undefined) {
          deferred.push(
            `"${step.title}" may be refused once "${earlier.title}" has run, after the schema changes, which stay applied then: counted now, ${refusal}`
          );
        }
        continue;
      }
      const refusal = dryRunRefusalOf(error);
      if (refusal === undefined) throw error;
      return { withWork, refusal, report, deferred };
    }
    if (pending > 0) {
      withWork.push({ step, pending });
      ahead.hasWork(step);
    }
    // Asked of every step that lists anything, with work or without: a step can have nothing to
    // change and still something an editor should check.
    if (step.report) {
      const listed = await step.report(context);
      report.move.push(...listed.move);
      report.conflicts.push(...listed.conflicts);
      report.check.push(...listed.check);
    }
  }
  return { withWork, report, deferred };
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
