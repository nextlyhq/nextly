/**
 * Which of a document's fields a past version changed, as the editor marks
 * them.
 *
 * Read from the comparison the server already computes for the comparison
 * page, so a field marked "Changed" in the editor and one listed as changed
 * on that page are one answer, not two that could disagree.
 *
 * @module components/features/versions/version-changes
 */

import type { FieldDiff, VersionDiff } from "@admin/services/versionApi";

import type { Predecessor } from "./version-pairing";

/** What one version changed against the one it is compared with. */
export interface VersionChanges {
  /** Each changed field's comparison, by its top-level name. */
  byField: ReadonlyMap<string, FieldDiff>;
  /** How many fields the comparison covers, changed or not. */
  total: number;
  /** Fields this reader may not read were left out, so a count is a floor. */
  incomplete: boolean;
}

/**
 * Whether a field's comparison is a change worth marking. A field the reader
 * may not read arrives as `hidden` with no status of its own, so it is never
 * claimed as changed.
 */
export function isFieldChange(node: FieldDiff): boolean {
  return node.kind !== "hidden" && node.status !== "unchanged";
}

/** A framework column kept on every document, rather than an author's field. */
export function isSystemField(node: FieldDiff): boolean {
  return node.kind === "unknown" && node.reason === "system";
}

/**
 * The changes in a comparison, keyed for the form that marks them. Framework
 * columns are left out of the changes and the count: they are shown only on
 * request, so counting them, or walking to one, would point at nothing on
 * screen.
 */
export function versionChangesOf(diff: VersionDiff): VersionChanges {
  const authored = diff.fields.filter(node => !isSystemField(node));
  const byField = new Map<string, FieldDiff>();
  for (const node of authored) {
    if (isFieldChange(node)) byField.set(node.name, node);
  }
  return {
    byField,
    // Only the fields this reader may read: a withheld field is not one of
    // "the fields you can read".
    total: authored.filter(node => node.kind !== "hidden").length,
    incomplete: diff.incomplete === true,
  };
}

/**
 * The changed fields in the order a reader meets them: first those the form
 * does not lay out itself (the title, drawn in the header), then the form's
 * own, in its order. Previous and next change walk this order, so moving
 * through changes never jumps back up the page.
 *
 * @param layout - the top-level field names the form draws, in its order
 */
export function changeOrder(
  changes: VersionChanges,
  layout: readonly string[]
): string[] {
  const inLayout = new Set(layout);
  const outside = [...changes.byField.keys()].filter(
    name => !inLayout.has(name)
  );
  return [...outside, ...layout.filter(name => changes.byField.has(name))];
}

/**
 * How many fields changed, in words: the one wording every surface that counts
 * a comparison's changes uses.
 */
export function changesCountText(count: {
  changed: number;
  total: number;
  incomplete: boolean;
}): string {
  // Withheld fields may differ, so the count is said as a floor.
  return count.incomplete
    ? `${count.changed} of the ${count.total} fields you can read changed`
    : `${count.changed} of ${count.total} fields changed`;
}

/** Where reading what a version changed stands, as its bar says it. */
export type ChangesState =
  | { kind: "reading" }
  | { kind: "failed"; retry: () => void }
  | { kind: "first" }
  | { kind: "ready"; changed: number; total: number; incomplete: boolean };

/**
 * A comparison, but only the one for this pair. A query keeps the previous
 * pair's result on screen while the next loads, and that result must not
 * mark this version's fields.
 */
export function diffForPair(
  diff: VersionDiff | undefined,
  from: number | null,
  to: number
): VersionDiff | undefined {
  return diff !== undefined && diff.from === from && diff.to === to
    ? diff
    : undefined;
}

/** The state a version's bar reports, from what is known about its changes. */
export function changesStateOf(input: {
  comparedWith: Predecessor;
  failed: boolean;
  retry: () => void;
  changes: VersionChanges | null;
}): ChangesState {
  if (input.comparedWith.kind === "first") return { kind: "first" };
  if (input.failed) return { kind: "failed", retry: input.retry };
  if (input.changes === null) return { kind: "reading" };
  return {
    kind: "ready",
    changed: input.changes.byField.size,
    total: input.changes.total,
    incomplete: input.changes.incomplete,
  };
}
