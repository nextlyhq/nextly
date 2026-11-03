/**
 * The dashed outline on the parts of a selected placement an author can edit.
 *
 * A component's own design and the fields it exposes look alike on the page,
 * so the editor marks the second: while a placement is selected, each element
 * that draws one of its exposed values carries {@link EXPOSED_ATTRIBUTE}, and
 * the canvas marks outline it, dashed, in the accent a component
 * wears. The composed page's exposure map says which those are, so the marks
 * are exactly the values a double-click edits or the panel lists.
 *
 * @module exposed-outline
 */
import type {
  BlockDocument,
  PropExposure,
  ResolvedBlockNode,
} from "@nextlyhq/blocks-engine";

/** Marks an element drawing one of the selected placement's exposed values. */
export const EXPOSED_ATTRIBUTE = "data-nx-exposed";

/**
 * Mark, under `root`, the elements drawing the exposed values of the placement
 * `placementId`, and clear every other mark. `null` clears them all.
 *
 * @param root - the canvas, or the document holding it
 * @param placementId - the selected placement, or `null`
 * @param composed - the editor's composition, with the exposure map
 */
export function markExposedParts(
  root: ParentNode,
  placementId: string | null,
  composed: BlockDocument | undefined
): void {
  const fed =
    placementId === null || composed === undefined
      ? new Map<string, Readonly<Record<string, PropExposure>>>()
      : exposuresOf(composed.nodes, placementId);
  const wanted = new Set<Element>();
  root.querySelectorAll("[data-nx-node]").forEach(owner => {
    const exposed = fed.get(owner.getAttribute("data-nx-node") ?? "");
    if (exposed === undefined) return;
    const parts = [
      owner,
      ...Array.from(owner.querySelectorAll("[data-nx-prop]")),
    ];
    for (const part of parts) {
      const prop = part.getAttribute("data-nx-prop");
      // A value of this node, not of a block nested inside it.
      if (prop === null || part.closest("[data-nx-node]") !== owner) continue;
      if (!Object.hasOwn(exposed, prop)) continue;
      if (exposed[prop]?.type === "visibility") continue;
      wanted.add(part);
    }
  });
  root.querySelectorAll(`[${EXPOSED_ATTRIBUTE}]`).forEach(element => {
    if (!wanted.has(element)) element.removeAttribute(EXPOSED_ATTRIBUTE);
  });
  wanted.forEach(element => {
    if (!element.hasAttribute(EXPOSED_ATTRIBUTE)) {
      element.setAttribute(EXPOSED_ATTRIBUTE, "");
    }
  });
}

/** Each composed node of the placement that carries an exposure map, by id. */
function exposuresOf(
  nodes: readonly ResolvedBlockNode[],
  placementId: string
): Map<string, Readonly<Record<string, PropExposure>>> {
  const found = new Map<string, Readonly<Record<string, PropExposure>>>();
  const queue = [...nodes];
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head];
    if (typeof node !== "object" || node === null) continue;
    if (node.instanceOf === placementId && node.exposedProps !== undefined) {
      found.set(node.id, node.exposedProps);
    }
    const slots: unknown = node.slots;
    if (typeof slots !== "object" || slots === null) continue;
    for (const children of Object.values(slots as Record<string, unknown>)) {
      if (Array.isArray(children)) {
        queue.push(...(children as ResolvedBlockNode[]));
      }
    }
  }
  return found;
}
