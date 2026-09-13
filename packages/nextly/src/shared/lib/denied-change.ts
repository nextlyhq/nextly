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

/**
 * Every field name a schema declares, at any depth.
 *
 * Its own walk rather than `addressableFields`, which pushes a NAMED field and
 * stops: `descendInto` reaches the children of unnamed containers only, so a
 * set built from it holds the top level and nothing else, and the nested name
 * this exists to protect is exactly the one it would miss.
 *
 * Names, not paths, because the caller compares the last segment of a path: a
 * field is content wherever it is declared, and the store's own columns are
 * what the name list is for.
 */
export function declaredFieldNames(fields: unknown): Set<string> {
  const names = new Set<string>();
  const seen = new WeakSet<object>();
  const pending: unknown[] = Array.isArray(fields) ? [...fields] : [];
  while (pending.length > 0) {
    const field = pending.pop();
    if (typeof field !== "object" || field === null) continue;
    if (seen.has(field)) continue;
    seen.add(field);
    const record = field as { name?: unknown; fields?: unknown };
    if (typeof record.name === "string") names.add(record.name);
    if (Array.isArray(record.fields)) pending.push(...record.fields);
  }
  return names;
}

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

  const denied = collectDenied(input, permittedBefore, permittedLive);
  const refusals = [...denied].flatMap(path => refusedLeaves(input, path));
  if (refusals.length > 0) refuse(input, refusals);

  return restoreDenied(
    input.before,
    permittedBefore,
    input.live,
    permittedLive
  ) as Record<string, unknown>;
}

/**
 * Every path the rules deny, on the promoted document AND on the live row,
 * both kept whole.
 *
 * The live row is consulted because a rule is never asked about a key that is
 * absent, so a field the pending change removes outright is judged nowhere else.
 * An earlier revision filtered the live verdict down to the paths the promotion
 * no longer carries, and that filter made the check unsafe: a path is a
 * position, so when a pending change deletes a repeater row the row after it
 * takes its index, the protected row's path still exists, and the deletion went
 * through unjudged. Kept whole, a stale live verdict can refuse a publish the
 * final document would allow, which fails closed; filtered, it failed open and
 * lost data. Judging rows by identity rather than position is what would make
 * this precise in both directions.
 */
function collectDenied(
  input: PromotionAccessInput,
  permittedBefore: Record<string, unknown>,
  permittedLive: Record<string, unknown>
): Set<string> {
  return new Set([
    ...deniedPaths(input.before, permittedBefore, ""),
    ...deniedPaths(input.live, permittedLive, ""),
  ]);
}

/**
 * The leaves under one denied path that the pending change would change.
 *
 * Leaf by leaf, over the UNION of both sides. The rules delete a denied
 * container whole, so the removal names the container while its contents can
 * have two authors, and a property present only on the live side is one this
 * document deletes.
 */
function refusedLeaves(input: PromotionAccessInput, path: string): string[] {
  const leaves = new Set([
    ...leafPaths(valueAt(input.before, path), path),
    ...leafPaths(valueAt(input.live, path), path),
  ]);
  return [...leaves].filter(leaf => isRefusal(input, leaf));
}

/** Whether one denied leaf is a change the pending change makes. */
function isRefusal(input: PromotionAccessInput, leaf: string): boolean {
  if (isStoreBookkeeping(leaf, input.authoredFieldNames)) return false;
  if (sameStoredValue(valueAt(input.before, leaf), valueAt(input.live, leaf))) {
    return false;
  }
  // The caller's own edit is dropped back to live, not refused.
  return !pathExists(input.callerSupplied, leaf);
}

/** Refuse the promotion, naming every field at fault, in a stable order. */
function refuse(input: PromotionAccessInput, refusals: string[]): never {
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
    return restoreArray(before, permitted, live, permittedLive);
  }
  if (!isRecord(before)) return before;
  // The rules removed this whole level, so the row keeps what it has.
  if (!isRecord(permitted)) return live;
  return restoreRecord(
    before,
    permitted,
    recordOrUndefined(live),
    recordOrUndefined(permittedLive)
  );
}

function restoreArray(
  before: unknown[],
  permitted: unknown,
  live: unknown,
  permittedLive: unknown
): unknown {
  // The rules removed the whole list, so the row keeps what it has.
  if (!Array.isArray(permitted)) return live;
  return before.map((row, index) =>
    restoreDenied(
      row,
      permitted[index],
      itemAt(live, index),
      itemAt(permittedLive, index)
    )
  );
}

function restoreRecord(
  before: Record<string, unknown>,
  permitted: Record<string, unknown>,
  live: Record<string, unknown> | undefined,
  permittedLive: Record<string, unknown> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(before)) {
    if (hasOwn(permitted, key)) {
      assign(
        out,
        key,
        restoreDenied(
          before[key],
          permitted[key],
          live?.[key],
          permittedLive?.[key]
        )
      );
    } else if (live && hasOwn(live, key)) {
      // Denied: the row keeps what it has.
      assign(out, key, live[key]);
    }
  }
  keepDeniedLiveOnlyKeys(out, before, live, permittedLive);
  return out;
}

/**
 * A key the row holds that this document drops. Allowed, that is a deletion the
 * promotion is entitled to make; denied, it is one the caller may not, so the
 * value stays. Anything the pending change was deleting has already been
 * refused, so what reaches here is the caller's own.
 */
function keepDeniedLiveOnlyKeys(
  out: Record<string, unknown>,
  before: Record<string, unknown>,
  live: Record<string, unknown> | undefined,
  permittedLive: Record<string, unknown> | undefined
): void {
  if (!live) return;
  for (const key of Object.keys(live)) {
    if (hasOwn(before, key)) continue;
    if (permittedLive && hasOwn(permittedLive, key)) continue;
    assign(out, key, live[key]);
  }
}

function recordOrUndefined(
  value: unknown
): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function itemAt(value: unknown, index: number): unknown {
  return Array.isArray(value) ? value[index] : undefined;
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
