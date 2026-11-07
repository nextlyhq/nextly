/**
 * The Entry content block: where a collection's template draws the entry's
 * own blocks content.
 *
 * A template draws every entry of its collection, and an entry may hold
 * content of its own in a blocks field (a post's Body). `core/entry-content`
 * marks where that content goes, and stores which of the collection's
 * top-level blocks fields it is (`field`). It holds nothing itself: its one
 * slot is locked empty, and the entry's document is composed into it only
 * where the template is drawn with an entry (`composeEntryContent`), so the
 * template's renderer draws the entry's blocks as its own, styles and all,
 * and nothing of the entry is ever stored in the template.
 *
 * The rules every reader holds it to, here so the save, the editor and the
 * API judge it alike:
 *
 * - it belongs in a document of kind `template`, and only there: anywhere
 *   else it would draw nothing, and an entry's own blocks field holding one
 *   would draw the content that holds it;
 * - a template holds at most one, since an entry's content shows once;
 * - its `field` names the field as text.
 *
 * Whether `field` is a top-level blocks field of the template's collection
 * needs the collection's schema, which only the server knows; the page
 * builder judges that at save.
 *
 * @experimental Settles when collection templates ship.
 * @module entry-content
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  renderedDomId,
  type BlockDocument,
  type BlockNode,
} from "./document";
import { remapFragmentBindings, remapFragmentProps } from "./fragment-refs";
import { describeValue, pointer } from "./issue-text";
import { DEFAULT_LIMITS, type DocumentLimits } from "./limits";
import { isPlainRecord } from "./plain-record";
import {
  claimedDomId,
  composedNodeId,
  hostIdsIn,
  resolveComponentInstances,
  type ComponentLookup,
} from "./resolve-instances";
import { mapForest, mintDomId, remapIdReferences, walkNodes } from "./tree";

/**
 * The Entry content block's type.
 *
 * @experimental Settles when collection templates ship.
 */
export const ENTRY_CONTENT_TYPE = "core/entry-content";

/**
 * The slot the entry's content is composed into. Declared by the block and
 * locked empty, so a stored template never holds anything there.
 *
 * @experimental Settles when collection templates ship.
 */
export const ENTRY_CONTENT_SLOT = "content";

/**
 * The prop naming the blocks field the block draws.
 *
 * @experimental Settles when collection templates ship.
 */
export const ENTRY_CONTENT_FIELD_PROP = "field";

/**
 * The validator's codes for the block's own rules, each with the line
 * `ISSUE_CODES` documents it by.
 *
 * @experimental Settles when collection templates ship.
 */
export const ENTRY_CONTENT_ISSUE_CODES: {
  readonly "entry-content-outside-template": string;
  readonly "entry-content-duplicate": string;
  readonly "entry-content-field-invalid": string;
} = {
  "entry-content-outside-template":
    "An Entry content block sits in a document that is not a template, where there is no entry to draw.",
  "entry-content-duplicate":
    "A template holds more than one Entry content block; it holds one.",
  "entry-content-field-invalid":
    "An Entry content block's field is not text naming a blocks field.",
};

/** One of the block's own issue codes. */
export type EntryContentIssueCode = keyof typeof ENTRY_CONTENT_ISSUE_CODES;

/** One Entry content block in a forest, and where it sits. */
export interface EntryContentPlacement {
  /** The block's node, as stored. */
  readonly node: Readonly<Record<string, unknown>> & { readonly id: string };
  /** A JSON pointer to it, from the document (`/nodes/0/slots/children/1`). */
  readonly path: string;
}

/** One node still to visit, with its pointer. */
interface Visit {
  readonly node: unknown;
  readonly path: string;
}

/** Each entry of a list as a visit, with its pointer under `base`. */
function visitsOf(list: unknown, base: string): Visit[] {
  if (!Array.isArray(list)) return [];
  return list.map((node: unknown, index) => ({
    node,
    path: pointer(base, index),
  }));
}

/** Every child a node's slots hold, in document order, as visits. */
function childVisits(
  node: Readonly<Record<string, unknown>>,
  path: string
): Visit[] {
  const slots = node.slots;
  if (!isPlainRecord(slots)) return [];
  return Object.entries(slots).flatMap(([name, children]) =>
    visitsOf(children, pointer(`${path}/slots`, name))
  );
}

/** Whether a read node is an Entry content block this walk can name. */
function isPlacement(
  node: Readonly<Record<string, unknown>>
): node is EntryContentPlacement["node"] {
  return node.type === ENTRY_CONTENT_TYPE && typeof node.id === "string";
}

/**
 * Every Entry content block in `nodes`, in document order.
 *
 * Iterative, bounded by `maxNodes` (every entry read spends it), and reading
 * plain records only, since a stored document is whatever the database
 * returned. A node met twice (a cycle) is not descended into again.
 *
 * @experimental Settles when collection templates ship.
 */
export function entryContentPlacements(
  nodes: readonly unknown[],
  maxNodes: number = Number.MAX_SAFE_INTEGER
): readonly EntryContentPlacement[] {
  const found: EntryContentPlacement[] = [];
  const seen = new Set<unknown>();
  // Reversed, so popping meets them in document order.
  const stack = visitsOf(nodes, "/nodes").reverse();
  for (let left = maxNodes; left > 0 && stack.length > 0; left -= 1) {
    const visit = stack.pop();
    if (visit === undefined) break;
    const { node, path } = visit;
    if (!isPlainRecord(node) || seen.has(node)) continue;
    seen.add(node);
    if (isPlacement(node)) found.push({ node, path });
    stack.push(...childVisits(node, path).reverse());
  }
  return found;
}

/**
 * The blocks field an Entry content node names, or `undefined` while it names
 * none (unset, empty or not text).
 *
 * @experimental Settles when collection templates ship.
 */
export function entryContentFieldOf(node: unknown): string | undefined {
  if (!isPlainRecord(node) || !isPlainRecord(node.props)) return undefined;
  const field = node.props[ENTRY_CONTENT_FIELD_PROP];
  return typeof field === "string" && field.trim() !== ""
    ? field.trim()
    : undefined;
}

/** One finding about a forest's Entry content blocks, as validation reads it. */
export interface EntryContentIssue {
  readonly path: string;
  readonly nodeId: string;
  readonly code: EntryContentIssueCode;
  readonly message: string;
  readonly severity: "error";
}

/** What the block's rules are judged with, besides the forest. */
export interface EntryContentJudgement {
  /** The document's kind, as stored; anything but `template` refuses one. */
  readonly documentKind?: unknown;
  readonly maxNodes?: number;
}

/**
 * The problems of a forest's Entry content blocks: one outside a template,
 * every one after the first, and a `field` that is not text. Always errors:
 * the block is new, so no stored document can already hold one of these.
 *
 * @experimental Settles when collection templates ship.
 */
export function entryContentIssues(
  nodes: readonly unknown[],
  judgement: EntryContentJudgement = {}
): EntryContentIssue[] {
  const placements = entryContentPlacements(nodes, judgement.maxNodes);
  const issues: EntryContentIssue[] = [];
  const inTemplate = judgement.documentKind === "template";
  placements.forEach(({ node, path }, index) => {
    if (!inTemplate) {
      issues.push({
        path,
        nodeId: node.id,
        code: "entry-content-outside-template",
        severity: "error",
        message:
          "Entry content shows an entry's own content, so it belongs in a collection's template. Remove it from here.",
      });
    } else if (index > 0) {
      issues.push({
        path,
        nodeId: node.id,
        code: "entry-content-duplicate",
        severity: "error",
        message: `A template holds one Entry content block, and this is a second one (${describeValue(node.id)}). Remove it.`,
      });
    }
    const props = node.props;
    const field = isPlainRecord(props)
      ? props[ENTRY_CONTENT_FIELD_PROP]
      : undefined;
    if (field !== undefined && typeof field !== "string") {
      issues.push({
        path: `${path}/props/${ENTRY_CONTENT_FIELD_PROP}`,
        nodeId: node.id,
        code: "entry-content-field-invalid",
        severity: "error",
        message: `Entry content's field must be the name of a blocks field, as text; it is ${describeValue(field)}.`,
      });
    }
  });
  return issues;
}

/**
 * Whether `node`, or anything inside it, is an Entry content block. Asked of
 * a block about to be copied, since a copy of one is a second.
 *
 * @experimental Settles when collection templates ship.
 */
export function holdsEntryContent(node: unknown, maxNodes?: number): boolean {
  return entryContentPlacements([node], maxNodes).length > 0;
}

/**
 * An entry's stored blocks value as a document this format reads, or `null`
 * where it is none: absent, not this format's version, or with no node list.
 * A value stored as JSON text is read as the JSON it holds.
 *
 * @experimental Settles when collection templates ship.
 */
export function entryBlocksDocumentOf(value: unknown): BlockDocument | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isPlainRecord(parsed)) return null;
  if (parsed.formatVersion !== DOCUMENT_FORMAT_VERSION) return null;
  if (!Array.isArray(parsed.nodes)) return null;
  return parsed as unknown as BlockDocument;
}

/** What composing an entry's content into a template is given. */
export interface EntryContentSource {
  /**
   * The entry's stored value of `field`, as the drawing reads the entry: on
   * a published page, as the public reads it, so a field the public may not
   * read is absent and draws nothing.
   */
  readonly valueOf: (field: string) => unknown;
  /**
   * The most nodes the drawn page may hold, the template's and the entry's
   * together: the entry's blocks past it are never read. The format's own
   * limit where absent.
   */
  readonly maxNodes?: number;
  /**
   * How deep the drawn page may nest, as the renderer counts it (a top-level
   * block at depth 1): the entry's blocks below it are never read. The
   * format's own limit where absent.
   */
  readonly maxDepth?: number;
  /**
   * The definitions of the components the page places, as the renderer will
   * expand them: the template is then charged what it draws once its
   * instances are expanded, so the entry never takes the room an expansion
   * needs, and every instance still resolves under the page's one node
   * limit. Absent, each instance is charged as the one node it is stored as.
   */
  readonly definitions?: ComponentLookup;
}

/**
 * The ids the entry's nodes wear once drawn inside the template, by node:
 * minted as a component's inlined nodes are (`composedNodeId`), from the
 * Entry content block's id and each node's own, against every id the
 * template already holds (`taken`, which each mint joins), so a drawn node
 * can never take one of the template's ids, nor two of them one. The same on
 * every render.
 */
function drawnIds(
  nodes: readonly BlockNode[],
  host: string,
  taken: Set<string>
): Map<BlockNode, string> {
  const ids = new Map<BlockNode, string>();
  walkNodes([...nodes], node => {
    ids.set(
      node,
      composedNodeId(host, typeof node.id === "string" ? node.id : "", taken)
    );
  });
  return ids;
}

/**
 * The DOM id each of the entry's authored ids becomes once drawn inside the
 * template: minted from the drawn node's id, as a component's are, and
 * claimed against every DOM id the template already publishes (`taken`,
 * which each claim joins), as a component's are (`claimedDomId`), so an id
 * the template's own blocks use is never rendered twice, whether the entry
 * spelled it (`hero`) or the mint happens to. The same on every render.
 * Memoized on the original, so two of the entry's nodes spelling one id
 * still address one target.
 */
function drawnDomIds(
  nodes: readonly BlockNode[],
  ids: ReadonlyMap<BlockNode, string>,
  taken: Set<string>
): Map<string, string> {
  const domIds = new Map<string, string>();
  walkNodes([...nodes], node => {
    const rendered = renderedDomId(node);
    const id = ids.get(node);
    if (rendered !== undefined && id !== undefined && !domIds.has(rendered)) {
      domIds.set(rendered, claimedDomId(mintDomId(rendered, id), taken));
    }
  });
  return domIds;
}

/**
 * One of the entry's nodes as the template draws it: its id prefixed, its own
 * DOM id replaced, and its references to the entry's ids (an anchor's
 * `#hero`, an `aria-describedby`, a bound link's fallback) rewritten to the
 * replacements, so what it pointed at it still points at.
 */
function drawnNode(
  node: BlockNode,
  ids: ReadonlyMap<BlockNode, string>,
  domIds: ReadonlyMap<string, string>
): BlockNode {
  const drawn: BlockNode = { ...node, id: ids.get(node) ?? node.id };
  if (domIds.size === 0) return drawn;
  const rendered = renderedDomId(node);
  const minted = rendered === undefined ? undefined : domIds.get(rendered);
  if (minted !== undefined && typeof node.cssId === "string") {
    drawn.cssId = minted;
  }
  if (isPlainRecord(node.attributes)) {
    drawn.attributes = drawnAttributes(node.attributes, minted, domIds);
  }
  drawn.props = remapFragmentProps(node.props, domIds) as BlockNode["props"];
  if (node.bindings !== undefined) {
    drawn.bindings = remapFragmentBindings(
      node.bindings,
      domIds
    ) as BlockNode["bindings"];
  }
  return drawn;
}

/**
 * An attribute bag as drawn: its `id` the minted one where the bag is what
 * renders it, and its id references rewritten. Text values only, as the
 * renderer emits.
 */
function drawnAttributes(
  attributes: Readonly<Record<string, unknown>>,
  minted: string | undefined,
  domIds: ReadonlyMap<string, string>
): Record<string, string> {
  const bag: Record<string, string> = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value !== "string") continue;
    bag[name] =
      name.toLowerCase() === "id" && minted !== undefined ? minted : value;
  }
  return remapIdReferences(bag, domIds);
}

/**
 * The entry's forest as the template draws it: every Entry content block left
 * out, at any depth, so the content can never draw itself, and cut after
 * `budget` entries in document order, so an entry larger than the page may
 * draw is never walked or copied past that. Read by index, so not one entry
 * past the budget is read; nested no deeper than the page may draw.
 */
function drawableForest(
  nodes: readonly unknown[],
  limits: {
    /** How many entries may still be drawn. */
    readonly budget: number;
    /** The depth the entry's top-level blocks are drawn at. */
    readonly depth: number;
    /** The deepest the drawn page may nest, as the renderer counts it. */
    readonly maxDepth: number;
    /**
     * What one of the entry's nodes costs once drawn, at `depth`, with at
     * most `left` to spend: one for a block, what it expands to for a
     * component placement. More than `left` where it does not fit.
     */
    readonly costOf: (node: BlockNode, depth: number, left: number) => number;
  }
): BlockNode[] {
  let left = limits.budget;
  /**
   * One entry of a forest, charged where `charged`: its block as drawn, or
   * nothing for an entry that draws nothing; `undefined` once the page has
   * no room left for it, which ends the cut, as the renderer would refuse
   * what follows it.
   */
  const take = (
    node: unknown,
    depth: number,
    charged: boolean
  ): BlockNode | null | undefined => {
    if (!isPlainRecord(node) || node.type === ENTRY_CONTENT_TYPE) {
      if (charged) left -= 1;
      return null;
    }
    const block = node as unknown as BlockNode;
    const cost = charged ? limits.costOf(block, depth, left) : 0;
    if (cost > left) {
      left = 0;
      return undefined;
    }
    left -= cost;
    // A placement's own blocks were charged with its expansion.
    return withCutSlots(block, depth, charged && cost === 1);
  };
  const cut = (
    forest: readonly unknown[],
    depth: number,
    charged: boolean
  ): BlockNode[] => {
    const kept: BlockNode[] = [];
    if (depth > limits.maxDepth) return kept;
    for (let at = 0; at < forest.length && (left > 0 || !charged); at += 1) {
      const taken = take(forest[at], depth, charged);
      if (taken === undefined) break;
      if (taken !== null) kept.push(taken);
    }
    return kept;
  };
  const withCutSlots = (
    node: BlockNode,
    depth: number,
    charged: boolean
  ): BlockNode => {
    if (!isPlainRecord(node.slots)) return node;
    const slots: Record<string, BlockNode[]> = {};
    for (const [name, children] of Object.entries(node.slots)) {
      if (Array.isArray(children)) {
        slots[name] = cut(children, depth + 1, charged);
      }
    }
    return { ...node, slots };
  };
  return cut(nodes, limits.depth, true);
}

/**
 * What the template costs of the page's node limit once drawn: its stored
 * nodes (`stored`), or, given the components' definitions, the nodes it
 * holds once the resolver has expanded its instances under the page's own
 * limits, its node cap and its depth, as the renderer will. Conditioned
 * instances are expanded too, so the room kept is the most any entry of the
 * collection can need.
 */
function templateCost(
  document: BlockDocument,
  stored: number,
  source: EntryContentSource,
  limits: DocumentLimits
): number {
  if (source.definitions === undefined) return stored;
  return Math.max(stored, expandedCount(document, source.definitions, limits));
}

/**
 * How many nodes `document` holds once the resolver has expanded its
 * component placements under `limits`; more than `limits.maxNodes` where a
 * placement is refused for want of room, so a caller never takes a refused
 * expansion for a cheap one. One refused for any other reason (a component
 * missing, a loop) is drawn as the one placeholder it stands as.
 */
function expandedCount(
  document: BlockDocument,
  definitions: ComponentLookup,
  limits: DocumentLimits
): number {
  const resolved = resolveComponentInstances(document, definitions, {
    limits,
    conditioned: "carry",
  });
  if (resolved.unresolved.some(instance => instance.reason === "budget")) {
    return limits.maxNodes + 1;
  }
  let count = 0;
  walkNodes(resolved.document.nodes, () => {
    count += 1;
  });
  return count;
}

/**
 * What one of the entry's nodes costs of the page's node limit, drawn at
 * `depth` with `left` still to spend: one for a block, and, given the
 * components' definitions, what a placement expands to under what is left
 * and the depth below it, as the template's own placements are charged. The
 * blocks inside any other node are charged one by one as the cut reaches
 * them.
 */
function entryNodeCost(
  node: BlockNode,
  depth: number,
  left: number,
  source: EntryContentSource,
  limits: DocumentLimits
): number {
  if (
    node.type !== COMPONENT_INSTANCE_TYPE ||
    source.definitions === undefined
  ) {
    return 1;
  }
  return expandedCount(
    { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes: [node] },
    source.definitions,
    {
      ...limits,
      maxNodes: left,
      // Resolved on its own, at the top: the depth left below where it sits.
      maxDepth: limits.maxDepth - depth + 1,
    }
  );
}

/**
 * How deep a node at `path` sits, as the renderer counts it: 1 for a
 * top-level block, one more for each slot above it.
 */
function depthOf(path: string): number {
  // One piece for a top-level path, one more for each slot it passes.
  return path.split("/slots/").length;
}

/**
 * `document` with the entry's content composed into its Entry content block,
 * for drawing: the blocks of the field the block names, read through
 * `source`, put in the block's slot with ids minted against the template's own.
 *
 * Only a template is composed, and only its first Entry content block, since
 * a template holds one. The entry's content is drawn without any Entry
 * content block of its own, at any depth, so the content can never draw
 * itself, whatever it holds. A field that holds no document of this format,
 * or one with no blocks, leaves the block empty, and the block then draws
 * nothing for a visitor. Returns `document` itself where nothing is
 * composed, so a page with no Entry content allocates nothing.
 *
 * Never stored: what is composed is the entry's, and the template stays as
 * it was saved.
 *
 * @experimental Settles when collection templates ship.
 */
export function composeEntryContent(
  document: BlockDocument,
  source: EntryContentSource
): BlockDocument {
  if (!isPlainRecord(document) || document.kind !== "template") {
    return document;
  }
  if (!Array.isArray(document.nodes)) return document;
  // The page's own limits, its node cap and its depth: every pass below,
  // and every expansion charged, is held to the same two.
  const limits: DocumentLimits = {
    ...DEFAULT_LIMITS,
    ...(source.maxNodes === undefined ? {} : { maxNodes: source.maxNodes }),
    ...(source.maxDepth === undefined ? {} : { maxDepth: source.maxDepth }),
  };
  const { maxNodes } = limits;
  // What the template holds, read once and no further than the page may
  // draw: a template past that composes nothing, as nothing past it draws.
  const host = hostIdsIn(document.nodes, maxNodes);
  if (host.truncated) return document;
  const [first] = entryContentPlacements(document.nodes, maxNodes);
  if (first === undefined) return document;
  const field = entryContentFieldOf(first.node);
  if (field === undefined) return document;
  const entry = entryBlocksDocumentOf(source.valueOf(field));
  if (entry === null || entry.nodes.length === 0) return document;
  // The entry's blocks within what the page may still draw beside the
  // template's own, cut before any of them is minted, walked or copied.
  // Charged as the page is drawn in full: the template's placements and the
  // entry's own at what they expand to, so every placement still resolves.
  const kept = drawableForest(entry.nodes, {
    budget: maxNodes - templateCost(document, host.count, source, limits),
    // A slot's blocks one below the block holding it, which sits as deep as
    // its path has slots below the top (a top-level block at depth 1).
    depth: depthOf(first.path) + 1,
    maxDepth: limits.maxDepth,
    costOf: (node, depth, left) =>
      entryNodeCost(node, depth, left, source, limits),
  });
  if (kept.length === 0) return document;
  const ids = drawnIds(kept, first.node.id, host.ids);
  const domIds = drawnDomIds(kept, ids, host.domIds);
  const drawn = mapForest(kept, node => drawnNode(node, ids, domIds));
  // The block as stored, by identity: the walk hands back the very node the
  // rebuild below meets, so only that one is composed.
  const target: unknown = first.node;
  return {
    ...document,
    nodes: mapForest(document.nodes, node =>
      node === target
        ? {
            ...node,
            slots: {
              ...(isPlainRecord(node.slots) ? node.slots : {}),
              [ENTRY_CONTENT_SLOT]: drawn,
            },
          }
        : node
    ),
  };
}
