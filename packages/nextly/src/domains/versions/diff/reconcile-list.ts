/**
 * Match the items of two list-valued fields (repeatables and dynamic zones) by
 * their stable component-row id.
 *
 * This is the piece that beats index-based diffing: inserting one row marks
 * only that row added, instead of marking every row after it changed. When ids
 * are not usable (missing, or duplicated by copy-paste) it degrades to
 * positional matching rather than rendering a confidently wrong diff.
 *
 * It reports only structural presence (added / removed / both, with indices).
 * Whether a "both" item actually changed is decided by the engine after it
 * recurses into the item's fields — content and position are separate concerns.
 *
 * @module domains/versions/diff/reconcile-list
 */

/** One matched item, discriminated by whether it exists on each side. */
export type ItemMatch =
  | {
      presence: "added";
      id: string;
      afterItem: Record<string, unknown>;
      toIndex: number;
    }
  | {
      presence: "removed";
      id: string;
      beforeItem: Record<string, unknown>;
      fromIndex: number;
    }
  | {
      presence: "both";
      id: string;
      beforeItem: Record<string, unknown>;
      afterItem: Record<string, unknown>;
      fromIndex: number;
      toIndex: number;
    };

export interface ReconcileResult {
  /** "id" when both sides had unique string ids, else "positional". */
  strategy: "id" | "positional";
  items: ItemMatch[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readId(value: unknown): string | undefined {
  const id = asRecord(value).id;
  return typeof id === "string" ? id : undefined;
}

/** Every item carries a distinct string id — the precondition for id matching. */
function hasUniqueStringIds(items: unknown[]): boolean {
  const seen = new Set<string>();
  for (const item of items) {
    const id = readId(item);
    if (id === undefined || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

function reconcileByStableId(before: unknown[], after: unknown[]): ItemMatch[] {
  const beforeIndexById = new Map<string, number>();
  before.forEach((item, index) => beforeIndexById.set(readId(item)!, index));
  const afterIds = new Set(after.map(item => readId(item)!));

  const matches: ItemMatch[] = [];
  // Walk the "after" order first so the diff reads in the document's current
  // order; removed items are appended in their original order afterwards.
  after.forEach((item, toIndex) => {
    const id = readId(item)!;
    const fromIndex = beforeIndexById.get(id);
    if (fromIndex !== undefined) {
      matches.push({
        presence: "both",
        id,
        beforeItem: asRecord(before[fromIndex]),
        afterItem: asRecord(item),
        fromIndex,
        toIndex,
      });
    } else {
      matches.push({
        presence: "added",
        id,
        afterItem: asRecord(item),
        toIndex,
      });
    }
  });
  before.forEach((item, fromIndex) => {
    const id = readId(item)!;
    if (!afterIds.has(id)) {
      matches.push({
        presence: "removed",
        id,
        beforeItem: asRecord(item),
        fromIndex,
      });
    }
  });
  return matches;
}

function reconcilePositionally(
  before: unknown[],
  after: unknown[]
): ItemMatch[] {
  const matches: ItemMatch[] = [];
  const length = Math.max(before.length, after.length);
  for (let index = 0; index < length; index += 1) {
    const beforeItem = index < before.length ? before[index] : undefined;
    const afterItem = index < after.length ? after[index] : undefined;
    // A synthetic id keeps every item addressable when the real ids are unusable.
    const id = readId(afterItem) ?? readId(beforeItem) ?? `$index:${index}`;
    if (beforeItem !== undefined && afterItem !== undefined) {
      matches.push({
        presence: "both",
        id,
        beforeItem: asRecord(beforeItem),
        afterItem: asRecord(afterItem),
        fromIndex: index,
        toIndex: index,
      });
    } else if (afterItem !== undefined) {
      matches.push({
        presence: "added",
        id,
        afterItem: asRecord(afterItem),
        toIndex: index,
      });
    } else {
      matches.push({
        presence: "removed",
        id,
        beforeItem: asRecord(beforeItem),
        fromIndex: index,
      });
    }
  }
  return matches;
}

/** Match two lists by stable id, degrading to positional on unusable ids. */
export function reconcileById(
  before: unknown[],
  after: unknown[]
): ReconcileResult {
  if (hasUniqueStringIds(before) && hasUniqueStringIds(after)) {
    return { strategy: "id", items: reconcileByStableId(before, after) };
  }
  return {
    strategy: "positional",
    items: reconcilePositionally(before, after),
  };
}
