/**
 * Whether a write unpublishes a published document: the one reading every
 * plugin guard that refuses an unpublish asks.
 *
 * Kept in one place so the component guard and the Layout guard cannot come
 * to disagree about which saves take a document off the site.
 *
 * @module unpublish-write
 */

/** The parts of a `beforeChange` hook context the answer reads. */
export interface UnpublishHookContext {
  operation?: unknown;
  data?: unknown;
  originalData?: unknown;
}

/** A row's `status`, or undefined when the row does not carry one. */
export function statusOf(row: unknown): string | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const status = (row as { status?: unknown }).status;
  return typeof status === "string" ? status : undefined;
}

/**
 * Whether this update unpublishes a published document.
 *
 * Any explicit status other than `published` does, whatever its type, as
 * core's own lifecycle gate reads it: a value a dialect would coerce into the
 * status column takes the row out of `published` all the same. A save that
 * leaves the status out, or sets it to `undefined` (which core strips), keeps
 * the published row live and stores a pending edit beside it. A create has no
 * stored row, so it unpublishes nothing.
 */
export function unpublishes(context: unknown): boolean {
  const hook = context as UnpublishHookContext | null;
  if (hook?.operation !== undefined && hook.operation !== "update") {
    return false;
  }
  const data = hook?.data;
  if (typeof data !== "object" || data === null) return false;
  const next = (data as { status?: unknown }).status;
  return (
    statusOf(hook?.originalData) === "published" &&
    Object.hasOwn(data, "status") &&
    next !== undefined &&
    next !== "published"
  );
}
