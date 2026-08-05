import {
  DEFAULT_LIMITS,
  type BlockDocument,
  type BlockNode,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";

/**
 * Repairs a stored document's SHAPE before anything walks it.
 *
 * The engine's tree helpers, its migrator and its style compiler all assume a
 * well-formed forest — reasonably, since validation is meant to run before a
 * document is stored. A renderer does not get that guarantee: it is handed
 * whatever a database returned, which may predate a validation rule, have been
 * written by an older version, or have been edited by hand. A slot holding an
 * object instead of an array is then fatal at the first `for...of`, and it
 * happens inside `PageRenderer` itself, where no per-block boundary can contain
 * it — one malformed field costs the whole page.
 *
 * So the shape is made sound once, here, and every engine call downstream is
 * safe by construction. This is the same forgiving posture the renderer takes
 * toward unknown block types and failed migrations, applied one level lower: to
 * the container rather than its contents.
 *
 * What it does NOT do is judge content. A node keeps whatever props, styles and
 * versions it was stored with; only structure that would stop a traversal is
 * repaired, and repairs drop the unusable part rather than guessing at it.
 *
 * Returns the ORIGINAL document when nothing needed repair, so the common case
 * allocates nothing.
 */
export function sanitizeDocument(
  document: BlockDocument,
  limits: DocumentLimits = DEFAULT_LIMITS
): BlockDocument {
  let changed = false;
  let remaining = limits.maxNodes;

  const sanitizeNodes = (nodes: unknown, depth: number): BlockNode[] => {
    if (!Array.isArray(nodes)) {
      changed = true;
      return [];
    }

    // Bounded rather than trusted. This walk runs inside `PageRenderer` before
    // any block boundary exists, so a document nested deeper than the format
    // allows would exhaust the call stack and fail the whole request while
    // trying to repair it. The engine holds every other document walk to these
    // same caps.
    if (depth > limits.maxDepth) {
      changed = true;
      return [];
    }

    const result: BlockNode[] = [];
    for (const node of nodes) {
      if (remaining <= 0) {
        changed = true;
        break;
      }
      remaining -= 1;

      // A non-object in the forest has no id, type or version to render, and
      // reading through it would fail at the first property access.
      if (typeof node !== "object" || node === null || Array.isArray(node)) {
        changed = true;
        continue;
      }

      const candidate = node as BlockNode;

      // Identity has to be text. A node whose `type` is an object reaches the
      // unknown-block placeholder, which puts that value in the DOM as a data
      // attribute and as text — so a hand-edited document would throw inside
      // React rather than be contained.
      // The version must be what the engine calls valid — a positive integer.
      // `-1` and `1.5` are numbers, and the migrator only upgrades non-negative
      // integers while the version-ahead guard only catches values ABOVE the
      // definition, so an impossible version would slip between the two and
      // reach the current renderer with props from a schema that never existed.
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.type !== "string" ||
        !Number.isInteger(candidate.version) ||
        candidate.version < 1
      ) {
        changed = true;
        continue;
      }

      const slots = candidate.slots;
      if (slots === undefined) {
        result.push(candidate);
        continue;
      }

      if (typeof slots !== "object" || slots === null || Array.isArray(slots)) {
        changed = true;
        const withoutSlots: BlockNode = { ...candidate };
        delete withoutSlots.slots;
        result.push(withoutSlots);
        continue;
      }

      let slotsChanged = false;
      const nextSlots: Record<string, BlockNode[]> = {};
      for (const [name, children] of Object.entries(slots)) {
        const sanitized = sanitizeNodes(children, depth + 1);
        if (sanitized !== children) slotsChanged = true;
        nextSlots[name] = sanitized;
      }

      result.push(
        slotsChanged ? { ...candidate, slots: nextSlots } : candidate
      );
    }

    return changed ? result : (nodes as BlockNode[]);
  };

  const nodes = sanitizeNodes(document.nodes, 1);
  return changed ? { ...document, nodes } : document;
}

/**
 * The DOM id a node will actually render with, if any.
 *
 * `cssId` is the modelled field and the attribute bag is the escape hatch
 * beside it, so a node carrying both renders the modelled one — which means
 * that is the only value worth reserving. Attribute NAMES are matched
 * case-insensitively because HTML treats them that way and the render path
 * lowercases before writing, so a stored `ID` becomes an `id` on the page.
 *
 * The VALUE is compared exactly. Ids are case-sensitive in the DOM: `#Hero` and
 * `#hero` address different elements, and folding them together would strip an
 * id that was never ambiguous.
 */
function renderedDomId(node: BlockNode): string | undefined {
  if (typeof node.cssId === "string") return node.cssId;
  const attributes: unknown = node.attributes;
  if (
    typeof attributes !== "object" ||
    attributes === null ||
    Array.isArray(attributes)
  ) {
    return undefined;
  }
  for (const [name, value] of Object.entries(attributes)) {
    if (name.toLowerCase() === "id" && typeof value === "string") return value;
  }
  return undefined;
}

/** A node with whatever supplied the given DOM id removed. */
function withoutDomId(node: BlockNode): BlockNode {
  const stripped: BlockNode = { ...node };
  delete stripped.cssId;
  const attributes: unknown = stripped.attributes;
  if (
    typeof attributes === "object" &&
    attributes !== null &&
    !Array.isArray(attributes)
  ) {
    stripped.attributes = Object.fromEntries(
      Object.entries(attributes).filter(([name]) => name.toLowerCase() !== "id")
    );
  }
  return stripped;
}

/**
 * Makes every address in a document unique.
 *
 * Two kinds, both of which have to be unique only among nodes that will
 * actually render:
 *
 * - **Node ids** are the document's addressing mechanism and the renderer's
 *   React keys. A duplicate makes React reuse one block's instance for another,
 *   which is a wrong page rather than a missing one.
 * - **DOM ids** are what an anchor, a label's `for` and an `#id` selector
 *   resolve against. Two elements answering to one is the ambiguity `cssId`
 *   exists to prevent, and it can arrive through `cssId` or through the
 *   attribute bag.
 *
 * Run AFTER condition-gated nodes are pruned, deliberately. A hidden node never
 * reaches the page, so letting it reserve an address would take that address
 * away from a visible node for no benefit: the visible one would be dropped or
 * stripped, the hidden one would then be pruned, and the page would be missing
 * content or an anchor that was never in conflict with anything.
 *
 * Engine validation rejects both shapes at write time; this is the forgiving
 * render path declining to reintroduce what a stored document may already hold.
 * Returns the ORIGINAL document when nothing collided.
 */
export function dedupeAddresses(document: BlockDocument): BlockDocument {
  let changed = false;
  const seenIds = new Set<string>();
  const seenDomIds = new Set<string>();

  const walk = (nodes: BlockNode[]): BlockNode[] => {
    const result: BlockNode[] = [];
    for (const node of nodes) {
      if (seenIds.has(node.id)) {
        changed = true;
        continue;
      }
      seenIds.add(node.id);

      let kept = node;
      const domId = renderedDomId(node);
      if (domId !== undefined) {
        if (seenDomIds.has(domId)) {
          // The first node to claim an id keeps it; the later one renders
          // without one rather than being dropped, since its content is fine.
          changed = true;
          kept = withoutDomId(node);
        } else {
          seenDomIds.add(domId);
        }
      }

      const slots = kept.slots;
      if (slots === undefined) {
        result.push(kept);
        continue;
      }

      let slotsChanged = false;
      const nextSlots: Record<string, BlockNode[]> = {};
      for (const [name, children] of Object.entries(slots)) {
        const walked = walk(children);
        if (walked !== children) slotsChanged = true;
        nextSlots[name] = walked;
      }
      result.push(slotsChanged ? { ...kept, slots: nextSlots } : kept);
    }
    return changed ? result : nodes;
  };

  const nodes = walk(document.nodes);
  return changed ? { ...document, nodes } : document;
}
