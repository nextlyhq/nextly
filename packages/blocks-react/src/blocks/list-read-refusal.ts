/**
 * Whether a list's read was refused, and not simply failed: the question a
 * list answers by reading again in id order, and one a cached read has to keep
 * the answer to, so a list and the route's cache read it from one place.
 *
 * @module blocks/list-read-refusal
 */

/** Whether a read failed because the reader refused it, before or as it read. */
export function readWasRefused(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "INVALID_INPUT") return true;
  const errors = (error as { publicData?: { errors?: unknown } } | null)
    ?.publicData?.errors;
  return (
    Array.isArray(errors) &&
    errors.length > 0 &&
    errors.every(
      problem =>
        (problem as { code?: unknown } | null)?.code === "FIELD_NOT_SORTABLE"
    )
  );
}
