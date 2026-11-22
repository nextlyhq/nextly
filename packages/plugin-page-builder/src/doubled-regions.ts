/**
 * Whether a page shows two headers, or two footers: the set's, drawn around
 * it, and one of its own among its blocks.
 *
 * A page's own header block is a Section whose HTML tag is `header` (or
 * `footer`), or a placed component marked "Use as: Header" (or Footer). It
 * counts only while the page's header & footer set shows that area too, and
 * only outside a Collection list, whose items repeat once per entry and are
 * not the page's header. A placed component's own blocks are its own: only
 * its "Use as" mark says what it is.
 *
 * Pure over the document, with no reads, so the editor's notice and any
 * page check ask one question with one answer.
 *
 * @module doubled-regions
 */
import {
  COLLECTION_LIST_TYPE,
  COMPONENT_INSTANCE_TYPE,
  hashId,
  MAX_NODES,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { LAYOUT_AREAS, type LayoutArea } from "./collections/areas";

/** An area the page shows twice, and the page's own blocks that make it so. */
export interface DoubledRegion {
  readonly area: LayoutArea;
  /** The page's own header (or footer) blocks, in document order. */
  readonly nodeIds: readonly string[];
}

/** What the detection asks about the site. */
export interface DoubledRegionsContext {
  /** The areas the page's header & footer set draws around it. */
  readonly shown: ReadonlySet<LayoutArea>;
  /** A component's "Use as" area, or undefined where it has none. */
  readonly componentArea: (componentId: string) => LayoutArea | undefined;
}

/**
 * The areas the page shows twice, header first, each with its own blocks
 * that do. Empty when it shows each area at most once.
 *
 * @experimental Settles with the header & footer work.
 */
export function doubledRegions(
  nodes: readonly BlockNode[],
  context: DoubledRegionsContext
): DoubledRegion[] {
  const found = new Map<LayoutArea, string[]>();
  for (const node of pageNodes(nodes)) {
    const area = ownArea(node, context);
    if (area === undefined || !context.shown.has(area)) continue;
    const ids = found.get(area) ?? [];
    ids.push(node.id);
    found.set(area, ids);
  }
  return LAYOUT_AREAS.flatMap(area => {
    const nodeIds = found.get(area);
    return nodeIds === undefined ? [] : [{ area, nodeIds }];
  });
}

/**
 * What a dismissal of the notice is kept under: the page, its set, the area
 * and which blocks were found, so it comes back when any of them changes.
 * The blocks are named by the engine's id hash of their ids, in any order.
 */
export function doubledRegionsKey(
  pageId: string,
  setId: string,
  region: DoubledRegion
): string {
  const blocks = [...region.nodeIds].sort().join(",");
  return `${pageId}|${setId}|${region.area}|${hashId(blocks)}`;
}

/** The area a node is the page's own block for, if any. */
function ownArea(
  node: BlockNode,
  context: DoubledRegionsContext
): LayoutArea | undefined {
  if (node.type === COMPONENT_INSTANCE_TYPE) {
    const componentId = node.props.componentId;
    return typeof componentId === "string"
      ? context.componentArea(componentId)
      : undefined;
  }
  const tag = node.props.as;
  return LAYOUT_AREAS.find(area => area === tag);
}

/**
 * The page's own nodes in document order, depth first: not inside a
 * Collection list, nor inside a placed component. Iterative and bounded by
 * the document's node limit, since stored data reaches here unvalidated;
 * entries that are not nodes are skipped.
 */
function* pageNodes(nodes: readonly unknown[]): Generator<BlockNode> {
  const stack: unknown[] = [...nodes].reverse();
  let read = 0;
  while (stack.length > 0 && read < MAX_NODES) {
    const entry = stack.pop();
    read += 1;
    if (!isNode(entry)) continue;
    yield entry;
    if (
      entry.type === COLLECTION_LIST_TYPE ||
      entry.type === COMPONENT_INSTANCE_TYPE
    ) {
      continue;
    }
    const children = Object.values(entry.slots ?? {}).flatMap(slot =>
      Array.isArray(slot) ? slot : []
    );
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
}

/** Whether a stored entry can be read as a node. */
function isNode(value: unknown): value is BlockNode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const node = value as Partial<BlockNode>;
  return (
    typeof node.id === "string" &&
    typeof node.type === "string" &&
    typeof node.props === "object" &&
    node.props !== null
  );
}
