/**
 * One item of the attention digest, as the card, the header and any inbox
 * read it: its own module, importing nothing, so a reader of the shape (the
 * Needs your attention card's declaration among them) loads none of what
 * computes it.
 *
 * @module domains/widgets/attention/digest-item
 * @experimental The digest's items may change until every surface that reads
 *   them is built on them.
 */

/** How urgent an item is: critical items rank before every warning. */
export type AttentionSeverity = "critical" | "warning";

/** What an item counts: a core release kind, or a plugin's item. */
export type AttentionDigestKind = "stopped" | "overdue" | "plugin";

/** One item of the digest, as the card, the header and any inbox read it. */
export interface AttentionDigestItem {
  /** Stable across reads: core's `core/<kind>`, or the plugin item's own id. */
  id: string;
  kind: AttentionDigestKind;
  label: string;
  /** Zero only on a failed item, whose count is unknown. */
  count: number;
  /** The count is a floor: counting stopped at a bound. */
  atLeast?: true;
  severity: AttentionSeverity;
  /** Where the reader goes about it: a path relative to the admin, which the admin resolves. */
  link: string;
  /** One line saying why it is waiting; absent when its owner gave none. */
  reason?: string;
  /** The count could not be read: it failed, timed out or was not a count. */
  failed?: true;
}
