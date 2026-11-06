/**
 * The vocabulary of Needs attention's answers: the kinds its grouped result
 * counts and the keys it names them by, and the one rule that counts the
 * attention digest's items.
 *
 * Its own module, importing nothing, because more than one reader needs each
 * rule: the `system:attention` source writes the keys, and the digest's items
 * are counted by the dashboard header on the server ({@link digestTotal}) and
 * drawn by the Needs your attention card in the browser, both through
 * {@link isDrawnAttentionItem}. A copy on either side would agree on the day
 * it was written and drift after.
 *
 * Exported as `nextly/attention-keys` so a browser bundle reaches these rules
 * without the reads that produce the answers.
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

/**
 * Whether one item of the attention digest is one a surface draws: it names
 * itself (`id`) and says what it is (`label`), each as text. Anything else in
 * an answer is not an item, and is neither drawn nor counted.
 *
 * The one test of an item, asked by the Needs your attention card before it
 * draws a row and by {@link digestTotal} before it counts one, so the card's
 * rows and the header's number are the same items by construction.
 *
 * @experimental
 */
export function isDrawnAttentionItem(
  item: unknown
): item is Record<string, unknown> & { id: string; label: string } {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return false;
  }
  const { id, label } = item as Record<string, unknown>;
  return (
    typeof id === "string" &&
    id !== "" &&
    typeof label === "string" &&
    label !== ""
  );
}

/**
 * The digest's one number: how many items are waiting, which is the count the
 * Needs your attention card shows in its title and the dashboard header
 * repeats, and whether that number is a floor.
 *
 * Items, not the sum of their counts: each item is one thing to go and see
 * about, whatever its own count. A floor when any item is: one whose count
 * failed (the reader has something unknown) or stopped at a bound, so the
 * header says "N+" while the card says "Not all checked" or "99+" on a row.
 *
 * @experimental
 */
export function digestTotal(items: readonly unknown[]): {
  count: number;
  atLeast: boolean;
} {
  let count = 0;
  let atLeast = false;
  for (const item of items) {
    if (!isDrawnAttentionItem(item)) continue;
    count += 1;
    if (item.failed === true || item.atLeast === true) atLeast = true;
  }
  return { count, atLeast };
}
