/**
 * The vocabulary of Needs attention's answer: the kinds it counts and the keys
 * its grouped result names them by.
 *
 * Its own module, importing nothing, because two readers need the one list:
 * the `system:attention` source that writes the keys and the admin's card that
 * reads them to draw and link each row. A copy in the admin would agree on the
 * day it was written, and a kind added here and not there would come back as a
 * row the card cannot place.
 *
 * Exported as `nextly/attention-keys` so a browser bundle reaches the list
 * without the reads that produce it.
 *
 * A key is the kind alone for the kind's total, and
 * `<kind>:<contentKind>:<slug>` for one collection's or Single's share of it.
 * A slug cannot hold `:`, so a key parses one way.
 *
 * @module domains/widgets/attention-keys
 * @experimental The kinds may change until plugin attention items join them.
 */

/**
 * What Needs attention counts, in the order it shows them: entries with
 * unpublished changes, entries a release will publish within a week, and
 * overdue releases.
 *
 * @experimental
 */
export const ATTENTION_KINDS = ["unpublished", "scheduled", "overdue"] as const;

/** @experimental */
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/**
 * How far ahead "due soon" looks: a week, what someone can act on this week.
 * One number for the source that counts the scheduled entries and the card
 * that links to them, measured from the answer's own `asOf`.
 */
export const ATTENTION_DUE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Where one part of a kind lives: a collection's list, or a Single. @experimental */
export type AttentionContentKind = "collection" | "single";

/** A key, read back. @experimental */
export type AttentionKey =
  | { kind: AttentionKind }
  | {
      kind: AttentionKind;
      part: {
        contentKind: AttentionContentKind;
        slug: string;
        /** For a Single, the language its pending change was counted in. */
        locale?: string;
      };
    };

/** Whether `value` is one of the kinds. @experimental */
export function isAttentionKind(value: string): value is AttentionKind {
  return (ATTENTION_KINDS as readonly string[]).includes(value);
}

/**
 * The key of one collection's or Single's share of a kind.
 *
 * @experimental
 */
export function attentionPartKey(
  kind: AttentionKind,
  contentKind: AttentionContentKind,
  slug: string,
  locale?: string
): string {
  // A Single's language follows its slug, so its link opens the language that
  // was counted; a collection's part needs none.
  const base = `${kind}:${contentKind}:${slug}`;
  return contentKind === "single" && locale ? `${base}:${locale}` : base;
}

/**
 * A key read back into its kind and, for a part, where the part lives; `null`
 * for anything that is not a key this vocabulary writes.
 *
 * @experimental
 */
export function parseAttentionKey(value: string): AttentionKey | null {
  const [kind, contentKind, slug, locale, ...rest] = value.split(":");
  if (kind === undefined || !isAttentionKind(kind)) return null;
  if (contentKind === undefined) return { kind };
  if (
    (contentKind !== "collection" && contentKind !== "single") ||
    slug === undefined ||
    slug === "" ||
    rest.length > 0 ||
    // A language belongs to a Single's part alone, and is never empty.
    (locale !== undefined && (contentKind !== "single" || locale === ""))
  ) {
    return null;
  }
  return {
    kind,
    part: { contentKind, slug, ...(locale !== undefined ? { locale } : {}) },
  };
}

/** One bucket of Needs attention's grouped answer, as far as its total reads it. */
export interface AttentionTotalBucket {
  readonly value: string | null;
  readonly count: number;
  readonly atLeast?: boolean;
}

/**
 * Everything waiting in a grouped answer, and whether that total is a floor:
 * the sum of each kind's own bucket, never its parts, which break the kind
 * down rather than add to it. A bucket this vocabulary does not name, or one
 * with nothing in it, adds nothing.
 *
 * The one total the Needs attention card draws and the dashboard header
 * repeats, so the two cannot disagree. A total of none that is a floor means
 * some lists went unread, which is not the same as nothing waiting.
 *
 * @experimental
 */
export function attentionTotalOf(buckets: readonly AttentionTotalBucket[]): {
  count: number;
  atLeast: boolean;
} {
  let count = 0;
  let atLeast = false;
  for (const bucket of buckets) {
    if (bucket.value === null) continue;
    const key = parseAttentionKey(bucket.value);
    if (key === null || "part" in key) continue;
    if (bucket.count > 0) count += bucket.count;
    if (bucket.atLeast === true) atLeast = true;
  }
  return { count, atLeast };
}
