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
export interface Area {
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
  const areas = nodeLocks(document.nodes, sources.definitions);
  const found: LockedExposure[] = [];
  for (const entry of exposed) {
    if (!isPlainRecord(entry)) continue;
    const { id, label, nodeId, propPath } = entry;
    if (typeof nodeId !== "string" || typeof propPath !== "string") continue;
    const at = areas.get(nodeId);
    if (at?.area === undefined) continue;
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

/** Where one node of a document sits with respect to the locks above it. */
export interface NodeLock {
  readonly type: string;
  /** The lock of the slot the node sits in; undefined where none applies. */
  readonly lock: ActiveSlotLock | undefined;
  /** The `"contentOnly"` area it sits in, named by its outermost slot. */
  readonly area: Area | undefined;
}

/**
 * Each node of a document, by id, with the lock of the slot it sits in.
 *
 * Walked with the lock each slot passes down, asked of `slotLockOf`, the rule
 * validation applies, so the locks read here are the locks a save enforces.
 * Bounded by the document cap.
 */
export function nodeLocks(
  nodes: unknown,
  definitions: SlotDefaultSource
): ReadonlyMap<string, NodeLock> {
  const inside = new Map<string, NodeLock>();
  if (!Array.isArray(nodes)) return inside;
  const queue: Visit[] = nodes.map(node => ({
    node,
    lock: undefined,
    area: undefined,
  }));
  for (let head = 0; head < queue.length && head < MAX_NODES; head += 1) {
    const { node, lock, area } = queue[head];
    if (!isPlainRecord(node) || typeof node.type !== "string") continue;
    if (typeof node.id === "string") {
      inside.set(node.id, { type: node.type, lock, area });
    }
    queue.push(...childVisits(node, node.type, { lock, area }, definitions));
  }
  return inside;
}

/** A node the walk reaches, with the lock and the area it sits in. */
interface Visit {
  node: unknown;
  lock: ActiveSlotLock | undefined;
  area: Area | undefined;
}

/** A node's children, each with the lock its slot passes down. */
function childVisits(
  node: Record<string, unknown>,
  type: string,
  at: { lock: ActiveSlotLock | undefined; area: Area | undefined },
  definitions: SlotDefaultSource
): Visit[] {
  const slots = node.slots;
  if (!isPlainRecord(slots)) return [];
  const visits: Visit[] = [];
  for (const slot of boundedOwnKeys(slots, MAX_NODES) ?? []) {
    const children = ownEntry(slots, slot);
    if (!Array.isArray(children)) continue;
    const lock = slotLockOf(definitions, type, slot, at.lock);
    // Inside an area exactly while the lock this slot passes down is
    // contentOnly, as validation reads it: a slot its block does not declare
    // passes none. Named by the OUTERMOST slot, the lock an author meets.
    const area =
      lock === "contentOnly"
        ? (at.area ?? { slot, holderType: type })
        : undefined;
    for (const child of children as BlockNode[]) {
      visits.push({ node: child, lock, area });
    }
  }
  return visits;
}

/** The prop an exposure's path starts at: `align` of `align.desktop`. */
function rootOfPath(propPath: string): string {
  const end = propPath.search(/[.[]/);
  return end === -1 ? propPath : propPath.slice(0, end);
}
