/**
 * Focus: one container of the outline shown on its own, under a breadcrumb from the entity's top
 * level down to it. The outline draws `nodes` from `rootLevel`, so the focused container's own
 * fields are the first level drawn; everything else about drawing them (folding, finding, the
 * rows' marks) is the outline's as usual.
 */
import {
  flattenOutline,
  type OutlineContainer,
  type OutlineNode,
} from "./outline-model";

/** What the outline draws while a container is focused, or the whole outline when none is. */
export interface FocusView {
  /** The focused container, or null when nothing is focused. */
  focused: OutlineNode | null;
  /** The containers from the top level down to the focused one, outermost first. */
  crumbs: readonly OutlineNode[];
  /** The rows to draw: the focused container's own, or every top-level row. */
  nodes: readonly OutlineNode[];
  /** The level the drawn rows start from in the outline: 1 for the top level. */
  rootLevel: number;
}

/**
 * The containers a person may focus: a group, repeating rows and a blocks field. A field group is
 * changed in its own editor, and a block's rows are only read.
 */
const FOCUSABLE: ReadonlySet<OutlineContainer> = new Set<OutlineContainer>([
  "group",
  "repeater",
  "blocks",
]);

export function canFocus(node: OutlineNode): boolean {
  return node.container !== null && FOCUSABLE.has(node.container);
}

/** The rows from the top level down to `id`, outermost first, or null when no row has it. */
function chainTo(
  nodes: readonly OutlineNode[],
  id: string
): OutlineNode[] | null {
  for (const node of nodes) {
    if (node.id === id) return [node];
    const below = chainTo(node.children, id);
    if (below) return [node, ...below];
  }
  return null;
}

export function focusView(
  nodes: readonly OutlineNode[],
  focusedId: string | null
): FocusView {
  const whole: FocusView = { focused: null, crumbs: [], nodes, rootLevel: 1 };
  if (focusedId === null) return whole;
  const chain = chainTo(nodes, focusedId);
  const focused = chain?.[chain.length - 1];
  // An id that names no row, or a row that may not be focused, draws the whole outline.
  if (!chain || !focused || !canFocus(focused)) return whole;
  return {
    focused,
    crumbs: chain,
    nodes: focused.children,
    rootLevel: focused.level + 1,
  };
}

/**
 * Where Focus goes when the focused container is no longer there (deleted, undone, moved out of
 * reach): the deepest of the crumbs it showed that is still a container to focus, or null to show
 * the whole outline.
 */
export function focusFallback(
  nodes: readonly OutlineNode[],
  crumbIds: readonly string[]
): string | null {
  const byId = new Map(flattenOutline(nodes).map(node => [node.id, node]));
  for (let at = crumbIds.length - 1; at >= 0; at--) {
    const node = byId.get(crumbIds[at]);
    if (node && canFocus(node)) return node.id;
  }
  return null;
}

/**
 * The focus that keeps `id` in view: the nearest container above it that may be focused, or null
 * for the top level. After a move takes a field out of the focused container, Focus steps here so
 * the field stays drawn and keeps focus.
 */
export function focusHolding(
  nodes: readonly OutlineNode[],
  id: string
): string | null {
  const chain = chainTo(nodes, id);
  if (!chain) return null;
  for (let at = chain.length - 2; at >= 0; at--) {
    if (canFocus(chain[at])) return chain[at].id;
  }
  return null;
}
