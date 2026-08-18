/**
 * The document as a structure an author can see: the layers tree, the path to
 * the selected block, and what a search leaves standing.
 *
 * The canvas shows a page. It does not show that the heading is inside a box
 * which is inside a section, and it cannot show a block that renders nothing —
 * an empty container is a couple of pixels, and a block hidden at the current
 * breakpoint is not there at all. Those are exactly the blocks an author loses.
 * This module is the other view of the same document.
 *
 * **One tree, two consumers.** The layers panel draws it and the breadcrumb
 * walks it, so both take their labels, their nesting and their badges from
 * here. Computed separately they would agree until the first time either
 * changed what it matched, and the disagreement would be silent: a breadcrumb
 * naming one ancestor while the panel highlights another.
 *
 * ## Children are flattened across slots, and that is measured rather than
 * assumed
 *
 * A block may declare several named child regions. Every container in the core
 * library declares exactly ONE, always called `children` — measured across the
 * catalogue, 9 containers with one slot and none with more. So a flat tree
 * describes the document faithfully today, and slot rows would add a level of
 * nesting to every tree in order to name a distinction no block currently
 * makes.
 *
 * **The limit that leaves, stated because it is not visible from the output:** a
 * block declaring two slots renders its children in one flat run here, so an
 * author could not tell which region a child sits in. That block does not exist
 * yet; when one does, this is the module that grows slot rows.
 *
 * Pure, and it takes a document rather than a registry lookup per row, so the
 * tree can be asserted without React and without a DOM.
 *
 * @module layers
 */

import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

import { blockLabel } from "./inserter";

/**
 * One block, as a row in the tree.
 *
 * Badges are FACTS about the node rather than switches. `locked` is a boolean
 * the engine defines; the two visibility flags are not, and conflating them
 * into one "hidden" is the mistake this shape exists to prevent — see
 * {@link LayerNode.conditional}.
 */
export interface LayerNode {
  readonly id: string;
  readonly type: string;
  /** The instance name if the author gave one, otherwise the block's name. */
  readonly label: string;
  /** The author has asked the editor not to move or delete this block. */
  readonly locked: boolean;
  /**
   * The block declares conditions, so whether it appears depends on the entry.
   *
   * NOT "hidden". Conditions are predicates over an entry's fields evaluated at
   * render time, so the editor cannot know the answer — showing an eye here
   * would state one. What is knowable, and worth showing, is that this block's
   * presence is conditional at all.
   */
  readonly conditional: boolean;
  /**
   * The block is hidden at one or more breakpoints.
   *
   * Also not "hidden", for a different reason: visibility is per breakpoint, so
   * a block hidden on mobile is fully present on desktop. A single eye would
   * have to pick one of those to be true about.
   */
  readonly breakpointHidden: boolean;
  readonly children: readonly LayerNode[];
}

/** Whether any breakpoint switches this node off. */
function hiddenAtSomeBreakpoint(node: BlockNode): boolean {
  const devices = node.visibility?.devices;
  if (devices === undefined) return false;
  return Object.values(devices).some(visible => visible === false);
}

/** Whether the node carries any condition at all. */
function hasConditions(node: BlockNode): boolean {
  const groups = node.visibility?.conditions;
  if (!Array.isArray(groups)) return false;
  return groups.some(group => Array.isArray(group) && group.length > 0);
}

/**
 * The name an author reads for one block.
 *
 * An instance name wins, because it is the only part an author wrote. It is
 * trimmed and an empty one is ignored: a name of spaces would render a blank
 * row that cannot be typed to and cannot be told from its neighbours.
 */
export function layerLabel(node: BlockNode): string {
  const named = node.name?.trim();
  return named !== undefined && named !== "" ? named : blockLabel(node.type);
}

/** The document as a tree of rows. */
export function layersOf(document: BlockDocument): LayerNode[] {
  const walk = (nodes: readonly BlockNode[]): LayerNode[] =>
    nodes.map(node => ({
      id: node.id,
      type: node.type,
      label: layerLabel(node),
      locked: node.locked === true,
      conditional: hasConditions(node),
      breakpointHidden: hiddenAtSomeBreakpoint(node),
      // Declaration order across every slot the node holds. `Object.values`
      // preserves insertion order for string keys, which is the order the
      // document was written in — so the tree matches the document rather than
      // an alphabetical rearrangement of its regions.
      children: walk(Object.values(node.slots ?? {}).flat()),
    }));

  return walk(document.nodes);
}

/**
 * The ancestors of a node, outermost first, ending with the node itself.
 *
 * Empty when nothing is selected or the id is not in the document — which the
 * breadcrumb draws as nothing rather than as a broken trail, and which happens
 * routinely: an undo can remove the selected node while the selection stands.
 */
export function pathTo(
  document: BlockDocument,
  id: string | null
): LayerNode[] {
  if (id === null) return [];

  const find = (nodes: readonly LayerNode[]): LayerNode[] => {
    for (const node of nodes) {
      if (node.id === id) return [node];
      const below = find(node.children);
      if (below.length > 0) return [node, ...below];
    }
    return [];
  };

  return find(layersOf(document));
}

/**
 * Every ancestor id on the way to a node, excluding the node itself.
 *
 * What the panel must expand for a selection made elsewhere to be visible. A
 * block selected on the canvas inside three collapsed containers is otherwise
 * highlighted in a tree that shows none of it, which reads as the panel
 * ignoring the click.
 */
export function ancestorIds(
  document: BlockDocument,
  id: string | null
): string[] {
  return pathTo(document, id)
    .slice(0, -1)
    .map(node => node.id);
}

/** What a search left standing, and what has to open for it to be visible. */
export interface LayerSearch {
  readonly roots: readonly LayerNode[];
  /** Ids to expand so every match is on screen. */
  readonly expand: readonly string[];
}

/** Whether a row itself answers the query. */
function matches(node: LayerNode, needle: string): boolean {
  // The type as well as the label, because an author who knows a block as
  // `core/heading` — from documentation, or from an agent's output — should not
  // have to guess what it is called in the panel.
  return (
    node.label.toLowerCase().includes(needle) ||
    node.type.toLowerCase().includes(needle)
  );
}

/**
 * Narrow the tree to what matches, keeping the ancestors of every match.
 *
 * A match's ancestors are KEPT even when they do not match themselves, because
 * a tree that dropped them would present matches as top-level blocks and lose
 * the one thing this panel exists to show. A matching node keeps its whole
 * subtree, so searching for a container still shows what is inside it.
 *
 * An empty or whitespace-only query returns the tree unchanged rather than
 * nothing — the panel renders with no query, and treating that as "match
 * nothing" would show an empty panel on open.
 */
export function filterLayers(
  roots: readonly LayerNode[],
  query: string
): LayerSearch {
  const needle = query.trim().toLowerCase();
  if (needle === "") return { roots, expand: [] };

  const expand: string[] = [];

  const prune = (nodes: readonly LayerNode[]): LayerNode[] =>
    nodes.flatMap(node => {
      if (matches(node, needle)) {
        // Kept whole. Its descendants are the contents of a thing the author
        // asked for, and hiding them would answer a narrower question than the
        // one they typed.
        return [node];
      }
      const children = prune(node.children);
      if (children.length === 0) return [];
      // Only a node kept BECAUSE of a descendant needs opening; a node that
      // matched is visible where it stands.
      expand.push(node.id);
      return [{ ...node, children }];
    });

  return { roots: prune(roots), expand };
}
