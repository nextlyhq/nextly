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

/** Where one part of a kind lives: a collection's list, or a Single. @experimental */
export type AttentionContentKind = "collection" | "single";

/** A key, read back. @experimental */
export type AttentionKey =
  | { kind: AttentionKind }
  | {
      kind: AttentionKind;
      part: { contentKind: AttentionContentKind; slug: string };
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
  slug: string
): string {
  return `${kind}:${contentKind}:${slug}`;
}

/**
 * A key read back into its kind and, for a part, where the part lives; `null`
 * for anything that is not a key this vocabulary writes.
 *
 * @experimental
 */
export function parseAttentionKey(value: string): AttentionKey | null {
  const [kind, contentKind, slug, ...rest] = value.split(":");
  if (kind === undefined || !isAttentionKind(kind)) return null;
  if (contentKind === undefined) return { kind };
  if (
    (contentKind !== "collection" && contentKind !== "single") ||
    slug === undefined ||
    slug === "" ||
    rest.length > 0
  ) {
    return null;
  }
  return { kind, part: { contentKind, slug } };
}
