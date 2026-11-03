/**
 * The Layers lock, judged for a write against the document it would replace.
 *
 * The op layer (`layers-lock`) keeps an editor from breaking a lock one edit at
 * a time. A write through the API or by an agent arrives as a whole document,
 * with no ops to judge, so it is compared with what is stored instead: a node
 * locked in the STORED document may not change, move or disappear.
 *
 * The one way past is to lift the lock in the same write. A write that sends a
 * locked node back unlocked may change it, move it or change what is inside it
 * as it likes, because unlocking is a deliberate act and the lock exists to
 * stop the accidental change, not the intended one. It is judged against the
 * STORED lock, never the lock the write sends: a write that adds a lock does
 * not thereby protect a change it makes in the same breath, and one that drops
 * a node cannot be read as having unlocked it first.
 *
 * What counts:
 * - **removed**: the locked node is not in the write at all;
 * - **moved**: its chain of ancestors, each named by id and the slot the next
 *   one sits in, differs. Its index alone does not count, because a sibling
 *   added before it shifts the index without moving it;
 * - **changed**: the node or anything inside it differs, every `locked` flag
 *   aside. A lock change alone is always allowed.
 *
 * Keys are compared in any order, because a JSON column on PostgreSQL or MySQL
 * stores them in an order of its own.
 *
 * @module layers-lock-stored
 */
import { pointer } from "./issue-text";
import { MAX_VALUE_PARTS } from "./limits";
import { sameValueInAnyKeyOrder } from "./ops";
import { isPlainRecord } from "./plain-record";

/** How a write breaks a lock held in the stored document. */
export type LayersLockChangeKind = "removed" | "moved" | "changed";

/** One locked node a write would change, move or remove. */
export interface LayersLockChange {
  readonly kind: LayersLockChangeKind;
  /** The locked node's id. */
  readonly id: string;
  /** The node as an author knows it: its Layers name, or else its type. */
  readonly label: string;
  /** Where the node sits in the stored document, as a JSON pointer. */
  readonly path: string;
}

/** A node as a walk found it: where it is, and what it sits inside. */
interface Placed {
  readonly node: Readonly<Record<string, unknown>>;
  readonly id: string;
  readonly path: string;
  /**
   * The ancestors, outermost first, as id then slot for each, so two chains
   * compare as two lists of strings.
   */
  readonly chain: readonly string[];
  /** The ancestors' ids alone, for asking whether one was already reported. */
  readonly ancestors: readonly string[];
  /** The ids of the blocks in the same list, this one included, in order. */
  readonly siblings: readonly string[];
  /** Each ancestor's own `siblings`, outermost first, beside `ancestors`. */
  readonly ancestorSiblings: readonly (readonly string[])[];
}

/** The usable ids of a list's entries, in order. */
function idsOf(entries: readonly unknown[]): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    const id = idOf(entry);
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

/**
 * The length of the longest strictly increasing run that can be picked, in
 * order, out of `values`: patience sorting, so a long sibling list costs
 * n log n rather than the square a table would.
 */
function longestRising(values: readonly number[]): number {
  const tails: number[] = [];
  for (const value of values) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((tails[middle] ?? 0) < value) low = middle + 1;
      else high = middle;
    }
    tails[low] = value;
  }
  return tails.length;
}

/**
 * Whether a block keeps its place among the siblings that were there before.
 *
 * Only siblings both forms hold are counted, so a block added beside it or one
 * removed shifts its index without moving it. Among the rest, a reorder is
 * read as the fewest blocks moved that explain it: the block keeps its place
 * when keeping it still is one of those explanations, so moving a sibling
 * across it, however far, is the sibling's move and not its own. It counts as
 * moved only when every fewest-moves reading moves it: it went past more of
 * its siblings than would have to move round it. A swap with one neighbour is
 * exactly as well explained by the neighbour moving, and the document cannot
 * say which happened, so it is not counted; the editor refuses the move of the
 * locked block itself before it is made.
 */
function samePlaceAmongSiblings(
  id: string,
  stored: readonly string[],
  written: readonly string[]
): boolean {
  const kept = new Set(written);
  const common = stored.filter(sibling => kept.has(sibling));
  const writtenAt = new Map<string, number>();
  for (const sibling of written) {
    if (!writtenAt.has(sibling)) writtenAt.set(sibling, writtenAt.size);
  }
  const order = common.map(sibling => writtenAt.get(sibling) ?? -1);
  const index = common.indexOf(id);
  const here = order[index];
  // Most writes keep every sibling in order, and then nothing is counted.
  if (
    here === undefined ||
    order.every((at, i) => i === 0 || (order[i - 1] ?? 0) < at)
  ) {
    return true;
  }
  const withIt =
    longestRising(order.slice(0, index).filter(at => at < here)) +
    1 +
    longestRising(order.slice(index + 1).filter(at => at > here));
  return withIt === longestRising(order);
}

/**
 * Whether a node, and every block around it, keeps its place among the
 * siblings stored beside it. A lock holds where its block sits on the page,
 * so reordering an unlocked section that holds it moves it as much as
 * reordering the block itself. Read only once the chains agree, so the two
 * ancestries name the same blocks level by level.
 */
function samePlaceAtEveryLevel(stored: Placed, written: Placed): boolean {
  if (!samePlaceAmongSiblings(stored.id, stored.siblings, written.siblings)) {
    return false;
  }
  return stored.ancestors.every((ancestor, level) =>
    samePlaceAmongSiblings(
      ancestor,
      stored.ancestorSiblings[level] ?? [],
      written.ancestorSiblings[level] ?? []
    )
  );
}

/** A node's id, when the entry is a record carrying a usable one. */
function idOf(entry: unknown): string | undefined {
  if (!isPlainRecord(entry)) return undefined;
  const id = entry.id;
  return typeof id === "string" && id !== "" ? id : undefined;
}

/** A node's slots as name and children, skipping anything that is not a list. */
function slotsOf(
  node: Readonly<Record<string, unknown>>
): [string, readonly unknown[]][] {
  const slots = node.slots;
  if (!isPlainRecord(slots)) return [];
  const found: [string, readonly unknown[]][] = [];
  for (const [slot, children] of Object.entries(slots)) {
    if (Array.isArray(children)) found.push([slot, children]);
  }
  return found;
}

/** The top-level nodes of a forest, placed, in document order. */
function rootsOf(forest: unknown): Placed[] {
  if (!isPlainRecord(forest) || !Array.isArray(forest.nodes)) return [];
  const roots: Placed[] = [];
  const siblings = idsOf(forest.nodes as readonly unknown[]);
  (forest.nodes as readonly unknown[]).forEach((entry, index) => {
    const id = idOf(entry);
    if (id === undefined || !isPlainRecord(entry)) return;
    roots.push({
      node: entry,
      id,
      path: pointer("/nodes", index),
      chain: [],
      ancestors: [],
      siblings,
      ancestorSiblings: [],
    });
  });
  return roots;
}

/** The children of a placed node, placed, in document order. */
function childrenOf(parent: Placed): Placed[] {
  const placed: Placed[] = [];
  for (const [slot, children] of slotsOf(parent.node)) {
    const siblings = idsOf(children);
    children.forEach((child, index) => {
      const id = idOf(child);
      if (id === undefined || !isPlainRecord(child)) return;
      placed.push({
        node: child,
        id,
        path: pointer(pointer(pointer(parent.path, "slots"), slot), index),
        chain: [...parent.chain, parent.id, slot],
        ancestors: [...parent.ancestors, parent.id],
        siblings,
        ancestorSiblings: [...parent.ancestorSiblings, parent.siblings],
      });
    });
  }
  return placed;
}

/**
 * Every node in a forest, outermost first, with its path and ancestry.
 *
 * Iterative and bounded, because the value under judgement is a writer's and
 * has not been vouched for: a deep document would otherwise exhaust the stack,
 * and one built in memory with a cycle would never end. A node met twice is
 * read once, and a walk that runs out of budget simply stops, which can only
 * leave a locked node unfound and so report it removed: the refusing side.
 */
function placedNodes(forest: unknown): Placed[] {
  const placed: Placed[] = [];
  const seen = new Set<unknown>();
  // Reversed onto a stack, so the walk reads them in document order.
  const pending = rootsOf(forest).reverse();
  while (pending.length > 0 && placed.length < MAX_VALUE_PARTS) {
    const current = pending.pop();
    if (current === undefined || seen.has(current.node)) continue;
    seen.add(current.node);
    placed.push(current);
    // One at a time: a spread of a very wide slot overflows the call's
    // argument limit.
    for (const child of childrenOf(current).reverse()) pending.push(child);
  }
  return placed;
}

/** A node's own fields, without its children and without its lock. */
function ownFields(
  node: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "slots" || key === "locked") continue;
    fields[key] = value;
  }
  return fields;
}

/** The slot names a node holds, an absent `slots` read as none. */
function slotNames(node: Readonly<Record<string, unknown>>): string[] {
  return isPlainRecord(node.slots) ? Object.keys(node.slots).sort() : [];
}

/**
 * Pairs one slot's children for comparison, or answers `false` when the slot
 * already differs. A slot holding something other than a list is compared as
 * the value it is.
 */
function pairSlot(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
  name: string,
  pairs: [unknown, unknown][]
): boolean {
  const leftChildren = (left.slots as Record<string, unknown>)[name];
  const rightChildren = (right.slots as Record<string, unknown>)[name];
  if (!Array.isArray(leftChildren) || !Array.isArray(rightChildren)) {
    return sameValueInAnyKeyOrder(leftChildren, rightChildren);
  }
  if (leftChildren.length !== rightChildren.length) return false;
  leftChildren.forEach((child, index) => {
    pairs.push([child, rightChildren[index]]);
  });
  return true;
}

/**
 * The child pairs two nodes still have to agree on, or `null` when their own
 * fields (every lock aside) or their slot names already differ.
 */
function childPairs(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>
): [unknown, unknown][] | null {
  if (!sameValueInAnyKeyOrder(ownFields(left), ownFields(right))) return null;
  const names = slotNames(left);
  if (!sameValueInAnyKeyOrder(names, slotNames(right))) return null;
  const pairs: [unknown, unknown][] = [];
  for (const name of names) {
    if (!pairSlot(left, right, name, pairs)) return null;
  }
  return pairs;
}

/**
 * Whether two subtrees hold the same nodes in the same places, every `locked`
 * flag aside.
 *
 * Pairwise and iterative: each pair of nodes compares its own fields, then its
 * slot names, then queues its children pair by pair. Copying each subtree
 * without its locks first would allocate the whole subtree twice to answer a
 * question the first differing field settles.
 */
function sameApartFromLocks(
  stored: Readonly<Record<string, unknown>>,
  written: Readonly<Record<string, unknown>>
): boolean {
  const pending: [unknown, unknown][] = [[stored, written]];
  for (let compared = 1; compared <= MAX_VALUE_PARTS; compared += 1) {
    const pair = pending.pop();
    if (pair === undefined) return true;
    const [left, right] = pair;
    if (!isPlainRecord(left) || !isPlainRecord(right)) {
      if (!sameValueInAnyKeyOrder(left, right)) return false;
      continue;
    }
    const pairs = childPairs(left, right);
    if (pairs === null) return false;
    for (const next of pairs) pending.push(next);
  }
  // Past the budget: answered "different", the refusing side.
  return false;
}

/** Whether two ancestor chains name the same ancestors and slots. */
function sameChain(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((part, index) => part === right[index])
  );
}

/** The name an author gave a node in Layers, or else its type. */
function labelOf(node: Readonly<Record<string, unknown>>): string {
  if (typeof node.name === "string" && node.name.trim() !== "") {
    return node.name;
  }
  return typeof node.type === "string" ? node.type : "a block";
}

/** How the written node breaks the stored lock, or `undefined` if it does not. */
function changeOf(
  stored: Placed,
  written: Placed | undefined
): LayersLockChangeKind | undefined {
  if (written === undefined) return "removed";
  // Unlocked in this same write: the one way past the lock.
  if (written.node.locked !== true) return undefined;
  if (!sameChain(stored.chain, written.chain)) return "moved";
  if (!samePlaceAtEveryLevel(stored, written)) return "moved";
  if (!sameApartFromLocks(stored.node, written.node)) return "changed";
  return undefined;
}

/**
 * Every node locked in `stored` that `written` changes, moves or removes
 * without unlocking it, outermost first.
 *
 * A locked node inside another one already reported is not reported again: a
 * change deep inside a locked section is one change, and naming the section
 * says where to unlock.
 *
 * Either argument may be anything: a value no forest can be read from holds
 * no locks, and a written value holding no forest holds none of the stored
 * locked nodes, which are then reported removed.
 *
 * @param written - the document a write would store
 * @param stored - the document it would replace
 * @returns the broken locks, empty when the write keeps every one
 */
export function layersLockChanges(
  written: unknown,
  stored: unknown
): LayersLockChange[] {
  const locked = placedNodes(stored).filter(
    entry => entry.node.locked === true
  );
  // Most stored documents hold no lock, and then the write is not walked.
  if (locked.length === 0) return [];
  const byId = new Map<string, Placed>();
  for (const entry of placedNodes(written)) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  const reported = new Set<string>();
  const changes: LayersLockChange[] = [];
  for (const entry of locked) {
    if (entry.ancestors.some(id => reported.has(id))) continue;
    const kind = changeOf(entry, byId.get(entry.id));
    if (kind === undefined) continue;
    reported.add(entry.id);
    changes.push({
      kind,
      id: entry.id,
      label: labelOf(entry.node),
      path: entry.path,
    });
  }
  return changes;
}
