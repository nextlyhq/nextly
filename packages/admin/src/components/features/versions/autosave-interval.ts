/**
 * How long the editor waits after the last change before recording a recovery
 * point, as the entity's own versions configuration sets it
 * (`versions.drafts.autosave.intervalMs`).
 *
 * The registry stores the resolved configuration on the schema payload, so the
 * interval a developer configured is there to read; an editor that used its
 * own fixed delay instead recorded at a pace nobody chose.
 *
 * @module components/features/versions/autosave-interval
 */

/**
 * The longest delay a browser timer holds. `setTimeout` stores it as a signed
 * 32-bit integer, so anything longer overflows and fires almost at once.
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * @returns The configured interval in milliseconds, or `undefined` to keep the
 * editor's default: when the payload carries none, or a value no timer can
 * honour (zero, negative, not a finite number, or longer than a timer holds).
 */
export function autosaveIntervalFrom(schema: unknown): number | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  const { versions } = schema as {
    versions?: { drafts?: { autosave?: { intervalMs?: unknown } } } | null;
  };
  const intervalMs = versions?.drafts?.autosave?.intervalMs;
  return typeof intervalMs === "number" &&
    Number.isFinite(intervalMs) &&
    intervalMs > 0 &&
    intervalMs <= MAX_TIMER_DELAY_MS
    ? intervalMs
    : undefined;
}
