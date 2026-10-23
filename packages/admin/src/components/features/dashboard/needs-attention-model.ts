/**
 * What the Needs attention card draws, read from its slot: a state, and for a
 * ready card one row per kind with its parts.
 *
 * Kept apart from the component so the reading is tested without rendering:
 * which bucket is a kind and which a part, which links each opens, and which
 * numbers are floors.
 *
 * Every key is read through `nextly/attention-keys`, the vocabulary the server
 * writes them in, and every filtered link through `nextly/reserved-filter-keys`,
 * the keys the list reads, so neither half keeps a copy of the other.
 */

import {
  ATTENTION_DUE_WINDOW_MS,
  ATTENTION_KINDS,
  parseAttentionKey,
  type AttentionKind,
} from "nextly/attention-keys";
import {
  IN_RELEASE_KEY,
  PENDING_CHANGE_KEY,
} from "nextly/reserved-filter-keys";
import type { WidgetResult, WidgetSlot } from "nextly/widget-result";

import { buildRoute, ROUTES } from "@admin/constants/routes";

/** One collection's or Single's share of a kind. */
export interface AttentionPartRow {
  key: string;
  label: string;
  count: number;
  atLeast: boolean;
  href: string;
}

/** One kind the reader has something waiting in. */
export interface AttentionKindRow {
  kind: AttentionKind;
  label: string;
  count: number;
  atLeast: boolean;
  /** The one list that holds the whole kind, when there is one. */
  href?: string;
  /**
   * Nothing found, but some lists went unread: the kind cannot be called clear,
   * and its row says so rather than showing a number.
   */
  unchecked?: true;
  parts: AttentionPartRow[];
}

/** What the card shows. */
export type AttentionView =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "error"; message: string }
  | { state: "clear" }
  | { state: "ready"; kinds: AttentionKindRow[] };

/** Each kind's name on the card. */
const KIND_LABELS: Record<AttentionKind, string> = {
  unpublished: "Unpublished changes",
  scheduled: "Publishing this week",
  overdue: "Overdue releases",
};

/** The Releases list's overdue filter, the list the overdue count is the count of. */
const OVERDUE_RELEASES_HREF = `${ROUTES.RELEASES}?${new URLSearchParams({
  tab: "attention",
  reason: "overdue",
}).toString()}`;

/** A collection's list under one reserved condition. */
function filteredListHref(slug: string, where: Record<string, unknown>) {
  return `${buildRoute(ROUTES.COLLECTION_ENTRIES, { slug })}?${new URLSearchParams(
    { where: JSON.stringify(where) }
  ).toString()}`;
}

/**
 * Where a part's link goes: a collection's list filtered to exactly what was
 * counted, or a Single, which has no list and is opened itself.
 */
function partHref(
  kind: AttentionKind,
  part: { contentKind: "collection" | "single"; slug: string; locale?: string },
  asOf: number
): string {
  if (part.contentKind === "single") {
    // The language the change was counted in, as the editor's own `?locale=`.
    const path = buildRoute(ROUTES.SINGLE_EDIT, { slug: part.slug });
    return part.locale === undefined
      ? path
      : `${path}?${new URLSearchParams({ locale: part.locale }).toString()}`;
  }
  if (kind === "scheduled") {
    // The week the source counted over, measured from the answer's own
    // instant and the source's own window, never this browser's clock.
    return filteredListHref(part.slug, {
      [IN_RELEASE_KEY]: {
        scheduledBefore: new Date(asOf + ATTENTION_DUE_WINDOW_MS).toISOString(),
      },
    });
  }
  return filteredListHref(part.slug, { [PENDING_CHANGE_KEY]: true });
}

/** A grouped answer, the one shape this card's source gives. */
type GroupedResult = Extract<WidgetResult, { op: "groupBy" }>;

/** Each kind's own row and each kind's parts, as the buckets name them. */
interface ReadBuckets {
  rows: Map<AttentionKind, AttentionKindRow>;
  partsOf: Map<AttentionKind, AttentionPartRow[]>;
}

/** One bucket of the answer. */
type AttentionBucket = GroupedResult["buckets"][number];

/**
 * A bucket's key, when the bucket has something in it and names a kind or a
 * part this admin knows; otherwise `null`, and the bucket is left out.
 */
function keyOf(bucket: AttentionBucket): {
  value: string;
  key: NonNullable<ReturnType<typeof parseAttentionKey>>;
} | null {
  // An empty bucket is left out, except a kind's zero floor: nothing found
  // while some lists went unread, which the card must not read as clear.
  if (bucket.value === null) return null;
  if (bucket.count <= 0 && bucket.atLeast !== true) return null;
  const key = parseAttentionKey(bucket.value);
  return key === null ? null : { value: bucket.value, key };
}

/** A kind's own row, from its total's bucket. */
function kindRow(
  kind: AttentionKind,
  bucket: AttentionBucket
): AttentionKindRow {
  return {
    kind,
    label: KIND_LABELS[kind],
    count: bucket.count,
    atLeast: bucket.atLeast === true,
    ...(kind === "overdue" ? { href: OVERDUE_RELEASES_HREF } : {}),
    ...(bucket.count === 0 && bucket.atLeast === true
      ? { unchecked: true as const }
      : {}),
    parts: [],
  };
}

/**
 * Sorts the answer's buckets into kinds and parts by their keys. A bucket with
 * nothing in it, or with a key this admin does not know, is left out.
 */
function readBuckets(result: GroupedResult, now: number): ReadBuckets {
  // The instant the answer was computed at; this page's clock only for an
  // answer that does not say.
  const asOf = result.asOf === undefined ? now : Date.parse(result.asOf);
  const labels = new Map(
    (result.field?.choices ?? []).map(choice => [choice.value, choice.label])
  );
  const read: ReadBuckets = { rows: new Map(), partsOf: new Map() };
  for (const bucket of result.buckets) {
    const keyed = keyOf(bucket);
    if (keyed === null) continue;
    const { value, key } = keyed;
    if (!("part" in key)) {
      read.rows.set(key.kind, kindRow(key.kind, bucket));
      continue;
    }
    const parts = read.partsOf.get(key.kind) ?? [];
    parts.push({
      key: value,
      label: labels.get(value) ?? key.part.slug,
      count: bucket.count,
      atLeast: bucket.atLeast === true,
      href: partHref(key.kind, key.part, asOf),
    });
    read.partsOf.set(key.kind, parts);
  }
  return read;
}

/** The kinds with something waiting, in the order the card lists them. */
function kindRows({ rows, partsOf }: ReadBuckets): AttentionKindRow[] {
  return ATTENTION_KINDS.flatMap(kind => {
    const row = rows.get(kind);
    if (row === undefined) return [];
    const parts = partsOf.get(kind) ?? [];
    // A kind held in one list links to that list; one spread over several has
    // no one list, and its parts carry the links.
    const only = parts.length === 1 ? parts[0] : undefined;
    return [
      {
        ...row,
        ...(row.href === undefined && only !== undefined
          ? { href: only.href }
          : {}),
        parts,
      },
    ];
  });
}

/**
 * The card's view of its slot. `now` stands in for the answer's own instant
 * only when the answer carries none.
 */
export function attentionView(
  slot: WidgetSlot | undefined,
  now: number
): AttentionView {
  if (slot === undefined) return { state: "loading" };
  if (!slot.ok) {
    return slot.code === "unavailable"
      ? { state: "unavailable" }
      : { state: "error", message: slot.error };
  }
  if (slot.result.op !== "groupBy") {
    return {
      state: "error",
      message: "This card received an unexpected answer.",
    };
  }
  const kinds = kindRows(readBuckets(slot.result, now));
  return kinds.length === 0 ? { state: "clear" } : { state: "ready", kinds };
}

/** Everything waiting, across kinds, and whether that total is a floor. */
export function attentionTotal(kinds: readonly AttentionKindRow[]): {
  count: number;
  atLeast: boolean;
} {
  return {
    count: kinds.reduce((sum, kind) => sum + kind.count, 0),
    atLeast: kinds.some(kind => kind.atLeast),
  };
}
