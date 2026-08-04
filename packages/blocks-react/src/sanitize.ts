import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

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
export function sanitizeDocument(document: BlockDocument): BlockDocument {
  let changed = false;

  const sanitizeNodes = (nodes: unknown): BlockNode[] => {
    if (!Array.isArray(nodes)) {
      changed = true;
      return [];
    }

    const result: BlockNode[] = [];
    for (const node of nodes) {
      // A non-object in the forest has no id, type or version to render, and
      // reading through it would fail at the first property access.
      if (typeof node !== "object" || node === null || Array.isArray(node)) {
        changed = true;
        continue;
      }

      const candidate = node as BlockNode;
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
        const sanitized = sanitizeNodes(children);
        if (sanitized !== children) slotsChanged = true;
        nextSlots[name] = sanitized;
      }

      result.push(
        slotsChanged ? { ...candidate, slots: nextSlots } : candidate
      );
    }

    return changed ? result : (nodes as BlockNode[]);
  };

  const nodes = sanitizeNodes(document.nodes);
  return changed ? { ...document, nodes } : document;
}
