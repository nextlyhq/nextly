/**
 * What a slot's lock fixes, decided in one place.
 *
 * A block locks one of its slots through `SlotSpec.lock` to fix the children
 * that slot holds. This module is that rule. Validation asks it of every slot
 * in a document it is given definitions for, and anything else deciding
 * whether a slot's children may change has to ask the same functions: two
 * readings of which slots are locked agree only until one of them learns the
 * inheritance below.
 *
 * ## What a lock is measured against
 *
 * The children the slot STARTS with, which are the ones inserting its block
 * creates from the slot's `defaultBlock`. So a lock is a property of a
 * document rather than of an edit: a stored slot holds those children or it
 * does not, and a validator can answer that for any writer from the document
 * alone. A rule about edits would need the version the document replaced, and
 * a write arriving through the API, an import or an agent reaches validation
 * with no previous version at all.
 *
 * ## Inheritance
 *
 * A slot that declares no lock takes the lock of the slot its block sits in,
 * so a locked region stays locked all the way down. `false` is a slot
 * declaring itself unlocked, which stops the inheritance, except beneath
 * `"contentOnly"`: a region whose arrangement is fixed would otherwise be
 * reopened by any block placed inside it that declares `false`.
 *
 * @module slot-lock
 */
import type { SlotLock } from "./block";

/** A lock that fixes a slot's children. `false` and no declaration fix nothing. */
export type ActiveSlotLock = Exclude<SlotLock, false>;

/** Every value a slot may declare as its lock. */
const SLOT_LOCKS: ReadonlySet<unknown> = new Set<unknown>([
  "all",
  "insert",
  "contentOnly",
  false,
]);

/**
 * Whether a value is one a slot may declare as its lock.
 *
 * The one predicate registration refuses a declaration with. A definition
 * arriving from JavaScript or JSON never had its type checked, and a value
 * outside this set would otherwise reach {@link effectiveSlotLock}, which reads
 * it as no declaration.
 */
export function isSlotLock(value: unknown): value is SlotLock {
  return SLOT_LOCKS.has(value);
}

/**
 * The lock a slot carries: its own declaration, and the lock of the slot its
 * block sits in.
 *
 * `declared` is read as the definition states it rather than trusted. A value
 * that is not a lock reads as no declaration, the way a malformed `allow` reads
 * as no restriction, because registration is where a malformed value is
 * refused and a definition supplied without registering never met that check.
 *
 * @param declared - the slot's own `lock`, as declared
 * @param inherited - the lock of the slot this slot's block sits in
 * @returns the lock that applies, or undefined when the slot's children are
 *   not fixed
 */
export function effectiveSlotLock(
  declared: unknown,
  inherited: ActiveSlotLock | undefined
): ActiveSlotLock | undefined {
  // First, so nothing a slot inside declares can loosen it.
  if (inherited === "contentOnly") return "contentOnly";
  if (declared === false) return undefined;
  if (
    declared === "all" ||
    declared === "insert" ||
    declared === "contentOnly"
  ) {
    return declared;
  }
  return inherited;
}

/**
 * Whether a locked slot holds exactly the children it starts with.
 *
 * `"all"` and `"contentOnly"` fix the children and their order, so the two
 * lists must agree position by position. `"insert"` fixes which children the
 * slot holds and lets an author reorder them, so the two must hold the same
 * types the same number of times: a slot starting with two cards and a button
 * cannot trade a card for a second button.
 *
 * Compared by TYPE, because that is all a starting child declares. An entry in
 * `defaultBlock` names a block type and never an id, and the props it starts
 * with are the author's to change.
 *
 * @param lock - the lock the slot carries
 * @param held - the type of each child the slot holds, in order; undefined for
 *   a child whose type cannot be read, which no starting child matches
 * @param starting - the types the slot starts with, in order
 */
export function holdsStartingChildren(
  lock: ActiveSlotLock,
  held: readonly (string | undefined)[],
  starting: readonly string[]
): boolean {
  if (held.length !== starting.length) return false;
  if (lock !== "insert") {
    return held.every((type, index) => type === starting[index]);
  }
  const unmatched = new Map<string, number>();
  for (const type of starting) {
    unmatched.set(type, (unmatched.get(type) ?? 0) + 1);
  }
  // The lengths already agree, so when every held child consumes one starting
  // child of its own type, no starting child is left over.
  return held.every(type => {
    if (type === undefined) return false;
    const left = unmatched.get(type) ?? 0;
    if (left === 0) return false;
    unmatched.set(type, left - 1);
    return true;
  });
}
