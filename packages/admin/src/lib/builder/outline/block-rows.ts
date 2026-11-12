/**
 * What a blocks field accepts, drawn beneath it: each registered block its
 * allow-list admits, with that block's props, read-only.
 *
 * The blocks themselves are not fields: they are registered in code, so their
 * rows name who registered them and offer no change. Which blocks a list
 * admits is decided by the server, by the rule a save keeps them by; this
 * only draws the answer, and the entries it found nothing for.
 *
 * @module lib/builder/outline/block-rows
 */
import type { OutlineNode } from "./outline-model";

/** One prop of a registered block, as the editor names it. */
export interface BlockCatalogProp {
  name: string;
  label: string;
  type: string;
}

/** One registered block a blocks field accepts. */
export interface BlockCatalogItem {
  name: string;
  label: string;
  description: string;
  /** Who registered it ("core", a plugin's name), or null when not recorded. */
  source: string | null;
  /** The allow-list entries that admit it; empty for a list accepting any. */
  matchedBy: readonly string[];
  props: readonly BlockCatalogProp[];
}

/**
 * The blocks one allow-list admits: while read, when the read failed, when
 * the Page Builder that registers blocks is not there to ask, or the answer.
 */
export type BlockCatalog =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "unavailable" }
  | { state: "loaded"; items: readonly BlockCatalogItem[] };

/** The key a blocks field's allow-list is read under; any block is "*". */
export function blockCatalogKey(allow: readonly string[] | undefined): string {
  return allow === undefined ? "*" : JSON.stringify(allow);
}

/** A row that is no field: a registered block, or one of its props. */
function metaNode(
  parent: OutlineNode,
  segment: string,
  meta: "block" | "prop",
  shown: { name: string; label: string; type: string; typeName: string },
  source: string | null
): OutlineNode {
  const id = `${parent.id}/#${segment}`;
  return {
    id,
    path: `${parent.path}/#${segment}`,
    field: {
      id,
      name: shown.name,
      label: shown.label,
      type: shown.type,
    },
    parentId: parent.id,
    level: parent.level + 1,
    container: null,
    children: [],
    readOnly: { kind: "block", source },
    own: false,
    translatable: false,
    meta,
    typeName: shown.typeName,
  };
}

/** A registered block's row, with a row for each of its props. */
function blockNode(parent: OutlineNode, item: BlockCatalogItem): OutlineNode {
  const node = metaNode(
    parent,
    item.name,
    "block",
    { name: item.name, label: item.label, type: "block", typeName: "Block" },
    item.source
  );
  node.children = item.props.map(prop =>
    metaNode(
      node,
      prop.name,
      "prop",
      { ...prop, typeName: prop.type },
      item.source
    )
  );
  if (node.children.length > 0) node.container = "block";
  return node;
}

/**
 * Fill in a blocks field's row: its policy as written, the blocks it admits
 * once read, and the entries that admit no registered block. Without
 * `catalogs` (nothing asked to read them) the row shows the policy alone.
 */
export function fillBlocks(
  node: OutlineNode,
  catalogs: ReadonlyMap<string, BlockCatalog> | undefined
): void {
  const allow = node.field.blocks?.allow;
  node.blocks = { allow };
  // An empty list accepts no block, which needs no reading.
  if (catalogs === undefined || allow?.length === 0) return;
  const catalog = catalogs.get(blockCatalogKey(allow)) ?? {
    state: "loading" as const,
  };
  if (catalog.state !== "loaded") {
    node.blocks.unavailable = catalog.state;
    return;
  }
  node.children = catalog.items.map(item => blockNode(node, item));
  const admitting = new Set(catalog.items.flatMap(item => item.matchedBy));
  const unmatched = (allow ?? []).filter(entry => !admitting.has(entry));
  if (unmatched.length > 0) node.blocks.unmatched = unmatched;
}
