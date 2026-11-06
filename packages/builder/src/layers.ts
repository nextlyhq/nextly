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
 * **One block has two regions an author tells apart:** a collection list's
 * template, repeated for each entry, and its empty state, drawn when none
 * match. Its row names both ({@link LayerNode.slotRows}) and each child says
 * which it sits in ({@link LayerNode.slot}), so the panel draws "Each entry"
 * and "When empty" between the list and its blocks. The children stay one
 * flat list here, so the breadcrumb, the search and every caller walking the
 * tree read it as before. Any other block declaring two slots still renders
 * its children in one flat run; this is the module that grows its rows too.
 *
 * Pure, and it takes a document rather than a registry lookup per row, so the
 * tree can be asserted without React and without a DOM.
 *
 * @module layers
 */

import {
  COLLECTION_LIST_TYPE,
  hiddenOnDevice,
  isComponentInstance,
  type BlockDocument,
  type BlockNode,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";

import { blockLabel, type SavedComponent } from "./inserter";
import { storedComponentId } from "./placement-props";

/**
 * A component's title, by the id a placement stores.
 *
 * A placement is one node of the engine's instance type, so its type says only
 * that it IS a placement; the document holds no title. The library is the one
 * holder of a component's title, and the host that read it hands this in.
 */
export type ComponentTitleOf = (componentId: string) => string | undefined;

/** What a placement reads as when nothing names its component. */
export const UNNAMED_COMPONENT = "Component";

/**
 * The title lookup for a library's rows, built once per list.
 *
 * A map rather than a search per row, since the tree asks once for every
 * placement on the page, on every render.
 */
export function componentTitles(
  components: readonly Pick<SavedComponent, "id" | "title">[]
): ComponentTitleOf {
  const titles = new Map(
    components.map(component => [component.id, component.title] as const)
  );
  return componentId => titles.get(componentId);
}

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
  /**
   * The name the author gave, when they gave one: what a rename starts from.
   * The label falls back to the type or the component's title, which is not
   * a name the author wrote and must not be stored as one by a rename.
   */
  readonly name?: string;
  /**
   * The block is a component placement, so its row is marked as one: its label
   * may be the component's title, which would otherwise read as a block's own
   * name.
   */
  readonly component: boolean;
  /** The author has locked this block in Layers. */
  readonly locked: boolean;
  /**
   * The name of the block locked in Layers that this one sits inside, when it
   * is not locked itself: a lock covers everything inside the block, so the
   * row says it is held and by which block, where the lock is lifted.
   */
  readonly lockedBy?: string;
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
  /**
   * The block is hidden on the device being edited, which is the device the
   * canvas shows: the row is drawn dimmed with a "Hidden" badge. Only known
   * when the tree was asked for a device.
   */
  readonly hiddenHere?: boolean;
  /**
   * The name of the block hidden on the device being edited that this one
   * sits inside, when it is not hidden itself: a visitor on that device sees
   * none of what the block holds, so the row says it is hidden with it, and
   * where it is shown again.
   */
  readonly hiddenWith?: string;
  /** The region of its parent this block sits in. */
  readonly slot?: string;
  /**
   * The regions an author tells apart in this block, in order, each with
   * what it is called: a collection list's "Each entry" and "When empty".
   * Absent for a block whose children read as one run.
   */
  readonly slotRows?: readonly SlotRow[];
  readonly children: readonly LayerNode[];
}

/**
 * One region of a block, as Layers draws it between the block and its
 * children. `rowId` is the row's own identity in the tree, chosen so that no
 * block of the document has it: a stored id may be any non-empty string, so
 * no spelling alone could be kept apart from them.
 */
export interface SlotRow {
  readonly slot: string;
  readonly label: string;
  readonly rowId: string;
}

/** A collection list's regions, as Layers names them. */
const LIST_SLOT_ROWS = [
  { slot: "children", label: "Each entry" },
  { slot: "empty", label: "When empty" },
] as const;

/** Every block id in a document, so a region row can take an id none has. */
function documentIds(nodes: readonly BlockNode[]): Set<string> {
  const ids = new Set<string>();
  const stack = [...nodes];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    ids.add(node.id);
    for (const children of Object.values(node.slots ?? {})) {
      if (Array.isArray(children)) stack.push(...children);
    }
  }
  return ids;
}

/**
 * A list's region rows, each with an id no block and no other row has: the
 * readable spelling, counted on until it is free. `taken` holds the
 * document's ids and grows with each row's.
 */
function listSlotRows(parentId: string, taken: Set<string>): SlotRow[] {
  return LIST_SLOT_ROWS.map(row => {
    const spelled = `nx-slot:${row.slot}:${parentId}`;
    let rowId = spelled;
    for (let count = 1; taken.has(rowId); count += 1) {
      rowId = `${spelled}~${String(count)}`;
    }
    taken.add(rowId);
    return { ...row, rowId };
  });
}

/**
 * The device the tree is read for: the site's breakpoints and the one being
 * edited, which decides each row's {@link LayerNode.hiddenHere}.
 */
export interface LayersDevice {
  readonly breakpoints: BreakpointSet | undefined;
  readonly id: string;
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
 * The author's own name for a node, when they gave it a non-blank one.
 *
 * Trimmed and an empty result treated as absent: a name of spaces would read
 * as though the author had named the block while giving nothing that
 * distinguishes it from its neighbours.
 *
 * Exported so a second caller needing "does this node carry an authored
 * name" asks this rather than restating the trim-and-blank check — precisely
 * the two-implementations risk this module's own header warns about for the
 * tree it builds from the same field.
 */
export function authoredName(node: BlockNode): string | undefined {
  const named = node.name?.trim();
  return named !== undefined && named !== "" ? named : undefined;
}

/**
 * The name an author reads for one block.
 *
 * An instance name wins, because it is the only part an author wrote. A
 * component placement is then named by its component's title: its type's
 * label, "Component instance", names the engine's mechanism rather than what
 * the author placed. With no title to read (none handed in, a component the
 * library no longer holds, a blank title) it is a "Component".
 */
export function layerLabel(
  node: BlockNode,
  lookup?: Parameters<typeof blockLabel>[1],
  componentTitle?: ComponentTitleOf
): string {
  const named = authoredName(node);
  if (named !== undefined) return named;
  if (isComponentInstance(node)) {
    const id = storedComponentId(node);
    const title = id === "" ? undefined : componentTitle?.(id)?.trim();
    return title === undefined || title === "" ? UNNAMED_COMPONENT : title;
  }
  // Forwarded as given, so an absent lookup keeps `blockLabel`'s own default
  // rather than a second statement of it here.
  return blockLabel(node.type, lookup);
}

/**
 * Every block's name in a document, by address, as Layers reads them, kept
 * per document and title lookup: the canvas asks for a placement's name each
 * time it draws its frame, and a selection can hold many placements, so the
 * page is read once rather than once per name. An edit makes a new document,
 * which is read afresh.
 */
const BLOCK_NAMES = new WeakMap<
  BlockDocument,
  {
    readonly titles: ComponentTitleOf | undefined;
    readonly names: Map<string, string>;
  }
>();

/**
 * The name of the block at an address anywhere in the document, as its Layers
 * row reads (see {@link layerLabel}), or `undefined` where the document holds
 * no such block. The canvas tags a selected placement with it, so the page and
 * the tree call one block by one name.
 */
export function blockNameOf(
  document: BlockDocument,
  id: string,
  componentTitle?: ComponentTitleOf
): string | undefined {
  let kept = BLOCK_NAMES.get(document);
  if (kept === undefined || kept.titles !== componentTitle) {
    const names = new Map<string, string>();
    const walk = (rows: readonly LayerNode[]): void => {
      for (const row of rows) {
        names.set(row.id, row.label);
        walk(row.children);
      }
    };
    walk(layersOf(document, componentTitle));
    kept = { titles: componentTitle, names };
    BLOCK_NAMES.set(document, kept);
  }
  return kept.names.get(id);
}

/** Which region of `node` each of its children sits in, by the child. */
function slotsOfChildren(
  node: BlockNode
): (child: BlockNode) => string | undefined {
  const by = new Map<BlockNode, string>();
  for (const [slot, children] of Object.entries(node.slots ?? {})) {
    if (!Array.isArray(children)) continue;
    for (const child of children) by.set(child, slot);
  }
  return child => by.get(child);
}

/**
 * The region rows a tree holds, by their row id: the block each stands for
 * and its region. Read from the rows themselves, so a block whose id is
 * spelled like a row's is never taken for one.
 */
export function slotRowsIn(
  tree: readonly LayerNode[]
): ReadonlyMap<string, { readonly parentId: string; readonly slot: string }> {
  const rows = new Map<string, { parentId: string; slot: string }>();
  const stack = [...tree];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    for (const row of node.slotRows ?? []) {
      rows.set(row.rowId, { parentId: node.id, slot: row.slot });
    }
    stack.push(...node.children);
  }
  return rows;
}

/**
 * The regions on the way to a node: each list above it, the region the path
 * goes through, and that region's row. What the panel opens with the
 * node's ancestors, and what a list shows on the canvas so the node is drawn.
 */
export function regionsTo(
  document: BlockDocument,
  id: string | null
): {
  readonly parentId: string;
  readonly slot: string;
  readonly rowId: string;
}[] {
  const path = pathTo(document, id);
  const regions: { parentId: string; slot: string; rowId: string }[] = [];
  for (let index = 1; index < path.length; index += 1) {
    const parent = path[index - 1];
    const slot = path[index]?.slot;
    const row = parent?.slotRows?.find(candidate => candidate.slot === slot);
    if (parent !== undefined && row !== undefined) {
      regions.push({ parentId: parent.id, slot: row.slot, rowId: row.rowId });
    }
  }
  return regions;
}

/**
 * The document as a tree of rows.
 *
 * `componentTitle` names component placements; see {@link layerLabel}.
 */
export function layersOf(
  document: BlockDocument,
  componentTitle?: ComponentTitleOf,
  device?: LayersDevice
): LayerNode[] {
  // `heldBy` is the nearest locked block above and `hiddenBy` the nearest
  // block hidden on the device, carried down the walk so the tree is read once
  // rather than climbed per row.
  // The ids a region row may not take: every block's, then every row's.
  const taken = documentIds(document.nodes);
  const walk = (
    nodes: readonly BlockNode[],
    heldBy: string | undefined,
    hiddenBy: string | undefined,
    slotOf: (child: BlockNode) => string | undefined = () => undefined
  ): LayerNode[] =>
    nodes.map(node => {
      const slot = slotOf(node);
      const label = layerLabel(node, undefined, componentTitle);
      const locked = node.locked === true;
      const name = authoredName(node);
      // Asked of the engine's per-device reading, the cascade the published
      // stylesheet is compiled from, so a row says hidden exactly where a
      // visitor on that device sees nothing.
      const hiddenHere =
        device !== undefined &&
        hiddenOnDevice(node.visibility, device.breakpoints, device.id);
      return {
        id: node.id,
        type: node.type,
        label,
        ...(name === undefined ? {} : { name }),
        component: isComponentInstance(node),
        locked,
        ...(locked || heldBy === undefined ? {} : { lockedBy: heldBy }),
        conditional: hasConditions(node),
        breakpointHidden: hiddenAtSomeBreakpoint(node),
        ...(device === undefined ? {} : { hiddenHere }),
        // Kept on a row hidden itself as well: showing it here shows nothing
        // while the block around it is hidden, so the row offers no eye.
        ...(hiddenBy === undefined ? {} : { hiddenWith: hiddenBy }),
        ...(slot === undefined ? {} : { slot }),
        ...(node.type === COLLECTION_LIST_TYPE
          ? { slotRows: listSlotRows(node.id, taken) }
          : {}),
        // Declaration order across every slot the node holds. `Object.values`
        // preserves insertion order for string keys, which is the order the
        // document was written in — so the tree matches the document rather
        // than an alphabetical rearrangement of its regions. The nearest lock
        // is this block's own when it has one.
        children: walk(
          Object.values(node.slots ?? {}).flat(),
          locked ? label : heldBy,
          hiddenHere ? label : hiddenBy,
          slotsOfChildren(node)
        ),
      };
    });

  return walk(document.nodes, undefined, undefined);
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
  id: string | null,
  componentTitle?: ComponentTitleOf
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

  return find(layersOf(document, componentTitle));
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
      // matched is visible where it stands. So does each region the kept
      // children sit in, where the panel draws one.
      expand.push(node.id);
      for (const row of node.slotRows ?? []) {
        if (children.some(child => child.slot === row.slot)) {
          expand.push(row.rowId);
        }
      }
      return [{ ...node, children }];
    });

  return { roots: prune(roots), expand };
}
