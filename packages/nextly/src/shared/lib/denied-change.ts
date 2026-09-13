/**
 * Refusing a promotion that would change a field the publisher may not write.
 *
 * Shared by every path that folds held content into a live row: a Single's
 * ordinary publish, `publishAllLocales`, and a collection's publish. They
 * assemble the document they are about to write in their own ways, because a
 * Single's is a snapshot over the live row and a collection's also carries
 * components and many-to-many rows, but the question they ask of it afterwards
 * is one question and deserves one answer.
 *
 * Refused rather than stripped, which is the opposite of what a denied field
 * gets on an ordinary write. There, the value is the caller's own input and
 * dropping it costs them nothing they did not already have. Here the value
 * belongs to whoever saved the pending change, and a successful publish
 * CONSUMES that pending change: stripping would publish everything else, delete
 * the draft, and take the author's edit with it while reporting success.
 * Refusing keeps the draft for someone who can write the field.
 *
 * Judged on what would CHANGE rather than on what the document holds. The
 * document being written holds every field, so a denied one appears in all of
 * them, and only a value that differs from what is live is a change being made.
 *
 * @module shared/lib/denied-change
 */

import { isDeepStrictEqual } from "node:util";

import { NextlyError } from "../../errors";

/** What the caller has already worked out for one promotion. */
export interface DeniedChangeInput {
  /** The document the write would persist, before the field rules ran. */
  before: Record<string, unknown>;
  /**
   * The same document after the field rules ran over a COPY of it.
   *
   * A copy, because the rules delete a denied value in place: run over
   * `before` itself there would be nothing left to compare against, and run
   * over a SHALLOW copy the deletion would land on both, so a nested denial
   * would report nothing while the write persisted it.
   */
  permitted: Record<string, unknown>;
  /**
   * The row as it stands, in the same representation as `before`.
   *
   * Both sides have to be one representation or an untouched field reads as an
   * edit: a read that expands an upload or a relationship into the document
   * behind its identifier disagrees with a stored value that is the identifier.
   */
  live: Record<string, unknown>;
  /**
   * What the CALLER sent with this publish, in the same shape as `before`.
   *
   * A denied value the caller supplied themselves is stripped, not refused,
   * because that is the ordinary write's answer and dropping the caller's own
   * input costs them nothing they did not already have. Only a value that came
   * from the pending change is refused, since that one belongs to whoever saved
   * it and a successful publish would delete it.
   *
   * A caller's value can be allowed when their payload is judged on its own and
   * denied once the pending change is folded in, because a rule reads its
   * siblings: the publish patch may carry a field that turns a rule against a
   * value the same patch supplies.
   */
  callerSupplied?: Record<string, unknown>;
  slug: string;
  /** The language being published, for the log context; `null` when there is none. */
  locale?: string | null;
}

/**
 * Throw unless every field the rules removed already holds its live value.
 *
 * Throws on the first problem so nothing is written: a publish applies the
 * whole pending change or none of it.
 */
export function assertNoDeniedChange(input: DeniedChangeInput): void {
  const denied = deniedPaths(input.before, input.permitted, "");
  if (denied.length === 0) return;

  const changes = denied.filter(
    path =>
      !pathExists(input.callerSupplied, path) &&
      !sameStoredValue(valueAt(input.before, path), valueAt(input.live, path))
  );
  if (changes.length === 0) return;

  throw NextlyError.validation({
    errors: changes.map(path => ({
      path,
      code: "FORBIDDEN",
      message:
        "The pending change edits this field and you do not have permission to write it, so it cannot be published. The change is kept.",
    })),
    logContext: {
      cause: "promote-denied-field",
      slug: input.slug,
      locale: input.locale ?? null,
      fields: changes,
    },
  });
}

/**
 * Whether two stored values are the same value, across the representations the
 * two sides arrive in.
 *
 * A pending change is JSON, so a timestamp reaches here as the ISO string it
 * was serialised to, while the live row comes back from the driver as a `Date`.
 * Compared as they are, every date-bearing field the publisher may not write
 * reads as an edit and refuses a publish that touches nothing. Measured: of
 * text, number, boolean, JSON, group and date, only the date diverged.
 */
function sameStoredValue(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(asComparable(a), asComparable(b));
}

/** A value in one representation: instants as their ISO string, at any depth. */
function asComparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(asComparable);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = asComparable(value[key]);
    return out;
  }
  return value;
}

/**
 * Whether a document carries this path at all.
 *
 * Presence, not truthiness: a caller who sent `null` to clear a field supplied
 * it, and their own input is theirs to lose.
 */
function pathExists(
  root: Record<string, unknown> | undefined,
  path: string
): boolean {
  if (!root) return false;
  let current: unknown = root;
  for (const step of path.split(/\.|\[(\d+)\]/).filter(Boolean)) {
    if (Array.isArray(current) && /^\d+$/.test(step)) {
      const next = current[Number(step)];
      if (next === undefined) return false;
      current = next;
      continue;
    }
    if (!isRecord(current)) return false;
    if (!Object.prototype.hasOwnProperty.call(current, step)) return false;
    current = current[step];
  }
  return true;
}

/**
 * Every path the rules removed, at any depth.
 *
 * A field rule can sit on a child of a group, a repeater row or a component,
 * and the removal there leaves the container in place: comparing only the top
 * level reports nothing denied and lets the forbidden nested edit through.
 */
function deniedPaths(
  before: unknown,
  after: unknown,
  prefix: string
): string[] {
  if (Array.isArray(before)) {
    if (!Array.isArray(after)) return [prefix];
    return before.flatMap((row, index) =>
      deniedPaths(row, after[index], `${prefix}[${index}]`)
    );
  }
  if (!isRecord(before)) return [];
  if (!isRecord(after)) return [prefix];
  const out: string[] = [];
  for (const key of Object.keys(before)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(after, key)) {
      out.push(path);
      continue;
    }
    out.push(...deniedPaths(before[key], after[key], path));
  }
  return out;
}

/** Read a dotted/bracketed path the way {@link deniedPaths} writes one. */
function valueAt(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const step of path.split(/\.|\[(\d+)\]/).filter(Boolean)) {
    if (Array.isArray(current) && /^\d+$/.test(step)) {
      current = current[Number(step)];
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[step];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
