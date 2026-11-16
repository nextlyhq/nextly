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

/**
 * What an item counts: a core release kind, a system problem System health
 * reports, or a plugin's item.
 */
export type AttentionDigestKind = "stopped" | "overdue" | "system" | "plugin";

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
  /**
   * Where the reader goes about it: a path relative to the admin, which the
   * admin resolves. Absent when no admin page is the place to act, and the
   * item's reason then names what to do.
   */
  link?: string;
  /** One line saying why it is waiting; absent when its owner gave none. */
  reason?: string;
  /**
   * Where the documentation says how to fix it: an absolute `https://` address
   * on nextlyhq.com, opened outside the admin. Absent when the item's link or
   * reason is the place to act.
   */
  help?: string;
  /**
   * One thing, not a count of things: its row says the label alone, as the
   * label already says what is wrong ("Database connection is not encrypted").
   */
  single?: true;
  /** The count could not be read: it failed, timed out or was not a count. */
  failed?: true;
}
