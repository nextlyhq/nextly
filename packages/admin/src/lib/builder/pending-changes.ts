/**
 * The Builder's pending changes: what differs between the definition as it
 * was loaded (or last saved) and the definition now, field by field identity.
 *
 * Changes are net. They are computed from the two definitions alone, never
 * from a log of what was done, so an edit that was undone, or one that put a
 * field back as it was saved, is no change.
 *
 * A field's identity is its builder id, which lasts the whole session: a
 * rename or a move keeps it.
 *
 * Each field yields at most one change of each kind. An added field's own
 * fields come with it, and a deleted container's go with it, so a container
 * added or deleted is one change, naming how many fields are inside.
 *
 * @module lib/builder/pending-changes
 */
import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { settingsSignatureOf } from "./dirty-tracking";

/** What a pending change does to one field. */
export type PendingChangeKind =
  | "added"
  | "deleted"
  | "moved"
  | "renamed"
  | "typeChanged"
  | "settings";

/** One pending change, as the count, the row marks and the review read it. */
export interface PendingChange {
  kind: PendingChangeKind;
  /** The field's builder id: the same before and after. */
  fieldId: string;
  /** The field's label now, or as saved when it is deleted. */
  label: string;
  /** The field's name now, or as saved when it is deleted. */
  name: string;
  /** For a rename, the name as saved. */
  previousName?: string;
  /** The field's type now, or as saved when it is deleted. */
  type: string;
  /** For a type change, the type as saved. */
  previousType?: string;
  /** For an added or deleted container, how many fields it holds, at any depth. */
  inside?: number;
}

/** How a row of the outline shows its field's pending changes. */
export type RowMark = "new" | "changed" | "moved" | "deleted";

/** Where one field sits in a definition. */
interface Placement {
  field: BuilderField;
  /** The containing field's id, or null at the top. */
  parentId: string | null;
}

/** Every user field of a tree by id, with where it sits. System fields never change. */
function placementsOf(
  fields: readonly BuilderField[],
  parentId: string | null = null,
  into = new Map<string, Placement>()
): Map<string, Placement> {
  for (const field of fields) {
    if (field.isSystem) continue;
    into.set(field.id, { field, parentId });
    if (field.fields) placementsOf(field.fields, field.id, into);
  }
  return into;
}

/**
 * How many of the fields a field holds, at any depth, `counts` takes: those
 * added with an added container, or deleted with a deleted one. A saved field
 * moved into a new container is its own move; one moved out of a container
 * before its delete stays.
 */
function countInside(
  field: BuilderField,
  counts: (id: string) => boolean
): number {
  return (field.fields ?? []).reduce(
    (total, child) =>
      total + (counts(child.id) ? 1 : 0) + countInside(child, counts),
    0
  );
}

/** A field's user fields in order, at every depth, parents first. */
function inOrder(fields: readonly BuilderField[]): BuilderField[] {
  return fields.flatMap(field =>
    field.isSystem ? [] : [field, ...inOrder(field.fields ?? [])]
  );
}

/**
 * At [i][j], how long the longest run of ids common to `before` from i and
 * `after` from j is, keeping their order. A plain dynamic programme: sibling
 * lists are short.
 */
function commonRunLengths(
  before: readonly string[],
  after: readonly string[]
): number[][] {
  const table = before.map(() => after.map(() => 0));
  const at = (i: number, j: number) => table[i]?.[j] ?? 0;
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const row = table[i] ?? [];
    for (let j = after.length - 1; j >= 0; j -= 1) {
      row[j] =
        before[i] === after[j]
          ? 1 + at(i + 1, j + 1)
          : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  return table;
}

/**
 * The ids, among `ids`, that keep their order from `before` to `after`: the
 * longest common subsequence. The rest are the ones that moved, so a field
 * dragged past others is the one move, not a move of each it passed.
 */
function keptInOrder(
  before: readonly string[],
  after: readonly string[]
): Set<string> {
  const table = commonRunLengths(before, after);
  const at = (i: number, j: number) => table[i]?.[j] ?? 0;
  const kept = new Set<string>();
  for (let i = 0, j = 0; i < before.length && j < after.length; ) {
    const id = before[i];
    if (id !== undefined && id === after[j]) {
      kept.add(id);
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return kept;
}

/** The ids of saved fields whose place among their saved siblings changed. */
function movedWithinParents(
  baseline: Map<string, Placement>,
  current: Map<string, Placement>,
  baselineOrder: readonly BuilderField[],
  currentOrder: readonly BuilderField[]
): Set<string> {
  // Saved fields still under the parent they had, grouped by that parent, in
  // each definition's order.
  const stayed = (id: string) =>
    current.get(id)?.parentId === baseline.get(id)?.parentId &&
    baseline.has(id) &&
    current.has(id);
  const siblings = (
    order: readonly BuilderField[],
    placements: Map<string, Placement>
  ) => {
    const byParent = new Map<string | null, string[]>();
    for (const field of order) {
      if (!stayed(field.id)) continue;
      const parentId = placements.get(field.id)?.parentId ?? null;
      byParent.set(parentId, [...(byParent.get(parentId) ?? []), field.id]);
    }
    return byParent;
  };
  const before = siblings(baselineOrder, baseline);
  const after = siblings(currentOrder, current);
  const moved = new Set<string>();
  for (const [parentId, ids] of before) {
    const kept = keptInOrder(ids, after.get(parentId) ?? []);
    for (const id of ids) if (!kept.has(id)) moved.add(id);
  }
  return moved;
}

/** Whether `id` sits inside a field that `isIn` holds, at any depth above. */
function underAny(
  id: string,
  placements: Map<string, Placement>,
  isIn: (parentId: string) => boolean
): boolean {
  for (
    let parentId = placements.get(id)?.parentId ?? null;
    parentId !== null;
    parentId = placements.get(parentId)?.parentId ?? null
  ) {
    if (isIn(parentId)) return true;
  }
  return false;
}

/** A container's `inside` count, present only when it holds any. */
function insideOf(
  field: BuilderField,
  counts: (id: string) => boolean
): { inside?: number } {
  const inside = countInside(field, counts);
  return inside > 0 ? { inside } : {};
}

const describe = (field: BuilderField) => ({
  label: field.label ?? "",
  name: field.name ?? "",
  type: field.type,
});

/** Two definitions side by side: where each field sits in each. */
interface Comparison {
  before: Map<string, Placement>;
  after: Map<string, Placement>;
  /** Present now and not before. */
  added: (id: string) => boolean;
  /** Present before and not now. */
  deleted: (id: string) => boolean;
}

function compareFields(
  baseline: readonly BuilderField[],
  current: readonly BuilderField[]
): Comparison {
  const before = placementsOf(baseline);
  const after = placementsOf(current);
  return {
    before,
    after,
    added: id => after.has(id) && !before.has(id),
    deleted: id => before.has(id) && !after.has(id),
  };
}

/** A change of `kind` to `field`, with what the kind adds. */
function changeOf(
  kind: PendingChangeKind,
  field: BuilderField,
  extra: Partial<PendingChange> = {}
): PendingChange {
  return { kind, fieldId: field.id, ...describe(field), ...extra };
}

/** What changed in a field that was saved and is still here. */
function changesOfKept(
  field: BuilderField,
  was: BuilderField,
  moved: boolean
): PendingChange[] {
  const changes: PendingChange[] = [];
  if (moved) changes.push(changeOf("moved", field));
  if ((was.name ?? "") !== (field.name ?? "")) {
    changes.push(changeOf("renamed", field, { previousName: was.name ?? "" }));
  }
  if (was.type !== field.type) {
    changes.push(changeOf("typeChanged", field, { previousType: was.type }));
  }
  if (settingsSignatureOf(was) !== settingsSignatureOf(field)) {
    changes.push(changeOf("settings", field));
  }
  return changes;
}

/**
 * The pending changes from `baseline` to `current`: in the order of the
 * definition now, each deleted field after them in its saved order.
 */
export function pendingChanges(
  baseline: readonly BuilderField[],
  current: readonly BuilderField[]
): PendingChange[] {
  const { before, after, added, deleted } = compareFields(baseline, current);
  const baselineOrder = inOrder(baseline);
  const currentOrder = inOrder(current);
  const movedInPlace = movedWithinParents(
    before,
    after,
    baselineOrder,
    currentOrder
  );

  const changes: PendingChange[] = [];
  for (const field of currentOrder) {
    const was = before.get(field.id)?.field;
    if (was !== undefined) {
      const moved =
        before.get(field.id)?.parentId !== after.get(field.id)?.parentId ||
        movedInPlace.has(field.id);
      changes.push(...changesOfKept(field, was, moved));
    } else if (!underAny(field.id, after, added)) {
      // A field added inside an added field comes with it.
      changes.push(changeOf("added", field, insideOf(field, added)));
    }
  }
  for (const field of baselineOrder) {
    // A field deleted inside a deleted field goes with it.
    if (deleted(field.id) && !underAny(field.id, before, deleted)) {
      changes.push(changeOf("deleted", field, insideOf(field, deleted)));
    }
  }
  return changes;
}

/** " and N fields inside", for a container added or deleted with fields. */
function insideWords(change: PendingChange): string {
  if (!change.inside) return "";
  return ` and ${change.inside} ${change.inside === 1 ? "field" : "fields"} inside`;
}

/** Each kind of change in plain words, given what the field is called. */
const CHANGE_WORDS: Record<
  PendingChangeKind,
  (what: string, change: PendingChange) => string
> = {
  added: (what, change) => `added ${what}${insideWords(change)}`,
  deleted: (what, change) => `deleted ${what}${insideWords(change)}`,
  moved: what => `moved ${what}`,
  renamed: (_what, change) =>
    `renamed ${change.previousName ?? ""} to ${change.name}`,
  typeChanged: what => `changed the type of ${what}`,
  settings: what => `changed ${what}`,
};

/** One pending change in plain words, as an announcement reads it. */
function describeChange(change: PendingChange): string {
  // A field just added has neither label nor name until one is typed.
  const what = change.label || change.name || "a new field";
  return CHANGE_WORDS[change.kind](what, change);
}

/**
 * What one step from `before` to `after` did, in plain words: the change it
 * made, or how many when it made several (a move that also renamed, say).
 */
export function describeStep(
  before: readonly BuilderField[],
  after: readonly BuilderField[]
): string {
  const changes = pendingChanges(before, after);
  if (changes.length === 1 && changes[0]) return describeChange(changes[0]);
  return `${changes.length} changes`;
}

/**
 * Each changed field's marks, by id: every field inside an added container
 * is new, and every field inside a deleted one deleted. A field with no
 * pending change has no entry.
 */
export function rowMarks(
  baseline: readonly BuilderField[],
  current: readonly BuilderField[]
): Map<string, Set<RowMark>> {
  const marks = new Map<string, Set<RowMark>>();
  const mark = (id: string, rowMark: RowMark) =>
    marks.set(id, new Set([...(marks.get(id) ?? []), rowMark]));
  const { before, after, added, deleted } = compareFields(baseline, current);
  // Only the fields that came or went with the container: a saved field
  // moved into a new one is marked moved, not new.
  const markAll = (
    field: BuilderField,
    rowMark: RowMark,
    belongs: (id: string) => boolean
  ) => {
    if (belongs(field.id)) mark(field.id, rowMark);
    for (const child of field.fields ?? []) markAll(child, rowMark, belongs);
  };
  for (const change of pendingChanges(baseline, current)) {
    if (change.kind === "added") {
      const field = after.get(change.fieldId)?.field;
      if (field) markAll(field, "new", added);
    } else if (change.kind === "deleted") {
      const field = before.get(change.fieldId)?.field;
      if (field) markAll(field, "deleted", deleted);
    } else if (change.kind === "moved") {
      mark(change.fieldId, "moved");
    } else {
      mark(change.fieldId, "changed");
    }
  }
  return marks;
}
