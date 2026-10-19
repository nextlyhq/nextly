/**
 * What a document's stored version holds in a node's place, which a
 * `"contentOnly"` lock lets the node keep.
 *
 * A lock is measured against the children its slot starts with. A block's
 * defaults can change after pages store it, though, and a stored child then
 * differs from today's starting child with nobody having changed it. So a part
 * the stored version already holds is no change: the node may keep it, or put
 * it back as it started, and only a third value is refused.
 *
 * Found by POSITION inside a `"contentOnly"` area, whose arrangement is fixed,
 * and by id only where no such area holds the node. A node moved into the
 * area from elsewhere therefore finds what the stored area held in its place,
 * not the design it had outside, which nothing locked.
 *
 * @module stored-counterparts
 */
import { isPlainRecord } from "./plain-record";
import { ownEntry } from "./safe-record";

type StoredNode = Readonly<Record<string, unknown>>;

/** A document's stored forms, indexed by node id. */
export interface StoredForms {
  /** The stored nodes with this id, one per stored form that holds it. */
  byId(id: string): readonly StoredNode[];
}

/**
 * Index a document's stored forms, a draft's and the live one's, by node id.
 *
 * Bounded by `maxNodes` per form, as every walk of a document is; a node past
 * the bound has no stored counterpart, which only measures it more strictly.
 *
 * @param forms - each stored form of the document; absent or empty for a
 *   document never stored
 */
export function storedFormsOf(
  forms: readonly unknown[] | undefined,
  maxNodes: number
): StoredForms | undefined {
  if (forms === undefined || forms.length === 0) return undefined;
  const index = new Map<string, StoredNode[]>();
  for (const form of forms) indexForm(form, index, maxNodes);
  return { byId: id => index.get(id) ?? [] };
}

/** Add one stored form's nodes to the index, at most `maxNodes` of them. */
function indexForm(
  form: unknown,
  index: Map<string, StoredNode[]>,
  maxNodes: number
): void {
  const nodes = isPlainRecord(form) ? form.nodes : undefined;
  if (!Array.isArray(nodes)) return;
  const queue: unknown[] = nodes.slice(0, maxNodes);
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (!isPlainRecord(node)) continue;
    if (typeof node.id === "string") {
      index.set(node.id, [...(index.get(node.id) ?? []), node]);
    }
    const room = maxNodes - queue.length;
    if (room > 0) queue.push(...slotChildLists(node).flat().slice(0, room));
  }
}

/**
 * The stored nodes a node is measured against besides its starting child.
 *
 * @param node - the node being judged
 * @param at - where it sits: its holder's counterparts and its position, and
 *   whether a `"contentOnly"` lock holds that position; absent for a node at
 *   the top level
 */
export function counterpartsOf(
  node: unknown,
  at:
    | {
        holders: readonly StoredNode[];
        slot: string;
        index: number;
        contentOnly: boolean;
      }
    | undefined,
  stored: StoredForms | undefined
): readonly StoredNode[] {
  if (stored === undefined || !isPlainRecord(node)) return [];
  const type = node.type;
  if (typeof type !== "string") return [];
  if (at?.contentOnly === true) {
    return positionalCounterparts(at.holders, at.slot, at.index, type);
  }
  return typeof node.id === "string"
    ? stored.byId(node.id).filter(held => held.type === type)
    : [];
}

/**
 * The child each of a holder's counterparts keeps at `index` of `slot`, where
 * it is of `type`.
 */
export function positionalCounterparts(
  holders: readonly StoredNode[],
  slot: string,
  index: number,
  type: string
): readonly StoredNode[] {
  const found: StoredNode[] = [];
  for (const holder of holders) {
    const slots = holder.slots;
    const children = isPlainRecord(slots) ? ownEntry(slots, slot) : undefined;
    const child: unknown = Array.isArray(children)
      ? children[index]
      : undefined;
    if (isPlainRecord(child) && child.type === type) found.push(child);
  }
  return found;
}

function slotChildLists(node: StoredNode): unknown[][] {
  const slots = node.slots;
  if (!isPlainRecord(slots)) return [];
  return Object.keys(slots)
    .map(slot => ownEntry(slots, slot))
    .filter((children): children is unknown[] => Array.isArray(children));
}
