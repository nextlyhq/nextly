/**
 * Every lock break in a document, located, and the one an edit adds.
 *
 * Validation reports a lock break as an issue on a save. The editor needs the
 * same judgement before an action, as data it can word and act on: which
 * block's slot, under which lock, and what changed. So this walks the
 * document with the rules validation applies, through the same functions
 * (`slotLockOf`, `slotLockBreaks`, `counterpartsOf`), and a parity test holds
 * the two to one answer on the same documents.
 *
 * An edit is refused for a break it ADDS: a document stored before locks were
 * enforced still opens, and an edit that leaves its breaks as they were is not
 * the author's to fix first. The document before the edit is a stored form of
 * the one after, so a `"contentOnly"` part it already held is kept, exactly as
 * a save keeps what the stored version holds.
 *
 * @module lock-breaks
 */
import type { BlockDocument } from "./document";
import { pointer } from "./issue-text";
import { DEFAULT_LIMITS, type DocumentLimits } from "./limits";
import type { NestingSource } from "./nesting";
import { isPlainRecord } from "./plain-record";
import { boundedOwnKeys, ownEntry } from "./safe-record";
import {
  slotLockBreaks,
  slotLockOf,
  type ActiveSlotLock,
  type LockBreak,
} from "./slot-lock";
import { startingChildrenSource } from "./starting-children";
import {
  counterpartsOf,
  storedFormsOf,
  type StoredForms,
} from "./stored-counterparts";
import type { SlotDefaultSource } from "./tree";
import { isNodeType } from "./validation";

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
  /** For a `"contentOnly"` break, the child and what about it changed. */
  readonly index?: number;
  readonly childType?: string;
  readonly changes: readonly string[];
}

/** A node the walk has reached, with what its place passes down. */
interface Visit {
  readonly node: unknown;
  readonly path: string;
  readonly lock: ActiveSlotLock | undefined;
  readonly counterparts: readonly Readonly<Record<string, unknown>>[];
}

/**
 * Every lock break in `document`, in the order a breadth-first walk meets
 * them, bounded by the document's node cap as validation's walk is.
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
  const stored = storedFormsOf(sources.stored, maxNodes);
  const startingChildren = startingChildrenSource(
    sources.definitions,
    sources.nesting
  );
  const found: LocatedLockBreak[] = [];
  const queue: Visit[] = nodes.slice(0, maxNodes).map((node, index) => ({
    node,
    path: pointer("/nodes", index),
    // A top-level node sits in no slot, so no lock reaches it.
    lock: undefined,
    counterparts: counterpartsOf(node, undefined, stored),
  }));
  for (let head = 0; head < queue.length; head += 1) {
    const visit = queue[head];
    const breaks = slotLockBreaks(
      visit.node,
      visit.lock,
      sources.definitions,
      startingChildren,
      visit.counterparts
    );
    for (const lockBreak of breaks) found.push(locate(visit, lockBreak));
    enqueueSlots(visit, { sources, stored, queue, maxNodes });
  }
  return found;
}

/** A break as the walk found it, placed where a save reports it. */
function locate(visit: Visit, found: LockBreak): LocatedLockBreak {
  const node = visit.node as Record<string, unknown>;
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
      changes: [],
    };
  }
  return {
    code: "locked-slot-content-only",
    ...holder,
    lock: "contentOnly",
    path: pointer(slotPath, found.index),
    starting: [],
    index: found.index,
    childType: found.childType,
    changes: found.changes,
  };
}

/** Queue a node's slot children, each with the lock its slot passes down. */
function enqueueSlots(
  visit: Visit,
  at: {
    sources: LockSources;
    stored: StoredForms | undefined;
    queue: Visit[];
    maxNodes: number;
  }
): void {
  const node = visit.node;
  if (!isPlainRecord(node) || !isPlainRecord(node.slots)) return;
  // `isNodeType`, the predicate validation's walk names a container by, so a
  // container it cannot name passes no lock here either.
  const containerType = isNodeType(node.type) ? node.type : undefined;
  for (const slot of boundedOwnKeys(node.slots, at.maxNodes) ?? []) {
    const children = ownEntry(node.slots, slot);
    if (!Array.isArray(children)) continue;
    const lock = slotLockOf(
      at.sources.definitions,
      containerType,
      slot,
      visit.lock
    );
    const slotPath = pointer(pointer(visit.path, "slots"), slot);
    for (let i = 0; i < children.length && at.queue.length < at.maxNodes; i++) {
      at.queue.push({
        node: children[i],
        path: pointer(slotPath, i),
        lock,
        counterparts: counterpartsOf(
          children[i],
          {
            holders: visit.counterparts,
            slot,
            index: i,
            contentOnly: lock === "contentOnly",
          },
          at.stored
        ),
      });
    }
  }
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

/** A break as the before/after comparison knows it: its rule and place. */
function breakIdentity(found: LocatedLockBreak): string {
  return [found.code, found.holderId, found.slot, found.index ?? ""].join(
    "\u0000"
  );
}
