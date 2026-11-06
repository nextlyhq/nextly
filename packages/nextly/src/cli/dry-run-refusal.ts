/**
 * A dry run's plan or the real run's refusal, kept apart from `dry-run.ts`,
 * which every command's registration loads: this one loads the errors module,
 * and only a dry run that works out a plan needs it.
 *
 * @module cli/dry-run-refusal
 */
import { NextlyError } from "../errors/nextly-error";

import type { DryRunPlan } from "./dry-run";

/**
 * A dry run's plan, or the refusal the real command would meet working it
 * out: `plan` runs the command's own read-only decisions, and one of them
 * failing with a request or state error (a 4xx) is the real run's refusal,
 * reported in its words. Anything else means the plan could not be worked
 * out, and the dry run fails on it as the real run does. `plan` answers
 * undefined when it has reported its own end, such as a database that is
 * not there.
 */
export async function plannedOrRefused<T extends DryRunPlan | undefined>(
  plan: () => Promise<T>
): Promise<T | DryRunPlan> {
  try {
    return await plan();
  } catch (error) {
    if (NextlyError.is(error) && error.statusCode < 500) {
      return { changes: [], refusals: [error.publicMessage] };
    }
    throw error;
  }
}
