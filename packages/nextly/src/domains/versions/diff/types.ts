/**
 * Wire shape of a comparison between two content-version snapshots.
 *
 * Kept UI-independent on purpose: the admin diff renderer and (later) a paid
 * approval-workflow "what changed since submission" view both consume this same
 * typed tree, so it lives in core and is exported from the package surface. The
 * engine that produces it (`compute-diff.ts`) is a pure function; redaction and
 * access live one layer up in the dispatcher.
 *
 * @module domains/versions/diff/types
 */

/** Whether a field (or list item) was added, removed, changed, or left alone. */
export type DiffStatus = "added" | "removed" | "changed" | "unchanged";

/** List items add "moved" on top of the scalar statuses (same id, new index). */
export type ListItemStatus = DiffStatus | "moved";

/**
 * One run of a word-level text diff. `op` follows diff-match-patch:
 * -1 = present only on the left (deleted), 0 = unchanged, 1 = present only on
 * the right (inserted).
 */
export type TextSegment = { op: -1 | 0 | 1; text: string };

interface FieldDiffBase {
  /** Field name (the snapshot key). */
  name: string;
  /** Human label, resolved from `field.label ?? field.name`. */
  label: string;
  /** The field's declared type, so the renderer can pick a display. */
  type: string;
  status: DiffStatus;
}

/** Text-like fields carry pre-computed segments so the client never diffs. */
export interface TextFieldDiff extends FieldDiffBase {
  kind: "text";
  segments: TextSegment[];
}

/** Non-text scalars hand back both sides raw; the client renders each side. */
export interface ValueFieldDiff extends FieldDiffBase {
  kind: "value";
  before: unknown;
  after: unknown;
}

/** A group or single component: a nested list of field diffs. */
export interface GroupFieldDiff extends FieldDiffBase {
  kind: "group";
  fields: FieldDiff[];
}

/**
 * A many relationship / m2m field: a set difference of raw target ids.
 * Resolving ids to human titles is deliberately out of scope here (task 022,
 * reference hydration), which keeps this engine pure and dialect-free.
 */
export interface SetFieldDiff extends FieldDiffBase {
  kind: "set";
  added: string[];
  removed: string[];
}

/** One item inside a repeatable/dynamic-zone list, matched by stable id. */
export interface ListItemDiff {
  /** Stable component-row UUID; identity for add/remove/move detection. */
  id: string;
  /** The component slug (`_componentType`) when the snapshot carries one. */
  componentType?: string;
  status: ListItemStatus;
  /** Set only for a "moved" item. */
  fromIndex?: number;
  toIndex?: number;
  /** Per-field diffs for a changed item; empty for a pure move or unchanged. */
  fields: FieldDiff[];
}

/** A repeatable field or dynamic zone: items matched by id. */
export interface ListFieldDiff extends FieldDiffBase {
  kind: "list";
  items: ListItemDiff[];
}

/**
 * A snapshot key with no matching field in the CURRENT schema (a field deleted
 * since capture). Surfaced rather than dropped so a diff never silently hides
 * that something changed.
 */
export interface UnknownFieldDiff {
  kind: "unknown";
  name: string;
  status: DiffStatus;
  before: unknown;
  after: unknown;
}

export type FieldDiff =
  | TextFieldDiff
  | ValueFieldDiff
  | GroupFieldDiff
  | SetFieldDiff
  | ListFieldDiff
  | UnknownFieldDiff;

/** The full comparison of version `from` against version `to`. */
export interface VersionDiff {
  from: number;
  to: number;
  /** The (single) locale both snapshots belong to; null for unlocalized docs. */
  locale: string | null;
  /** True when any field node is not "unchanged". */
  hasChanges: boolean;
  fields: FieldDiff[];
}
