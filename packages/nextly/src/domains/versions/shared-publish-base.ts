/**
 * The base of a pending change: the version it began from, as far as the
 * fields every language shares are concerned.
 *
 * A language's pending change holds a whole copy of the document, shared
 * fields included, and publishing it writes those shared values onto the live
 * row. When another language published a newer shared value after the change
 * began, that write would put the older value back. So each pending change
 * records its base, and a shared field whose live value has moved off the
 * base is out of date: the publish is refused, naming it, and nothing is
 * merged on the editor's behalf. Taking the live values brings the change up
 * to date and moves its base.
 *
 * The base is a version, held as a version pin, so retention never removes
 * the copy the comparison reads. It is the newest version whose shared values
 * equal the live row's, not merely the newest published one: a language that
 * is not published yet saves in place, which changes the live shared values
 * with no publish, and the version that save recorded is then the one that
 * matches. A pending change with no base (saved before bases were recorded,
 * or begun when no version matched) compares its own shared values with live
 * instead, which errs towards naming a field rather than reverting one.
 *
 * @module domains/versions/shared-publish-base
 * @experimental
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { NextlyError, type SharedFieldsConflictPublicData } from "../../errors";
import {
  applyFieldReadAccess,
  type CallerGrants,
} from "../../shared/lib/field-level-registry";

import { canonicalJson, storeDraftSave } from "./draft-save";
import type { VersionCaptureService } from "./version-capture-service";
import { registerVersionPinHolder, versionPins } from "./version-pins";
import type { VersionRef } from "./versions-repository";

const VERSIONS_TABLE = "nextly_versions";

/** How far back the base is looked for: the versions retention most often keeps. */
const BASE_SEARCH_DEPTH = 25;

const baseHolder = registerVersionPinHolder({
  name: "shared-publish-base",
  label: "Pending changes",
});

/** The slot a pending change's base is pinned under: one per language. */
function slotOf(locale: string | null): string {
  return `pending:${locale ?? ""}`;
}

/**
 * A stored value in one comparable form: a date as its ISO string, as a
 * snapshot stores it, object keys in one order, and a component row's own
 * timestamps, which a publish rewrites, left out, as a save's no-op check
 * leaves them out.
 */
function comparable(value: unknown): string {
  return canonicalJson(value ?? null);
}

/**
 * One side of a pair, parsed where the other side holds the same container
 * parsed: a JSON field one reader returns as text and another as its value.
 * Two texts stay texts, so a text field whose words happen to look like JSON
 * is compared character by character.
 */
function alignedWith(value: unknown, other: unknown): unknown {
  if (typeof value !== "string" || other === null) return value;
  if (typeof other !== "object") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** Whether two stored values of one shared field are the same value. */
export function sameSharedValue(a: unknown, b: unknown): boolean {
  return comparable(alignedWith(a, b)) === comparable(alignedWith(b, a));
}

/**
 * The fields every language of a localized document shares: those its
 * translations table does not hold, narrowed to the keys the document
 * carries, so a value kept in tables of its own is compared only where the
 * document holds it.
 */
export function sharedFieldNames(
  fields: ReadonlyArray<{ name?: string }>,
  localized: ReadonlySet<string>,
  document: Record<string, unknown>
): string[] {
  return fields.flatMap(field =>
    typeof field.name === "string" &&
    !localized.has(field.name) &&
    field.name in document
      ? [field.name]
      : []
  );
}

/**
 * How a shared field is compared where not as its whole value: a junction's
 * ids as a set, since a junction keeps no order; a translated component as
 * its shared sub-fields only, since its other values belong to a language.
 */
export type SharedViews = ReadonlyMap<string, (value: unknown) => unknown>;

/** The shared fields whose values differ between two copies of a document. */
export function differingFields(
  shared: readonly string[],
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  views?: SharedViews
): string[] {
  return shared.filter(name => {
    const view = views?.get(name);
    return view
      ? !sameSharedValue(view(a[name]), view(b[name]))
      : !sameSharedValue(a[name], b[name]);
  });
}

/** A stored snapshot as a record, whether the driver parsed its JSON or not. */
export function snapshotRecord(value: unknown): Record<string, unknown> {
  const parsed: unknown =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
}

/**
 * A document's newest durable versions, snapshots read, newest first: of one
 * language (null for none) when one is named, else of every part.
 */
async function recentVersions(
  tx: TransactionContext,
  ref: VersionRef,
  locale?: string | null
): Promise<Array<{ versionNo: number; values: Record<string, unknown> }>> {
  const rows = await tx.select<{ versionNo: number; snapshot: unknown }>(
    VERSIONS_TABLE,
    {
      columns: ["versionNo", "snapshot"],
      where: {
        and: [
          { column: "scopeKind", op: "=", value: ref.scopeKind },
          { column: "scopeSlug", op: "=", value: ref.scopeSlug },
          { column: "entryId", op: "=", value: ref.entryId },
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "IS NOT NULL" },
          ...(locale === undefined
            ? []
            : [
                locale === null
                  ? { column: "locale", op: "IS NULL" as const }
                  : { column: "locale", op: "=" as const, value: locale },
              ]),
        ],
      },
      orderBy: [{ column: "versionNo", direction: "desc" }],
      limit: BASE_SEARCH_DEPTH,
    }
  );
  return rows.map(row => ({
    versionNo: row.versionNo,
    values: snapshotRecord(row.snapshot),
  }));
}

/**
 * Pin a pending change's base: the newest version whose shared values equal
 * the live document's. With none (versions captured before this document's
 * shared values last changed, or pruned), any pin the slot held is released,
 * so the change is judged as one without a base rather than against a stale
 * one.
 *
 * @param live The live document, shaped as a version snapshot is.
 */
export async function recordSharedBase(
  tx: TransactionContext,
  args: {
    ref: VersionRef;
    locale: string | null;
    shared: readonly string[];
    live: Record<string, unknown>;
    views?: SharedViews;
  }
): Promise<void> {
  const { ref, locale, shared, live, views } = args;
  const recent = await recentVersions(tx, ref);
  const match = recent.find(
    row => differingFields(shared, row.values, live, views).length === 0
  );
  const slot = slotOf(locale);
  if (match) {
    await baseHolder.pin(tx, { ref, slot, versionNo: match.versionNo });
  } else {
    await baseHolder.release(tx, { ref, slot });
  }
}

/** Who asks, for the field read rules that decide which names they see. */
export interface FieldNameReader {
  kind: "collection" | "single";
  slug: string;
  user?: Record<string, unknown>;
  overrideAccess?: boolean;
  authenticatedScope?: AuthenticatedScope;
  /** Resolved before any transaction this runs in: they take a pooled connection. */
  grants?: () => Promise<CallerGrants>;
}

/**
 * Of these field names, the ones the caller may read, and how many others: a
 * field the caller may not read is counted, never named, so an answer never
 * reveals that a protected field exists.
 *
 * @param document The document the read rules are shown.
 */
export async function readableFieldNames(
  reader: FieldNameReader,
  names: readonly string[],
  document: Record<string, unknown>
): Promise<{ named: string[]; hidden: number }> {
  // A whole copy: the read rules remove nested values too, and a shallow copy
  // would remove them from the caller's document, which it may write or judge
  // again.
  const readable = structuredClone(document);
  await applyFieldReadAccess({
    kind: reader.kind,
    slug: reader.slug,
    entry: readable,
    user: reader.user,
    authenticatedScope: reader.authenticatedScope,
    overrideAccess: reader.overrideAccess,
    grants: reader.grants,
  });
  const named = names.filter(name => name in readable);
  return { named, hidden: names.length - named.length };
}

const CONFLICT_MESSAGES: Record<
  SharedFieldsConflictPublicData["reason"],
  string
> = {
  "shared-fields-out-of-date":
    "Shared values were published by someone else after this change began. Take the live values for them, then publish.",
  "shared-edits-unordered":
    "Two languages changed these shared fields and the order can't be confirmed. Publish one language at a time.",
  "shared-edits-unmergeable":
    "More than one language is publishing these components, and their shared values can't be combined safely. Publish one language at a time.",
};

/**
 * The refusal of a publish over shared fields: a conflict saying why, naming
 * each field the caller may read, and counting the others. Out of date unless
 * another reason is given.
 *
 * @param live The live document the fields were judged against, which the
 *   field read rules are shown.
 */
export async function sharedValuesConflict(
  args: FieldNameReader & {
    entryId: string;
    fields: readonly string[];
    live: Record<string, unknown>;
    reason?: SharedFieldsConflictPublicData["reason"];
  }
): Promise<NextlyError> {
  const reason = args.reason ?? "shared-fields-out-of-date";
  const { named, hidden } = await readableFieldNames(
    args,
    args.fields,
    args.live
  );
  return NextlyError.conflict({
    reason: "state",
    message: CONFLICT_MESSAGES[reason],
    data: {
      reason,
      fields: named,
      ...(hidden > 0 ? { hiddenCount: hidden } : {}),
    },
    logContext: {
      reason,
      kind: args.kind,
      slug: args.slug,
      entryId: args.entryId,
      fields: args.fields,
    },
  });
}

/** Free every language's base on a document, once all its changes are published. */
export async function releaseAllSharedBases(
  tx: TransactionContext,
  ref: VersionRef
): Promise<void> {
  await baseHolder.releaseAll(tx, ref);
}

/** Free a pending change's base, once the change is published or discarded. */
export async function releaseSharedBase(
  tx: TransactionContext,
  ref: VersionRef,
  locale: string | null
): Promise<void> {
  await baseHolder.release(tx, { ref, slot: slotOf(locale) });
}

/**
 * The shared fields a pending change may not publish: those whose live value
 * has moved off the change's base, where the change does not already hold the
 * live value. A change with no base compares its own values with live
 * instead.
 *
 * @param live The live document, shaped as a version snapshot is.
 * @param pending The pending change's snapshot.
 */
export async function outOfDateSharedFields(
  tx: TransactionContext,
  args: {
    ref: VersionRef;
    locale: string | null;
    shared: readonly string[];
    live: Record<string, unknown>;
    pending: Record<string, unknown>;
    views?: SharedViews;
  }
): Promise<string[]> {
  const { ref, locale, live, pending, views } = args;
  // Only the fields the change holds: a snapshot without a field writes
  // nothing to it.
  const held = args.shared.filter(name => name in pending);
  // Where the change already holds the live value, publishing it puts back
  // nothing, whatever the base says: a field whose live value was taken stays
  // current though the base stays put for another left behind.
  const changed = differingFields(held, pending, live, views);
  const base = await baseSnapshotOf(tx, ref, locale);
  if (!base) return changed;
  const moved = new Set(differingFields(held, base, live, views));
  return changed.filter(name => moved.has(name));
}

/** The snapshot a pending change's base pins, or null when it has none. */
async function baseSnapshotOf(
  tx: TransactionContext,
  ref: VersionRef,
  locale: string | null
): Promise<Record<string, unknown> | null> {
  const slot = slotOf(locale);
  const pin = (await versionPins.list(tx, ref)).find(
    p => p.holder === "shared-publish-base" && p.slot === slot
  );
  if (!pin) return null;
  const base = await tx.select<{ snapshot: unknown }>(VERSIONS_TABLE, {
    columns: ["snapshot"],
    where: {
      and: [
        { column: "scopeKind", op: "=", value: ref.scopeKind },
        { column: "scopeSlug", op: "=", value: ref.scopeSlug },
        { column: "entryId", op: "=", value: ref.entryId },
        { column: "isAutosave", op: "=", value: false },
        { column: "versionNo", op: "=", value: pin.versionNo },
      ],
    },
    limit: 1,
  });
  return snapshotRecord(base[0]?.snapshot);
}

/**
 * The shared fields a pending change itself edited: those whose value in it
 * differs from its base. A change with no base edited none it may publish,
 * since one that differs from live is refused.
 */
export async function editedSharedFields(
  tx: TransactionContext,
  args: {
    ref: VersionRef;
    locale: string | null;
    shared: readonly string[];
    pending: Record<string, unknown>;
    views?: SharedViews;
  }
): Promise<string[]> {
  const base = await baseSnapshotOf(tx, args.ref, args.locale);
  if (!base) return [];
  return differingFields(
    args.shared.filter(name => name in args.pending),
    args.pending,
    base,
    args.views
  );
}

/**
 * When a language last edited one shared field, as far as the document's
 * history can show: after version `after` and no later than version `by`.
 * The edit is the version from which the language's history has held the
 * pending change's value, so a later save of other fields leaves it where it
 * was. That version is certain (`after` is `by - 1`) only when no version
 * before it, back to the one that held another value, is missing: retention
 * may have removed the language's real edit and left a later save that only
 * kept the value. A value no kept version holds has no `by` at all
 * (`Infinity`): the version that recorded it is gone.
 */
export interface SharedEditTime {
  after: number;
  by: number;
}

/** Version numbers of a document's durable versions within `(from, to)`. */
async function versionNumbersBetween(
  tx: TransactionContext,
  ref: VersionRef,
  from: number,
  to: number
): Promise<Set<number>> {
  if (to - from <= 1) return new Set();
  const rows = await tx.select<{ versionNo: number }>(VERSIONS_TABLE, {
    columns: ["versionNo"],
    where: {
      and: [
        { column: "scopeKind", op: "=", value: ref.scopeKind },
        { column: "scopeSlug", op: "=", value: ref.scopeSlug },
        { column: "entryId", op: "=", value: ref.entryId },
        { column: "isAutosave", op: "=", value: false },
        { column: "versionNo", op: ">", value: from },
        { column: "versionNo", op: "<", value: to },
      ],
    },
  });
  return new Set(rows.map(row => row.versionNo));
}

/**
 * {@link SharedEditTime} of each of these shared fields in a language's
 * pending change. Version numbers run in one sequence per document, so a
 * number missing between two of the language's versions is a version
 * retention removed.
 */
export async function sharedEditOrder(
  tx: TransactionContext,
  args: {
    ref: VersionRef;
    locale: string | null;
    fields: readonly string[];
    pending: Record<string, unknown>;
  }
): Promise<Map<string, SharedEditTime>> {
  const { ref, locale, fields, pending } = args;
  const order = new Map<string, SharedEditTime>();
  if (fields.length === 0) return order;
  const snapshots = await recentVersions(tx, ref, locale);
  // Fewer versions than were asked for: the language's whole history.
  const wholeHistory = snapshots.length < BASE_SEARCH_DEPTH;
  const spans = fields.map(name => {
    let by = Number.POSITIVE_INFINITY;
    let before: number | null = wholeHistory ? 0 : null;
    for (const row of snapshots) {
      if (!sameSharedValue(row.values[name], pending[name])) {
        before = row.versionNo;
        break;
      }
      by = row.versionNo;
    }
    return { name, before, by };
  });
  const known = spans.flatMap(span =>
    span.before === null ? [] : [span.before]
  );
  const present =
    known.length === 0
      ? new Set<number>()
      : await versionNumbersBetween(
          tx,
          ref,
          Math.min(...known),
          Math.max(...spans.map(span => span.by).filter(Number.isFinite), 0)
        );
  for (const { name, before, by } of spans) {
    order.set(name, editTime(before, by, present));
  }
  return order;
}

/** The edit's time from the version that held another value, when known. */
function editTime(
  before: number | null,
  by: number,
  present: ReadonlySet<number>
): SharedEditTime {
  if (before === null || !Number.isFinite(by))
    return { after: before ?? 0, by };
  for (let no = before + 1; no < by; no += 1) {
    if (!present.has(no)) return { after: before, by };
  }
  return { after: by - 1, by };
}

/**
 * Of these fields, those the caller may write whole. The write rules are run
 * on a copy of the pending change as taking them would leave it, their live
 * values over its own, and a field passes only when the rules left it as it
 * was: one with a nested field the caller may not write is not taken, since
 * taking it would write that nested value over the change's.
 *
 * The whole change, not the fields alone, because a rule may read a sibling:
 * shown only the fields taken, a rule asking about another field sees it
 * missing and answers for a document that will never exist.
 *
 * @param pending The pending change the fields would be taken into.
 * @param applyWriteRules The caller's field write rules, which remove what
 *   they refuse from the data they are handed, at any depth.
 */
export async function wholeWritableFields(
  names: readonly string[],
  live: Record<string, unknown>,
  pending: Record<string, unknown>,
  applyWriteRules: (data: Record<string, unknown>) => Promise<void>
): Promise<string[]> {
  const data = structuredClone({
    ...pending,
    ...Object.fromEntries(names.map(name => [name, live[name]])),
  });
  await applyWriteRules(data);
  return names.filter(
    name => name in data && sameSharedValue(data[name], live[name])
  );
}

/**
 * Bring a pending change up to date: write the live value of each out-of-date
 * shared field the caller may write into it, saved as any other save of the
 * change is, so history shows it and a restore can undo it. The change's base
 * moves to the version those live values are in only when every out-of-date
 * field was taken: moving it past one left behind would make that field's old
 * value look current, and the next publish would put it back.
 *
 * Returns the fields taken, those left out of date, and the version the save
 * recorded (none when nothing changed).
 *
 * @param live The live document, shaped as a version snapshot is.
 * @param mayTake The out-of-date fields the caller may write, judged on the
 *   pending change it is handed; all of them when omitted, for a trusted
 *   caller.
 */
export async function takeLiveSharedValuesInto(
  tx: TransactionContext,
  capture: VersionCaptureService,
  args: {
    ref: VersionRef;
    locale: string | null;
    shared: readonly string[];
    live: Record<string, unknown>;
    pending: Record<string, unknown>;
    createdBy: string | null;
    maxPerDoc?: number | false;
    mayTake?: (
      stale: string[],
      pending: Record<string, unknown>
    ) => Promise<string[]>;
    views?: SharedViews;
  }
): Promise<{ taken: string[]; remaining: string[]; versionNo: number | null }> {
  const { ref, locale, shared, live, pending, createdBy, views } = args;
  const stale = await outOfDateSharedFields(tx, {
    ref,
    locale,
    shared,
    live,
    pending,
    views,
  });
  const allowed = args.mayTake
    ? new Set(await args.mayTake(stale, pending))
    : null;
  const taken = allowed ? stale.filter(name => allowed.has(name)) : stale;
  const remaining = stale.filter(name => !taken.includes(name));
  // Recorded before the save, so the save's retention pass already keeps it.
  if (remaining.length === 0) {
    await recordSharedBase(tx, { ref, locale, shared, live, views });
  }
  const { versionNo } = await storeDraftSave(tx, capture, {
    ref,
    locale,
    snapshot: {
      ...pending,
      ...Object.fromEntries(taken.map(name => [name, live[name]])),
    },
    replaces: pending,
    createdBy,
    maxPerDoc: args.maxPerDoc,
  });
  return { taken, remaining, versionNo };
}

/**
 * What taking the live values did, as the caller may see it: the fields
 * taken, and those still out of date because the caller may not write them,
 * each named where the caller may read it and counted otherwise.
 *
 * @experimental
 */
export interface TakenLiveValues {
  taken: string[];
  hiddenTaken?: number;
  outOfDate: string[];
  hiddenOutOfDate?: number;
  /**
   * Out-of-date fields no take copies: a translated component's shared
   * sub-fields, whose instances it cannot match to the change's safely.
   */
  copyByHand?: { fields: string[]; reason: string };
}

/** Why a translated component's shared sub-fields are left to the editor. */
const COPY_BY_HAND_REASON =
  "This field is inside a translated component; copy its shared values by hand, then publish.";

/** {@link TakenLiveValues} for this caller. */
export async function takenLiveValues(
  reader: FieldNameReader,
  took: {
    taken: string[];
    remaining: string[];
    live: Record<string, unknown>;
    /** Fields no take copies; see {@link TakenLiveValues.copyByHand}. */
    byHand?: ReadonlySet<string>;
  }
): Promise<TakenLiveValues> {
  // One verdict for both lists, so a field is never judged against a
  // document the other judgement changed.
  const { named } = await readableFieldNames(
    reader,
    [...took.taken, ...took.remaining],
    took.live
  );
  const readable = new Set(named);
  const taken = took.taken.filter(name => readable.has(name));
  const left = took.remaining.filter(name => readable.has(name));
  const hiddenTaken = took.taken.length - taken.length;
  const hiddenLeft = took.remaining.length - left.length;
  const byHand = left.filter(name => took.byHand?.has(name));
  return {
    taken,
    ...(hiddenTaken > 0 ? { hiddenTaken } : {}),
    outOfDate: left,
    ...(hiddenLeft > 0 ? { hiddenOutOfDate: hiddenLeft } : {}),
    ...(byHand.length > 0
      ? { copyByHand: { fields: byHand, reason: COPY_BY_HAND_REASON } }
      : {}),
  };
}
