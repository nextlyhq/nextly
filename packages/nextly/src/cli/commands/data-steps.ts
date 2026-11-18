/**
 * Running the steps that bring data an earlier release stored up to date.
 *
 * A step (`UpgradeStep`) counts what it would change and changes it, and is
 * idempotent. `nextly migrate` runs the steps of `MIGRATE_DATA_STEPS` once
 * its migrations have applied, and `nextly i18n:convert-zoned-dates` runs its
 * one step; both run them through here, so both ask for a backup the same
 * way and hold the schema lock the same way.
 *
 * In order: every step is counted, read-only and with no lock, and a run
 * with nothing to change ends there, asking nothing. With work, a backup is
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

import type {
  UpgradeAdapter,
  UpgradeStep,
  UpgradeStepContext,
} from "./upgrade-step";

/** What a run of the steps is handed by its command. */
export interface DataStepsDeps {
  adapter: UpgradeAdapter;
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

/** What each step is handed: the database and the command's log. */
function stepContext(
  deps: Pick<DataStepsDeps, "adapter" | "log" | "warn">
): UpgradeStepContext {
  const { adapter } = deps;
  return {
    adapter,
    db: adapter.getDrizzle(),
    dialect: adapter.getCapabilities().dialect,
    options: {},
    log: deps.log,
    warn: deps.warn,
  };
}

/** A step with work as a run reports it and a refusal names it: `<title>: <count>`. */
const named = ({ step, pending }: PendingDataStep) =>
  `${step.title}: ${String(pending)}`;

/**
 * The steps with work on the database as it stands, read-only and with no
 * lock. A step whose count refuses stops the read with that refusal.
 */
export async function pendingDataSteps(
  deps: Pick<DataStepsDeps, "adapter" | "steps" | "log" | "warn">
): Promise<PendingDataStep[]> {
  const context = stepContext(deps);
  const withWork: PendingDataStep[] = [];
  for (const step of deps.steps) {
    const pending = await step.pending(context);
    if (pending > 0) withWork.push({ step, pending });
  }
  return withWork;
}

/** The refusal of steps with work whose backup nobody confirmed, and nobody can be asked about. */
function backupNotConfirmed(
  command: string,
  withWork: readonly PendingDataStep[]
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_UPGRADE_IN_PROGRESS",
    publicMessage:
      `\`${command}\` would change data an earlier Nextly release stored (${withWork.map(named).join("; ")}), and does so only once a backup is confirmed. ` +
      `Back up the database, then run \`${command} --backup-confirmed\`.`,
    logContext: { reason: "data-steps-backup-not-confirmed", command },
  });
}

/** The refusal of steps with work whose backup question was answered no. */
function backupDeclined(
  command: string,
  withWork: readonly PendingDataStep[]
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_UPGRADE_IN_PROGRESS",
    publicMessage:
      `The data an earlier Nextly release stored was left as it is (${withWork.map(named).join("; ")}): the backup question was answered no. ` +
      `Back up the database, then run \`${command}\` again and answer yes, or pass \`--backup-confirmed\`.`,
    logContext: { reason: "data-steps-backup-declined", command },
  });
}

/**
 * Confirms a backup for `withWork`: by the flag, or by a yes at a terminal.
 * With neither it refuses, having changed nothing. With no work it asks
 * nothing, whatever the flag says.
 */
export async function confirmDataStepsBackup(
  deps: Pick<
    DataStepsDeps,
    "command" | "backupConfirmed" | "interactive" | "askBackedUp"
  >,
  withWork: readonly PendingDataStep[]
): Promise<void> {
  if (withWork.length === 0 || deps.backupConfirmed) return;
  if (!deps.interactive || deps.askBackedUp === undefined) {
    throw backupNotConfirmed(deps.command, withWork);
  }
  if (!(await deps.askBackedUp())) {
    throw backupDeclined(deps.command, withWork);
  }
}

/**
 * Runs the steps with work and returns how many things each changed, in
 * order; empty when no step had anything to do, in which case nothing was
 * asked and no lock was taken.
 */
export async function runDataSteps(
  deps: DataStepsDeps
): Promise<{ title: string; changed: number }[]> {
  await confirmDataStepsBackup(deps, await pendingDataSteps(deps));
  // Asked or not, a run that found nothing leaves the lock alone.
  if ((await pendingDataSteps(deps)).length === 0) return [];

  const context = stepContext(deps);
  const ran: { title: string; changed: number }[] = [];
  await withMigrateLock(
    deps.adapter as unknown as DrizzleAdapter,
    context.dialect,
    async () => {
      // Counted again under the lock, each once the steps before it have
      // run: a run this one waited behind may have done the work already.
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
  >
): Promise<DryRunPlan> {
  const withWork = await pendingDataSteps(deps);
  const notes: string[] = [];
  let refusal: string | undefined;
  if (withWork.length > 0) {
    notes.push(
      "Each count is taken before any step runs; a real run counts each step once the steps before it have run."
    );
    if (!deps.backupConfirmed) {
      if (deps.interactive) {
        notes.push(
          "A real run first asks whether the database is backed up; pass --backup-confirmed to confirm it without being asked."
        );
      } else {
        refusal = backupNotConfirmed(deps.command, withWork).publicMessage;
      }
    }
  }
  return {
    changes: withWork.map(stepChange),
    ...(refusal !== undefined ? { refusals: [refusal] } : {}),
    notes,
  };
}
