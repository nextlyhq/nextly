/**
 * The refusal a command makes when what the operator agreed to changed before the command could
 * act on it: `nextly prune` once it holds the schema lock, and `nextly db:sync --promote` /
 * `--demote` the same way. Nothing is changed, and the CLI prints it as
 * `PLAN_CHANGED_AFTER_CONSENT`, telling the operator to run the command again.
 *
 * One builder, so every command throws the shape the CLI reads: the code `CONFLICT` and the
 * `logContext.reason` below.
 *
 * @module domains/schema/migrate/plan-changed-after-consent
 */
import { NextlyError } from "../../../errors/nextly-error";

/** The `logContext.reason` the refusal carries, which the CLI reads as its code. */
export const PLAN_CHANGED_AFTER_CONSENT = "plan-changed-after-consent";

/** What the refusal's log context carries, which the CLI reads to say what changed. */
export interface PlanChangedAfterConsentContext {
  /** The command as the operator types it, such as `nextly prune`. */
  command: string;
  /** Each item the operator agreed to, as it was listed to them. */
  agreed: readonly string[];
  /** Each item the command would act on now, listed the same way. */
  current: readonly string[];
}

/**
 * The refusal itself. `message` is the command's own wording, for any reader that is not the
 * CLI; the CLI builds its lines from `command`, `agreed` and `current`.
 */
export function planChangedAfterConsent(
  args: PlanChangedAfterConsentContext & { message: string }
): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: args.message,
    logContext: {
      reason: PLAN_CHANGED_AFTER_CONSENT,
      command: args.command,
      agreed: [...args.agreed],
      current: [...args.current],
    },
  });
}
