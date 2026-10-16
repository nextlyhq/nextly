/**
 * Which of a component's exposed fields reach past a `"contentOnly"` lock.
 *
 * A component can expose a field of a node that sits inside a slot locked
 * `"contentOnly"`. A placement's value for that field is written into the
 * node, so exposing anything but content offers every placement a change the
 * lock then refuses on the page. Finding them lets the component's own save
 * say so, where the designer can fix it, rather than each page it is placed on.
 *
 * Content is decided by the prop the exposure drives, as everywhere a lock is
 * judged: the props its block declares with `role: "content"`.
 *
 * @module content-only-exposures
 */
import type { BlockNode, ComponentDocument } from "./document";
import { MAX_NODES } from "./limits";
import type { NestingSource } from "./nesting";
import { isPlainRecord } from "./plain-record";
import { boundedOwnKeys, ownEntry } from "./safe-record";
import { contentPropsOf, slotLockOf, type ActiveSlotLock } from "./slot-lock";
import type { SlotDefaultSource } from "./tree";

/** One exposure that drives something a `"contentOnly"` lock holds. */
export interface LockedExposure {
  readonly exposureId: string;
  readonly label: string;
  readonly nodeId: string;
  readonly propPath: string;
  /** The slot whose lock holds the node, at the outermost locked level. */
  readonly slot: string;
  /** The block that declares that slot. */
  readonly holderType: string;
}

/** Where a node sits inside a `"contentOnly"` area, if it does. */
interface Area {
  readonly slot: string;
  readonly holderType: string;
}

/**
 * Every exposure of `document` that drives a prop other than content, of a
 * node inside a `"contentOnly"` area.
 *
 * @param document - the component's document
 * @param sources - the block definitions, for each slot's lock and each prop's
 *   role; and the nesting rules the starting children are expanded under
 */
export function contentOnlyExposures(
  document: ComponentDocument,
  sources: { definitions: SlotDefaultSource; nesting?: NestingSource }
): LockedExposure[] {
  const exposed = (document as { exposed?: unknown }).exposed;
  if (!Array.isArray(exposed) || exposed.length === 0) return [];
  const areas = contentOnlyAreas(document.nodes, sources.definitions);
  const found: LockedExposure[] = [];
  for (const entry of exposed) {
    if (!isPlainRecord(entry)) continue;
    const { id, label, nodeId, propPath } = entry;
    if (typeof nodeId !== "string" || typeof propPath !== "string") continue;
    const at = areas.get(nodeId);
    if (at === undefined) continue;
    const content = contentPropsOf(sources.definitions.get(at.type)?.props);
    if (content.has(rootOfPath(propPath))) continue;
    found.push({
      exposureId: String(id),
      label: String(label),
      nodeId,
      propPath,
      slot: at.area.slot,
      holderType: at.area.holderType,
    });
  }
  return found;
}

/**
 * Each node inside a `"contentOnly"` area, by id, with its type and the area.
 *
 * Walked with the lock each slot passes down, asked of `slotLockOf`, the rule
 * validation applies, so the areas found here are the areas a save enforces.
 * Bounded by the document cap.
 */
function contentOnlyAreas(
  nodes: unknown,
  definitions: SlotDefaultSource
): Map<string, { type: string; area: Area }> {
  const inside = new Map<string, { type: string; area: Area }>();
  if (!Array.isArray(nodes)) return inside;
  const queue: {
    node: unknown;
    lock: ActiveSlotLock | undefined;
    area: Area | undefined;
  }[] = nodes.map(node => ({ node, lock: undefined, area: undefined }));
  for (let head = 0; head < queue.length && head < MAX_NODES; head += 1) {
    const { node, lock, area } = queue[head];
    if (!isPlainRecord(node) || typeof node.type !== "string") continue;
    if (area !== undefined && typeof node.id === "string") {
      inside.set(node.id, { type: node.type, area });
    }
    const slots = node.slots;
    if (!isPlainRecord(slots)) continue;
    for (const slot of boundedOwnKeys(slots, MAX_NODES) ?? []) {
      const children = ownEntry(slots, slot);
      if (!Array.isArray(children)) continue;
      const childLock = slotLockOf(definitions, node.type, slot, lock);
      // The OUTERMOST slot that locks it, which is the lock an author meets.
      const childArea =
        area ??
        (childLock === "contentOnly"
          ? { slot, holderType: node.type }
          : undefined);
      for (const child of children as BlockNode[]) {
        queue.push({ node: child, lock: childLock, area: childArea });
      }
    }
  }
  return inside;
}

/** The prop an exposure's path starts at: `align` of `align.desktop`. */
function rootOfPath(propPath: string): string {
  const end = propPath.search(/[.[]/);
  return end === -1 ? propPath : propPath.slice(0, end);
}
