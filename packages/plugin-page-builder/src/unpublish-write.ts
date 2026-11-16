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
  /**
   * The status core classifies the update against, where it differs from
   * `originalData`'s: on a store that keeps its status per language, the
   * status stored in the language the write names.
   */
  storedStatus?: unknown;
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
 *
 * The status it moves from is the one core names on the hook context, where
 * it names one: on a store that keeps its status per language, the language
 * the write names, so a published translation saved as a draft is judged an
 * unpublish while the main row is a draft. Where core names none, the stored
 * row's.
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
    statusBefore(hook) === "published" &&
    Object.hasOwn(data, "status") &&
    next !== undefined &&
    next !== "published"
  );
}

/**
 * The status an update moves from, as core classifies it. A value core names
 * that is neither a status nor `null` (no status stored) cannot be read, so it
 * answers as published: the guard asking runs its check rather than skip it.
 */
function statusBefore(hook: UnpublishHookContext | null): string | undefined {
  if (typeof hook === "object" && hook !== null && "storedStatus" in hook) {
    const stored = hook.storedStatus;
    if (typeof stored === "string") return stored;
    return stored === null ? undefined : "published";
  }
  return statusOf(hook?.originalData);
}
