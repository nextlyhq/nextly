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
 * Makes every NODE ID in a document unique.
 *
 * Node ids are the document's addressing mechanism and the renderer's React
 * keys. A duplicate makes React reuse one block's instance for another, which
 * is a wrong page rather than a missing one, so it has to be settled before
 * anything renders — the key is chosen by the caller, not by the block.
 *
 * **DOM ids are deliberately NOT settled here.** Which node ends up writing an
 * `id` is only knowable once a block has run: one that throws, or returns
 * something with no host root, is replaced by a placeholder that emits no id at
 * all. Reserving ids in advance therefore meant a block that later failed had
 * already taken `#pricing`, and the healthy node that wanted it was stripped in
 * exchange for nothing. Each boundary now writes its own id at the moment it
 * successfully produces a host root, which is the only point at which the
 * answer is known.
 *
 * What that gives up is a repair for a document holding two identical DOM ids.
 * Engine validation rejects that shape at write time (`duplicate-dom-id`), so
 * it can only arrive from a row edited outside the product — and a browser
 * resolves a duplicated id to the first match rather than failing, which is a
 * smaller cost than silently unsticking an anchor on a healthy page.
 *
 * Run AFTER condition-gated nodes are pruned, deliberately. A hidden node never
 * reaches the page, so letting it reserve an id would take that id from a
 * visible node for no benefit.
 *
 * `rendersSubtree` extends that same rule one level down. A node the caller
 * already knows will be replaced by a placeholder still renders — the
 * placeholder is what makes the failure visible, and it needs a key — but its
 * CHILDREN do not, because the placeholder replaces the node entirely. Walking
 * into them anyway let a child that never reaches the page claim an id and
 * drop a later visible sibling in exchange for nothing. Omitting the predicate
 * walks everything, which is what a caller with no such knowledge should do.
 *
 * Returns the ORIGINAL document when nothing collided.
 */
export function dedupeNodeIds(
  document: BlockDocument,
  rendersSubtree?: (node: BlockNode) => boolean
): BlockDocument {
  let changed = false;
  const seenIds = new Set<string>();

  const walk = (nodes: BlockNode[]): BlockNode[] => {
    const result: BlockNode[] = [];
    for (const node of nodes) {
      if (seenIds.has(node.id)) {
        changed = true;
        continue;
      }
      seenIds.add(node.id);

      const slots = node.slots;
      // The node keeps its id either way: it renders, as itself or as a
      // placeholder, and React needs the key. Only the descent is skipped.
      if (slots === undefined || rendersSubtree?.(node) === false) {
        result.push(node);
        continue;
      }

      let slotsChanged = false;
      const nextSlots: Record<string, BlockNode[]> = {};
      for (const [name, children] of Object.entries(slots)) {
        const walked = walk(children);
        if (walked !== children) slotsChanged = true;
        nextSlots[name] = walked;
      }
      result.push(slotsChanged ? { ...node, slots: nextSlots } : node);
    }
    return changed ? result : nodes;
  };

  const nodes = walk(document.nodes);
  return changed ? { ...document, nodes } : document;
}
