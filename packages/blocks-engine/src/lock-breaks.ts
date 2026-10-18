/**
 * Every lock break in a document, located, and the one an edit adds.
 *
 * Validation reports a lock break as an issue on a save. The editor needs the
 * same judgement before an action, as data it can word and act on: which
 * block's slot, under which lock, and what changed. So this visits validation's
 * own walk (`walkNodeForest`) and asks each node the same `slotLockBreaks`, so
 * the two reach the same nodes under the same bounds; a parity test holds them
 * to one answer on the same documents.
 *
 * An edit is refused for a break it ADDS: a document stored before locks were
 * enforced still opens, and an edit that leaves its breaks as they were is not
 * the author's to fix first. The document before the edit is a stored form of
 * the one after, so a `"contentOnly"` part it already held is kept, exactly as
 * a save keeps what the stored version holds.
 *
 * @module lock-breaks
 */
import type { BlockDocument, BlockNode } from "./document";
import { pointer } from "./issue-text";
import { DEFAULT_LIMITS, type DocumentLimits } from "./limits";
import type { NestingSource } from "./nesting";
import { isPlainRecord } from "./plain-record";
import {
  slotLockBreaks,
  typeOfChild,
  type ActiveSlotLock,
  type LockBreak,
} from "./slot-lock";
import { startingChildrenSource } from "./starting-children";
import type { SlotDefaultSource } from "./tree";
import { walkNodeForest, type QueuedNode } from "./validation";

/** What a lock judgement reads. */
export interface LockSources {
  /** The block definitions, for each slot's lock and starting blocks. */
  readonly definitions: SlotDefaultSource;
  /** The site's nesting rules, which decide the starting blocks an insert keeps. */
  readonly nesting?: NestingSource;
  /**
   * The document's stored forms, whose `"contentOnly"` values it may keep.
   * Absent, every locked slot is measured against its starting blocks alone.
   */
  readonly stored?: readonly unknown[];
  readonly limits?: DocumentLimits;
}

/** One lock break, where it is and what it breaks. */
export interface LocatedLockBreak {
  /** The issue code a save refuses it with. */
  readonly code: "locked-slot-altered" | "locked-slot-content-only";
  /** The block whose slot is locked. */
  readonly holderId: string;
  readonly holderType: string;
  readonly slot: string;
  readonly lock: ActiveSlotLock;
  /** The JSON pointer a save reports it at. */
  readonly path: string;
  /** For a membership break, the block types the slot starts with. */
  readonly starting: readonly string[];
  /**
   * For a membership break, the type of each block the slot holds, in order;
   * undefined for a block whose type cannot be read. Empty otherwise.
   */
  readonly held: readonly (string | undefined)[];
  /** For a `"contentOnly"` break, the child and what about it changed. */
  readonly index?: number;
  readonly childType?: string;
  readonly changes: readonly string[];
}

/**
 * Every lock break in `document`, in the order validation's breadth-first walk
 * meets them, bounded by the document's node cap as that walk is.
 *
 * @experimental
 */
export function lockBreaksIn(
  document: unknown,
  sources: LockSources
): LocatedLockBreak[] {
  const nodes = isPlainRecord(document) ? document.nodes : undefined;
  if (!Array.isArray(nodes)) return [];
  const maxNodes = (sources.limits ?? DEFAULT_LIMITS).maxNodes;
  const startingChildren = startingChildrenSource(
    sources.definitions,
    sources.nesting
  );
  const found: LocatedLockBreak[] = [];
  walkNodeForest(
    nodes as BlockNode[],
    maxNodes,
    { definitions: sources.definitions, stored: sources.stored },
    visit => {
      const breaks = slotLockBreaks(
        visit.node,
        visit.lock,
        sources.definitions,
        startingChildren,
        visit.counterparts
      );
      for (const lockBreak of breaks) found.push(locate(visit, lockBreak));
      // Gating decides nothing a lock does.
      return false;
    }
  );
  return found;
}

/** A break as the walk found it, placed where a save reports it. */
function locate(visit: QueuedNode, found: LockBreak): LocatedLockBreak {
  const node = visit.node as unknown as Record<string, unknown>;
  const slotPath = pointer(pointer(visit.path, "slots"), found.slot);
  const holder = {
    holderId: typeof node.id === "string" ? node.id : "",
    holderType: String(node.type),
    slot: found.slot,
  };
  if (found.kind === "membership") {
    return {
      code: "locked-slot-altered",
      ...holder,
      lock: found.lock,
      // The slot when it is stored; the node when it is not, because a
      // pointer has to resolve against the document it reports on.
      path: found.stored ? slotPath : visit.path,
      starting: found.starting,
      held: found.held.map(typeOfChild),
      changes: [],
    };
  }
  return {
    code: "locked-slot-content-only",
    ...holder,
    lock: "contentOnly",
    path: pointer(slotPath, found.index),
    starting: [],
    held: [],
    index: found.index,
    childType: found.childType,
    changes: found.changes,
  };
}

/**
 * The lock break `after` adds that `before` did not have, or undefined when
 * the edit leaves every lock as it was or better.
 *
 * `before` is a stored form of `after`, beside any the caller passes, so a
 * `"contentOnly"` part the document already held is kept, and putting a part
 * back as the block starts is always allowed.
 *
 * @experimental
 */
export function lockRefusal(
  before: BlockDocument,
  after: BlockDocument,
  sources: LockSources
): LocatedLockBreak | undefined {
  const judged = { ...sources, stored: [before, ...(sources.stored ?? [])] };
  const had = new Set(lockBreaksIn(before, judged).map(breakIdentity));
  return lockBreaksIn(after, judged).find(
    found => !had.has(breakIdentity(found))
  );
}

/**
 * A break as the before/after comparison knows it: its rule, its place and,
 * for the blocks a slot holds, which blocks those are. So a slot already
 * holding a block too many may keep it, while a second one more, or any
 * other change to what it holds, is a break of its own. Under `"insert"` the
 * order is the author's, so only which blocks it holds counts.
 */
function breakIdentity(found: LocatedLockBreak): string {
  const held = found.held.map(type => type ?? "\u0001");
  if (found.lock === "insert") held.sort();
  return [
    found.code,
    found.holderId,
    found.slot,
    found.index ?? "",
    held.join("\u0002"),
  ].join("\u0000");
}
