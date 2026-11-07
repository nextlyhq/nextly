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
  DOCUMENT_FORMAT_VERSION,
  renderedDomId,
  type BlockDocument,
  type BlockNode,
} from "./document";
import { remapFragmentBindings, remapFragmentProps } from "./fragment-refs";
import { describeValue, pointer } from "./issue-text";
import { isPlainRecord } from "./plain-record";
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
  readonly maxNodes?: number;
}

/**
 * A node of the entry's content as the template draws it: its id prefixed
 * by the Entry content block's, so it can never take an id the template's
 * own blocks hold, and drawn the same on every render.
 */
function drawnId(host: string, id: unknown): string {
  return `${host}:${typeof id === "string" ? id : ""}`;
}

/**
 * The DOM id each of the entry's authored ids becomes once drawn inside the
 * template: minted from the drawn node's id, as a component's are, so an id
 * the template's own blocks also use (`hero`) is never rendered twice, and
 * the same on every render. Memoized on the original, so two of the entry's
 * nodes spelling one id still address one target.
 */
function drawnDomIds(
  nodes: readonly BlockNode[],
  host: string
): Map<string, string> {
  const ids = new Map<string, string>();
  walkNodes([...nodes], node => {
    const rendered = renderedDomId(node);
    if (rendered !== undefined && !ids.has(rendered)) {
      ids.set(rendered, mintDomId(rendered, drawnId(host, node.id)));
    }
  });
  return ids;
}

/**
 * One of the entry's nodes as the template draws it: its id prefixed, its own
 * DOM id replaced, and its references to the entry's ids (an anchor's
 * `#hero`, an `aria-describedby`, a bound link's fallback) rewritten to the
 * replacements, so what it pointed at it still points at.
 */
function drawnNode(
  node: BlockNode,
  host: string,
  domIds: ReadonlyMap<string, string>
): BlockNode {
  const drawn: BlockNode = { ...node, id: drawnId(host, node.id) };
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

/** A forest with every Entry content block left out, at any depth. */
function withoutEntryContent(nodes: readonly BlockNode[]): BlockNode[] {
  const kept = nodes.filter(
    node => !isPlainRecord(node) || node.type !== ENTRY_CONTENT_TYPE
  );
  return mapForest(kept, node => {
    if (!isPlainRecord(node.slots)) return node;
    const slots: Record<string, BlockNode[]> = {};
    for (const [name, children] of Object.entries(node.slots)) {
      slots[name] = Array.isArray(children)
        ? children.filter(
            child => !isPlainRecord(child) || child.type !== ENTRY_CONTENT_TYPE
          )
        : children;
    }
    return { ...node, slots };
  });
}

/**
 * `document` with the entry's content composed into its Entry content block,
 * for drawing: the blocks of the field the block names, read through
 * `source`, put in the block's slot with their ids prefixed by the block's.
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
  const [first] = entryContentPlacements(document.nodes, source.maxNodes);
  if (first === undefined) return document;
  const field = entryContentFieldOf(first.node);
  if (field === undefined) return document;
  const entry = entryBlocksDocumentOf(source.valueOf(field));
  if (entry === null || entry.nodes.length === 0) return document;
  const host = first.node.id;
  const kept = withoutEntryContent(entry.nodes);
  const domIds = drawnDomIds(kept, host);
  const drawn = mapForest(kept, node => drawnNode(node, host, domIds));
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
