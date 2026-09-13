/**
 * Deciding what a promotion may write, and refusing it when it may not.
 *
 * Shared by every path that folds held content into a live row: a Single's
 * ordinary publish, `publishAllLocales`, and a collection's publish. They
 * assemble the document they are about to write in their own ways, because a
 * Single's is a snapshot over the live row and a collection's also carries
 * components and many-to-many rows, but what they ask of it afterwards is one
 * question and deserves one answer.
 *
 * ONE function answers it AND returns the document to write, rather than a
 * caller applying the rules and interpreting the result for itself. Splitting
 * those apart is what went wrong in an earlier revision: the rules DELETE a
 * denied value, the refusal was judged from that deletion, and the same
 * stripped document was then handed to the write, so a protected value nobody
 * had touched was cleared by an unrelated publish.
 *
 * A denied field keeps its LIVE value. That is what an update means, the caller
 * may not write the field so the field does not change, and it is the answer
 * Payload gives to the same question. Removing it instead writes an absence
 * nobody asked for.
 *
 * A refusal is reserved for a change the PENDING CHANGE makes. A denied value
 * the caller sent with the publish is their own input, and dropping it back to
 * live costs them nothing they did not already have, exactly as on an ordinary
 * write. A denied value the pending change carries belongs to whoever saved it,
 * and a successful publish CONSUMES that change: dropping that one would
 * publish everything else, delete the draft, and destroy their edit while
 * reporting success.
 *
 * @module shared/lib/denied-change
 */

import { isDeepStrictEqual } from "node:util";

import { NextlyError } from "../../errors";

import { detachData } from "./detach";

/** What deciding one promotion needs from the service performing it. */
export interface PromotionAccessInput {
  /** The document the write would persist, before any rule has run. */
  before: Record<string, unknown>;
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
   * A caller's value can be allowed when their payload is judged on its own and
   * denied once the pending change is folded in, because a rule reads its
   * siblings: the publish patch may carry a field that turns a rule against a
   * value the same patch supplies.
   */
  callerSupplied?: Record<string, unknown>;
  /**
   * Applies the field rules to the document it is given, in place, removing
   * what this caller may not write.
   *
   * A closure rather than the pass itself, because the two callers name
   * different entities and this module has no business knowing which.
   */
  applyRules: (document: Record<string, unknown>) => Promise<void>;
  /**
   * Every field name the schema declares, at any depth.
   *
   * The store's own columns share names with plausible content, so a name is
   * not enough to tell them apart: a collection that declares a field called
   * `id` or `updatedAt` inside a group means it. Given this, the schema
   * decides and the name list is consulted only for a name the schema does not
   * claim. Omitted, the name list decides alone, which is right for a caller
   * that has no schema to hand.
   */
  authoredFieldNames?: ReadonlySet<string>;
  slug: string;
  /** The language being published, for the log context; `null` when there is none. */
  locale?: string | null;
}

/**
 * The document this promotion may write, or a refusal.
 *
 * Throws on the first problem so nothing is written: a publish applies the
 * whole pending change or none of it.
 */
export async function resolvePromotedDocument(
  input: PromotionAccessInput
): Promise<Record<string, unknown>> {
  // Deep copies, because the rules delete in place and a shallow one shares
  // every nested group, repeater row and component with the original: the
  // deletion would land on both and leave nothing to compare against.
  const permittedBefore = detachData(input.before);
  await input.applyRules(permittedBefore);

  // The rules are asked of LIVE as well, and not for symmetry's sake. A rule is
  // only ever asked about a key that is PRESENT, so a field the pending change
  // DELETED is judged nowhere: it is absent from the promoted document and
  // therefore never in its denied set. Judging live is what puts it there.
  const permittedLive = detachData(input.live);
  await input.applyRules(permittedLive);

  // The promoted document's own verdict, plus — from the live row — ONLY the
  // fields the promotion no longer carries.
  //
  // Live is consulted for one reason: a rule is never asked about a key that is
  // absent, so a field the pending change removes outright is judged nowhere.
  // Taking live's verdict for a field the promotion still holds would import a
  // stale answer instead, because a rule reads its siblings: where live says
  // `kind: "private"` denies `guarded`, and the pending change sets `kind` to
  // `public` and edits `guarded` legitimately, the promoted document is the one
  // that has the right of it.
  const denied = new Set(deniedPaths(input.before, permittedBefore, ""));
  for (const path of deniedPaths(input.live, permittedLive, "")) {
    if (!pathExists(input.before, path)) denied.add(path);
  }

  const refusals: string[] = [];
  for (const path of denied) {
    // Leaf by leaf, over the UNION of both sides. The rules delete a denied
    // container whole, so the removal names the container while its contents
    // can have two authors, and a property present only on the live side is one
    // this document deletes.
    const leaves = new Set([
      ...leafPaths(valueAt(input.before, path), path),
      ...leafPaths(valueAt(input.live, path), path),
    ]);
    for (const leaf of leaves) {
      if (isStoreBookkeeping(leaf, input.authoredFieldNames)) continue;
      if (
        sameStoredValue(valueAt(input.before, leaf), valueAt(input.live, leaf))
      ) {
        continue;
      }
      // The caller's own edit is dropped back to live below, not refused.
      if (pathExists(input.callerSupplied, leaf)) continue;
      refusals.push(leaf);
    }
  }

  if (refusals.length > 0) {
    const fields = [...new Set(refusals)].sort();
    throw NextlyError.validation({
      errors: fields.map(path => ({
        path,
        code: "FORBIDDEN",
        message:
          "The pending change edits this field and you do not have permission to write it, so it cannot be published. The change is kept.",
      })),
      logContext: {
        cause: "promote-denied-field",
        slug: input.slug,
        locale: input.locale ?? null,
        fields,
      },
    });
  }

  return restoreDenied(
    input.before,
    permittedBefore,
    input.live,
    permittedLive
  ) as Record<string, unknown>;
}

/**
 * The document to write: everything allowed as the promotion intends it, and
 * everything denied exactly as the row already holds it.
 *
 * Rebuilt by walking the four in step rather than by patching paths into a
 * copy, so each container is reassembled from its own children and no path has
 * to be parsed back into a position it names.
 */
function restoreDenied(
  before: unknown,
  permitted: unknown,
  live: unknown,
  permittedLive: unknown
): unknown {
  if (Array.isArray(before)) {
    if (!Array.isArray(permitted)) return live;
    return before.map((row, index) =>
      restoreDenied(
        row,
        permitted[index],
        Array.isArray(live) ? live[index] : undefined,
        Array.isArray(permittedLive) ? permittedLive[index] : undefined
      )
    );
  }
  if (!isRecord(before)) return before;
  // The rules removed this whole level, so the row keeps what it has.
  if (!isRecord(permitted)) return live;

  const liveRecord = isRecord(live) ? live : undefined;
  const permittedLiveRecord = isRecord(permittedLive)
    ? permittedLive
    : undefined;
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(before)) {
    if (!hasOwn(permitted, key)) {
      if (liveRecord && hasOwn(liveRecord, key)) {
        assign(out, key, liveRecord[key]);
      }
      continue;
    }
    assign(
      out,
      key,
      restoreDenied(
        before[key],
        permitted[key],
        liveRecord?.[key],
        permittedLiveRecord?.[key]
      )
    );
  }

  // A key the row holds that this document drops. Allowed, that is a deletion
  // the promotion is entitled to make; denied, it is one the caller may not,
  // so the value stays. Anything the pending change was deleting has already
  // been refused above, so what reaches here is the caller's own.
  if (liveRecord) {
    for (const key of Object.keys(liveRecord)) {
      if (hasOwn(before, key)) continue;
      if (permittedLiveRecord && hasOwn(permittedLiveRecord, key)) continue;
      assign(out, key, liveRecord[key]);
    }
  }

  return out;
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
    if (!hasOwn(after, key)) {
      out.push(path);
      continue;
    }
    out.push(...deniedPaths(before[key], after[key], path));
  }
  return out;
}

/**
 * Columns the store keeps for itself, which no field rule governs and which
 * differ between a pending change and the row by construction: the snapshot was
 * taken at a different moment, so its timestamps were always going to disagree.
 *
 * They matter here because a denied CONTAINER is enumerated to its leaves, and
 * a component or repeater row carries its own identity and timestamps
 * alongside the author's values. Counted as content, a denied component would
 * refuse every publish, since `updated_at` never matches.
 *
 * Matched on the last segment, so a row at any depth is covered, and in both
 * spellings because a snapshot travels through a case conversion that the live
 * row does not.
 */
const STORE_BOOKKEEPING: ReadonlySet<string> = new Set([
  "id",
  "createdAt",
  "created_at",
  "updatedAt",
  "updated_at",
  "firstPublishedAt",
  "first_published_at",
  "_status",
  "_locale",
]);

function isStoreBookkeeping(
  path: string,
  authored: ReadonlySet<string> | undefined
): boolean {
  const segments = path.split(/\.|\[\d+\]/).filter(Boolean);
  const last = segments[segments.length - 1];
  if (last === undefined || !STORE_BOOKKEEPING.has(last)) return false;
  // The schema has the final word. A field the config declares is content
  // whatever it is called, and skipping it would let an edit to it be
  // published by someone the rules deny.
  return !authored?.has(last);
}

/**
 * Every value-bearing path under one path, so each is judged on its own
 * provenance. A scalar is its own leaf, and so is an empty container, which
 * still carries the fact that it is empty.
 */
function leafPaths(value: unknown, prefix: string): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [prefix];
    return value.flatMap((row, index) => leafPaths(row, `${prefix}[${index}]`));
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return [prefix];
    return keys.flatMap(key =>
      leafPaths(value[key], prefix ? `${prefix}.${key}` : key)
    );
  }
  return [prefix];
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
    for (const key of Object.keys(value)) {
      assign(out, key, asComparable(value[key]));
    }
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
    if (!hasOwn(current, step)) return false;
    current = current[step];
  }
  return true;
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

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * A PLAIN record, and the distinction is load-bearing.
 *
 * A `Date` is an object with no enumerable keys of its own, so a walk that
 * treats every object as a container rebuilds one as `{}` and the driver then
 * refuses it: measured, a caller who supplied a date with the publish got
 * `value.getTime is not a function` and no publish at all. The same is true of
 * anything else the store round-trips as a value rather than a shape, a
 * `Buffer` or a `RegExp` among them. Only an object made from `{}` or from a
 * null prototype carries children worth descending into.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/**
 * Assign a key that may be `__proto__`.
 *
 * A plain `out[key] = value` for an own `"__proto__"` key calls the inherited
 * prototype setter instead of creating a property: the authored key is lost
 * from the JSON that gets stored, and the object it names becomes the
 * accumulator's prototype. `canonical-json.ts` documents the same hazard.
 */
function assign(
  out: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  Object.defineProperty(out, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
