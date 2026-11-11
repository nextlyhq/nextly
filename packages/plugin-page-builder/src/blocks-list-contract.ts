/**
 * What the block listing answers, and where.
 *
 * The admin's Schema Builder reads it to show, under a blocks field, each
 * block the field accepts and that block's props. Code-defined block metadata
 * only: a block's name, label, description, who registered it, and its props'
 * names, labels and types. No content and no settings value.
 *
 * @module blocks-list-contract
 */

/** Where the listing answers, under the plugin's own namespace. */
export const BLOCKS_LIST_ROUTE_PATH = "/blocks";

/**
 * The one query parameter: a blocks field's allow-list, its entries joined by
 * commas (a block name never holds one). Absent means the field accepts any
 * block; an empty value means none.
 */
export const BLOCKS_LIST_ALLOW_PARAM = "allow";

/** One prop of a block, as the editor's inspector names it. */
export interface BlockListProp {
  readonly name: string;
  readonly label: string;
  /** The prop's schema type, e.g. "string", "select", "boolean". */
  readonly type: string;
}

/** One registered block the field accepts. */
export interface BlockListItem {
  /** Its namespaced name, e.g. "core/heading". */
  readonly name: string;
  /** Its label, as the editor's palette names it. */
  readonly label: string;
  readonly description: string;
  /** Who registered it ("core", a plugin's name), or null when not recorded. */
  readonly source: string | null;
  /**
   * The allow-list entries that admit it, in the list's order; empty when the
   * field names none and accepts any block.
   */
  readonly matchedBy: readonly string[];
  readonly props: readonly BlockListProp[];
}
