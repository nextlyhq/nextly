/**
 * Runs migration steps and records how far they got.
 *
 * The ordering here is the whole point. A step runs, then its postcondition is
 * checked against the database, and only then is it recorded. Recording first
 * would let a step that silently did nothing be marked done and skipped on the
 * next run, which is indistinguishable from success until the data is read
 * months later. Verifying first costs one extra query per step and turns that
 * class of failure into a refusal at the moment it happens.
 *
 * Steps must be idempotent. A crash between a step's commit and its marker
 * write is invisible from the outside, so a resume re-runs that step; the
 * marker records the last step *known* to be done, never the last attempted.
 *
 * @module domains/field-groups/migration/runner
 */

import { NextlyError } from "../../../errors/nextly-error";
import type { MetaService } from "../../meta/services/meta-service";

import type { MigrationSession } from "./session";
import { advanceStep } from "./state";

/**
 * One unit of migration work.
 *
 * `verify` answers "is the database now in the state `run` was supposed to
 * leave it in", asked of the database rather than of the step's own return
 * value, so a step that reports success it did not achieve is still caught.
 */
export interface MigrationStep {
  /** Stable identity, used in logs and refusals rather than for ordering. */
  readonly id: string;
  run(session: MigrationSession): Promise<void>;
  verify(session: MigrationSession): Promise<boolean>;
}

/**
 * Run steps from `fromStep` onward, recording each one that verifies.
 *
 * `fromStep` is 1-based and matches the resume verdict: step numbers index the
 * plan from one, so the marker's `0` means "nothing verified yet".
 */
export async function runMigrationSteps(args: {
  session: MigrationSession;
  meta: MetaService;
  migrationId: string;
  steps: readonly MigrationStep[];
  fromStep: number;
}): Promise<void> {
  const { session, meta, migrationId, steps, fromStep } = args;

  if (!Number.isSafeInteger(fromStep) || fromStep < 1) {
    throw NextlyError.internal({
      logContext: {
        reason: "migration must resume from a positive step position",
        fromStep,
      },
    });
  }

  // A resume position past the end means the marker and the plan disagree about
  // how much work exists. `assertPlanUnchanged` catches the ordinary causes;
  // this catches whatever it did not, rather than silently completing a run
  // that never executed anything.
  if (fromStep > steps.length + 1) {
    throw NextlyError.serviceUnavailable({
      logMessage:
        "field-group migration cannot resume: the recorded position is past the end of the plan",
      logContext: {
        reason: "resume position is past the end of the plan",
        fromStep,
        steps: steps.length,
      },
    });
  }

  for (let position = fromStep; position <= steps.length; position += 1) {
    const step = steps[position - 1];
    if (!step) {
      throw NextlyError.internal({
        logContext: { reason: "migration plan has a hole", position },
      });
    }

    await step.run(session);

    const verified = await step.verify(session);
    if (!verified) {
      // Not recorded, so a later run retries this step rather than stepping
      // over it. Refusing is the only safe move: the database is not in the
      // state the plan believes, and every later step is written against that
      // belief.
      throw NextlyError.serviceUnavailable({
        logMessage: `field-group migration step did not reach its expected state: ${step.id}`,
        logContext: {
          reason: "migration step failed its postcondition",
          step: step.id,
          position,
        },
      });
    }

    await advanceStep(meta, { migrationId, step: position });
  }
}
