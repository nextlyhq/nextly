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

/**
 * Display-relevant field configuration a value node carries so the client
 * renders it faithfully without re-deriving it from the live schema. The engine
 * already holds the correct `FieldConfig` for every node it emits (per-schema
 * even across a dynamic-zone type swap, and after flattening nameless groups),
 * so recording this here is both correct and simpler than a client re-walk.
 *
 * Only plain, serialisable data is included, never access rules or other
 * functions: the cardinality, relation targets, option labels, and date picker
 * that decide how a stored value reads.
 */
export interface FieldDisplay {
  hasMany?: boolean;
  relationTo?: string | string[];
  options?: { label?: string; value?: unknown }[];
  admin?: { date?: { pickerAppearance?: string } };
}

/** Non-text scalars hand back both sides raw; the client renders each side. */
export interface ValueFieldDiff extends FieldDiffBase {
  kind: "value";
  before: unknown;
  after: unknown;
  /**
   * Display config for the field, so the client renders cardinality, option
   * labels, and date formatting faithfully. Absent when the field carries no
   * display-relevant configuration.
   */
  display?: FieldDisplay;
}

/** A group or single component: a nested list of field diffs. */
export interface GroupFieldDiff extends FieldDiffBase {
  kind: "group";
  fields: FieldDiff[];
  /**
   * For a dynamic-zone component whose stored type changed between versions, the
   * before and after component slugs (either side is absent when the component
   * appeared or disappeared). Carried so a type swap still shows what changed
   * even when both schemas have no field values to diff. Absent for a plain
   * group or a fixed-schema component.
   */
  componentTypeBefore?: string;
  componentTypeAfter?: string;
}

/**
 * One target of a relationship. `relationTo` is present only for a polymorphic
 * relationship, where the same `id` can refer to rows in different collections,
 * so it is part of the target's identity. Resolving `id` to a human title is a
 * separate rendering concern, kept out of this engine so it stays pure and
 * dialect-free.
 */
export interface RelationTarget {
  id: string;
  relationTo?: string;
}

/** A many relationship field: a set difference of targets by identity. */
export interface SetFieldDiff extends FieldDiffBase {
  kind: "set";
  added: RelationTarget[];
  removed: RelationTarget[];
}

/**
 * One item inside a repeatable/dynamic-zone list, matched by stable id.
 *
 * `status` describes the item's CONTENT (added/removed/changed/unchanged);
 * `hasMoved` is orthogonal POSITION, because an item can be both edited and
 * reordered. This split follows the identity model Sanity uses and beats the
 * index-based matching that marks every row after an insert as changed.
 */
export interface ListItemDiff {
  /** Stable component-row UUID; identity for add/remove/move detection. */
  id: string;
  /** The component slug (`_componentType`) when the snapshot carries one. */
  componentType?: string;
  status: DiffStatus;
  /** True when the item kept its identity but changed position. */
  hasMoved?: boolean;
  /** Prior index (present when the item existed before). */
  fromIndex?: number;
  /** New index (present when the item exists after). */
  toIndex?: number;
  /** Per-field diffs; empty for a pure move or an unchanged item. */
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
