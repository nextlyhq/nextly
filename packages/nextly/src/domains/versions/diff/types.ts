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
  /**
   * The relationship's configured display column (`targetLabelField`), carried
   * so reference hydration can honor it instead of the default label candidates.
   */
  labelField?: string;
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
   *
   * A relationship or upload node's `before`/`after` is resolved in place to the
   * value kit's display shape (`{ id, label }` or `{ id, filename, ... }`) one
   * layer up, so the client renders it through the same kit as a live value with
   * no reference-specific field on this node.
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
  /**
   * The target resolved to a display label, attached additively when hydrated.
   * Null when the target is unreadable or unlabelled, leaving the id as the
   * fallback the renderer shows.
   */
  label?: string | null;
}

/** A many relationship field: a set difference of targets by identity. */
export interface SetFieldDiff extends FieldDiffBase {
  kind: "set";
  added: RelationTarget[];
  removed: RelationTarget[];
  /**
   * Display config for the field, chiefly its `relationTo` target(s), so the
   * client and the reference hydrator know which collection a non-polymorphic
   * target belongs to without re-deriving it from the live schema (a target
   * carries its own `relationTo` only when the relation is polymorphic). Absent
   * when the field carries no display-relevant configuration.
   */
  display?: FieldDisplay;
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
  /**
   * For a row that kept its id but changed component type, the before and after
   * slugs, so the swap is visible even when neither component has field values
   * to diff. Absent when the type did not change.
   */
  componentTypeBefore?: string;
  componentTypeAfter?: string;
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
 *
 * The value is deliberately NOT carried. A field absent from the current schema
 * has no findable `access.read` rule, so redaction cannot prove the caller may
 * read it; a since-removed protected field (a salary, a token) would otherwise
 * leak its history. Only the field's name and whether it changed are exposed.
 */
export interface UnknownFieldDiff {
  kind: "unknown";
  name: string;
  status: DiffStatus;
}

/**
 * The label triple every emitted node carries, computed once with a real name.
 * Exported so the per-kind builders that live in their own modules take the
 * same shape rather than each declaring one: three declarations of one shape
 * agree today and drift silently afterwards.
 */
export interface NodeMeta {
  name: string;
  label: string;
  type: string;
}

/**
 * Whether a unit could be compared at all.
 *
 * `"unsupported"` sits beside the ordinary four because "these are the same"
 * and "I could not compare these" are different answers, and folding them
 * together lets an unreadable block read as an unchanged one to someone
 * deciding whether to restore a version.
 */
export type ComparableStatus = DiffStatus | "unsupported";

/**
 * One block of a rich-text comparison.
 *
 * A block's text is diffed word-wise into `segments`; every other property it
 * carries is compared for equality, so a change that leaves the text identical
 * — a swapped image, a repointed link, an un-bolded phrase — still reports.
 */
export interface RichTextBlockDiff {
  /** The block's node type: paragraph, heading, quote, list, ... */
  blockType: string;
  status: ComparableStatus;
  /** Word-level runs. Absent when the block could not be compared. */
  segments?: TextSegment[];
}

/**
 * A rich-text field, as a sequence of aligned blocks.
 *
 * The field's own `status` is `changed` whenever any block is unsupported: the
 * dispatcher filters unchanged fields out of a "modified only" comparison, so a
 * field reporting `unchanged` would take its own refusal off the screen.
 */
export interface RichTextFieldDiff extends FieldDiffBase {
  kind: "richText";
  blocks: RichTextBlockDiff[];
}

/** One line of a source (json or code) comparison. */
export interface SourceLineDiff {
  status: ComparableStatus;
  /** Line number on the "before" side, when the line exists there. */
  fromLine?: number;
  /** Line number on the "after" side, when the line exists there. */
  toLine?: number;
  /** Word-level runs. Absent when the line could not be compared. */
  segments?: TextSegment[];
}

/**
 * A json or code field, as a sequence of aligned lines. Carries the language so
 * the renderer knows which grammar to highlight with.
 */
export interface SourceFieldDiff extends FieldDiffBase {
  kind: "source";
  language: string;
  lines: SourceLineDiff[];
}

export type FieldDiff =
  | TextFieldDiff
  | ValueFieldDiff
  | GroupFieldDiff
  | SetFieldDiff
  | ListFieldDiff
  | RichTextFieldDiff
  | SourceFieldDiff
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
