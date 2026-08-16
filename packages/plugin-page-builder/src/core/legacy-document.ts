/**
 * Converts a legacy nested builder document into the engine's frozen format.
 *
 * The editor was built on a document whose body is a single `root` node with
 * everything nested inside it. The engine's format, frozen and published, has
 * no synthetic root: a page IS a flat list of nodes, and document-level
 * concerns live on the envelope. Stored documents in the old shape therefore
 * need translating on read, and this module is the only place that happens.
 *
 * Nothing here drops data quietly. The two shapes are not isomorphic — the
 * engine has no home for a node's entrance motion or its raw escape-hatch
 * class, and it derives SEO rather than storing it — so a faithful conversion
 * has to LOSE things. Every loss is reported as a note rather than discarded,
 * because a migration that silently produces a smaller document is
 * indistinguishable from one that worked.
 *
 * @module core/legacy-document
 */

import type {
  Binding,
  BlockDocument,
  BlockNode,
  DocumentKind,
  NodeStyles,
  StyleValue,
  StyleValues,
} from "@nextlyhq/blocks-engine";
import { DOCUMENT_FORMAT_VERSION, isTokenRef } from "@nextlyhq/blocks-engine";

import type {
  BlockDocument as LegacyDocument,
  BlockNode as LegacyNode,
  ResponsiveStyle as LegacyResponsiveStyle,
  StyleValues as LegacyStyleValues,
} from "./types";

/**
 * One thing the conversion could not carry across, addressed to where it was.
 *
 * `path` is a node id, or `"document"` for the envelope, rather than a
 * positional path: positions change as soon as anything is edited, and these
 * notes are read after the fact.
 */
export interface ConversionNote {
  /** Node id the loss belongs to, or `"document"` for envelope-level losses. */
  path: string;
  /** The legacy field that had nowhere to go. */
  field: string;
  /** What happened to it, in terms an author or a maintainer can act on. */
  detail: string;
}

/** A converted document, plus everything the conversion could not carry. */
export interface ConversionResult {
  document: BlockDocument;
  notes: ConversionNote[];
}

/**
 * The schema version stamped on a node that never carried one.
 *
 * The engine requires `version` on every node because forgiving rendering and
 * the manifest version stamp both read it unconditionally; the legacy shape
 * made it optional. A node written before the field existed was written
 * against the block's first schema, so 1 is the truthful answer rather than a
 * placeholder — but it is still a value this module invented, so it is noted.
 */
const ASSUMED_NODE_VERSION = 1;

/**
 * Legacy document kinds that have no same-named engine kind.
 *
 * "part" was the legacy name for a reusable piece of a page — a header or a
 * footer — which the engine calls a region. The other two legacy kinds
 * ("page", "template") exist verbatim on both sides and need no entry.
 */
const KIND_RENAMES: Readonly<Record<string, DocumentKind>> = {
  part: "region",
};

/**
 * True when a value is a plain object we can walk.
 *
 * Arrays and class instances are excluded deliberately: both survive
 * `typeof v === "object"` and neither serializes back to a style value, so
 * treating them as walkable is how a style silently becomes `[]` in storage.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * True when a value is a design-token reference in the LEGACY spelling.
 *
 * Both formats reference a token by a single string property; only the key
 * differs (`token` against the engine's `$token`). The check is the same shape
 * as the engine's own predicate, and for the same reason: an array or a class
 * instance carrying the key would serialize to something that is no longer a
 * reference, so the token would be lost on the way to storage.
 */
function isLegacyTokenRef(value: unknown): value is { token: string } {
  return isPlainObject(value) && typeof value.token === "string";
}

/**
 * Narrows an arbitrary stored value to something the engine's style envelope
 * accepts, or rejects it.
 *
 * This is a real runtime boundary rather than a formality. The legacy
 * `StyleValues` is a closed interface of named properties and the engine's is
 * an open record of `StyleValue`, so the two are not assignable in either
 * direction, and the data being read was written by an older version that its
 * own type no longer describes. Anything unrecognised is refused here so it
 * cannot reach storage and fail validation on the next read instead.
 */
function toStyleValue(value: unknown): StyleValue | undefined {
  if (typeof value === "string" || typeof value === "number") return value;
  if (isTokenRef(value)) return value;
  // A token reference has to be recognised BEFORE the generic object walk
  // below, because the two spellings differ only in the key: the legacy
  // control wrote `{ token }` and the engine's predicate reads `{ $token }`.
  // Left to the walk, a token would survive as an ordinary nested object the
  // engine no longer recognises as a reference — still present, still
  // well-formed, and no longer a token, which is the shape of loss a
  // structural comparison cannot see.
  if (isLegacyTokenRef(value)) return { $token: value.token };
  if (!isPlainObject(value)) return undefined;

  const nested: Record<string, StyleValue> = {};
  for (const [key, raw] of Object.entries(value)) {
    const converted = toStyleValue(raw);
    if (converted !== undefined) nested[key] = converted;
  }
  // An object whose every member was refused carries nothing. Emitting `{}`
  // would record a style that sets no property, which reads downstream as "the
  // author styled this" and suppresses inheritance.
  return Object.keys(nested).length > 0 ? nested : undefined;
}

/** One breakpoint's worth of values, with anything unrepresentable refused. */
function toStyleValues(legacy: LegacyStyleValues): StyleValues | undefined {
  const values: Record<string, StyleValue> = {};
  for (const [key, raw] of Object.entries(legacy)) {
    if (raw === undefined) continue;
    const converted = toStyleValue(raw);
    if (converted !== undefined) values[key] = converted;
  }
  return Object.keys(values).length > 0 ? values : undefined;
}

/** A legacy per-breakpoint style map as one state of the engine's envelope. */
function toStateStyles(
  legacy: LegacyResponsiveStyle | undefined
): Partial<Record<string, StyleValues>> | undefined {
  if (!legacy) return undefined;
  const byBreakpoint: Record<string, StyleValues> = {};
  for (const [breakpoint, values] of Object.entries(legacy)) {
    if (!values) continue;
    const converted = toStyleValues(values);
    if (converted) byBreakpoint[breakpoint] = converted;
  }
  return Object.keys(byBreakpoint).length > 0 ? byBreakpoint : undefined;
}

/**
 * A node's styles, folding the legacy pair of maps into the engine's
 * state-keyed envelope.
 *
 * The legacy shape carried the resting styles and the hover styles as two
 * separate fields; the engine keys both by state under one field. `base` and
 * `hover` are the two states that had legacy homes — `focus` and `active`
 * exist in the engine but nothing could have written them, so they are absent
 * rather than empty.
 */
function toNodeStyles(node: LegacyNode): NodeStyles | undefined {
  const base = toStateStyles(node.style);
  const hover = toStateStyles(node.styleHover);
  if (!base && !hover) return undefined;
  const styles: NodeStyles = {};
  if (base) styles.base = base;
  if (hover) styles.hover = hover;
  return styles;
}

/**
 * A node's bindings, rewritten onto the engine's binding contract.
 *
 * The legacy shape had one binding source, spelled "field", and addressed it
 * with `path`; the engine names the path `$bind` and models the source as a
 * union. So every legacy binding maps onto exactly one engine binding.
 *
 * That source is `item`, NOT `entry`, and the difference decides whether a
 * repeated block shows its own row. Legacy bindings resolve only inside a
 * collection loop — the renderer calls `resolveBindings(node, item)` when an
 * item is in scope and uses the raw props otherwise — so "field" always meant
 * the current loop item. The engine's `entry` is the entry owning the
 * document, which for a repeated block is the page rather than the row, so
 * converting to `entry` would leave every repetition showing the same values.
 *
 * The display `transform` does not survive. It was an unparsed string like
 * "date:MMM d, yyyy", and the engine's `format` is structured and
 * locale-aware; inventing a parse for the legacy spelling would guess at
 * values an author never confirmed, so it is reported instead.
 */
function toBindings(
  node: LegacyNode,
  notes: ConversionNote[]
): Record<string, Binding> | undefined {
  if (!node.bindings) return undefined;

  const bindings: Record<string, Binding> = {};
  for (const [prop, legacy] of Object.entries(node.bindings)) {
    bindings[prop] = { source: "item", $bind: legacy.path };
    if (legacy.transform !== undefined) {
      notes.push({
        path: node.id,
        field: `bindings.${prop}.transform`,
        detail: `Display transform "${legacy.transform}" was dropped; re-apply it as a binding format.`,
      });
    }
  }
  return bindings;
}

/**
 * Per-breakpoint visibility, with unset breakpoints removed.
 *
 * The legacy map was partial, so a breakpoint could be present with the value
 * `undefined`. The engine's map is total in its value type: an explicit
 * `undefined` there is not "inherit", it is a breakpoint recorded as having no
 * answer, which nothing downstream knows how to read.
 */
function toDevices(
  visibility: NonNullable<LegacyNode["visibility"]>
): Record<string, boolean> {
  const devices: Record<string, boolean> = {};
  for (const [breakpoint, visible] of Object.entries(visibility)) {
    if (typeof visible === "boolean") devices[breakpoint] = visible;
  }
  return devices;
}

/** Records the legacy node fields the engine has no home for. */
function noteNodeLosses(node: LegacyNode, notes: ConversionNote[]): void {
  if (node.motion !== undefined) {
    notes.push({
      path: node.id,
      field: "motion",
      detail:
        "Entrance motion has no engine equivalent and was dropped. Re-apply it once motion is part of the frozen format.",
    });
  }
  if (node.customClass !== undefined && node.customClass !== "") {
    notes.push({
      path: node.id,
      field: "customClass",
      detail: `Raw class "${node.customClass}" was dropped. The engine references site-global named classes by id, so a literal class name cannot be carried across.`,
    });
  }
  if (node.definitionVersion === undefined) {
    notes.push({
      path: node.id,
      field: "version",
      detail: `No schema version was stored; assumed ${ASSUMED_NODE_VERSION}. Verify if this block's schema has since changed.`,
    });
  }
}

/** One node and everything beneath it. */
function toEngineNode(node: LegacyNode, notes: ConversionNote[]): BlockNode {
  noteNodeLosses(node, notes);

  const converted: BlockNode = {
    id: node.id,
    type: node.type,
    version: node.definitionVersion ?? ASSUMED_NODE_VERSION,
    props: node.props,
  };

  const styles = toNodeStyles(node);
  if (styles) converted.styles = styles;
  const bindings = toBindings(node, notes);
  if (bindings) converted.bindings = bindings;
  if (node.name !== undefined) converted.name = node.name;
  if (node.locked !== undefined) converted.locked = node.locked;
  if (node.customCss !== undefined) converted.customCss = node.customCss;
  if (node.cssId !== undefined) converted.cssId = node.cssId;
  if (node.attributes) converted.attributes = node.attributes;

  // Both sides key per-breakpoint visibility by breakpoint id; the engine
  // nests it under `devices` so that conditional visibility can live beside it
  // without the two competing for the same keys.
  if (node.visibility) {
    converted.visibility = { devices: toDevices(node.visibility) };
  }

  if (node.slots) {
    const slots: Record<string, BlockNode[]> = {};
    for (const [slot, children] of Object.entries(node.slots)) {
      // A slot that exists with no children is not the same as a slot that
      // does not exist: the first is an empty region an author can drop into,
      // the second is a region this block does not have. Preserving the key
      // with an empty array is what keeps them distinguishable.
      slots[slot] = (children ?? []).map(child => toEngineNode(child, notes));
    }
    converted.slots = slots;
  }

  return converted;
}

/**
 * True when a record carries nothing, whether by being absent or by being empty.
 *
 * The two are the same fact about authorship and different values in storage,
 * because clearing the last entry leaves the key behind.
 */
function isAbsentRecord(value: Record<string, string> | undefined): boolean {
  return value === undefined || Object.keys(value).length === 0;
}

/**
 * True when the root node is the editor's synthetic wrapper rather than a
 * block the author put there.
 *
 * The legacy editor seeded every document with an empty `core/container` whose
 * only purpose was to give the tree a single root. Promoting that wrapper's
 * children to the top level is the whole point of the conversion; promoting a
 * container the AUTHOR added would silently unwrap their layout. The two are
 * told apart by whether the wrapper carries anything of its own.
 */
function isSyntheticRoot(root: LegacyNode): boolean {
  return (
    root.type === "core/container" &&
    Object.keys(root.props).length === 0 &&
    root.bindings === undefined &&
    root.customClass === undefined &&
    root.motion === undefined &&
    root.name === undefined &&
    root.cssId === undefined &&
    // An EMPTY attribute map is absent metadata, not authorship. Clearing the
    // last attribute in the legacy editor stores `{}` rather than removing the
    // field, so a strict undefined check reads an otherwise untouched wrapper
    // as authored and preserves a `core/container` that has no behaviour to
    // preserve.
    isAbsentRecord(root.attributes) &&
    root.visibility === undefined &&
    root.locked !== true
  );
}

/**
 * Converts a legacy nested document to the engine's flat format.
 *
 * The root node is unwrapped only when it is the editor's own synthetic
 * container. Its styling does not vanish with it: the engine's envelope has a
 * `settings.styles` slot for exactly this — page-scoped styles with no owning
 * node — so a styled wrapper becomes page styling rather than a lost
 * rectangle. A root the author built is kept as a real top-level node, because
 * unwrapping it would change how the page renders.
 */
export function toEngineDocument(legacy: LegacyDocument): ConversionResult {
  const notes: ConversionNote[] = [];
  const legacyKind = legacy.kind ?? "page";
  const kind = KIND_RENAMES[legacyKind] ?? (legacyKind as DocumentKind);

  if (KIND_RENAMES[legacyKind]) {
    notes.push({
      path: "document",
      field: "kind",
      detail: `Kind "${legacyKind}" has no engine equivalent and was recorded as "${kind}".`,
    });
  }

  const document: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind,
    nodes: [],
  };

  const root = legacy.root;
  if (isSyntheticRoot(root)) {
    // Only the default slot has a top level to be promoted to. Any other slot
    // on the synthetic wrapper has no destination, so its contents are
    // reported rather than folded into the page in an order nobody chose.
    const { default: mainChildren, ...otherSlots } = root.slots ?? {};
    document.nodes = (mainChildren ?? []).map(child =>
      toEngineNode(child, notes)
    );

    for (const [slot, children] of Object.entries(otherSlots)) {
      if (children && children.length > 0) {
        notes.push({
          path: root.id,
          field: `slots.${slot}`,
          detail: `${children.length} block(s) sat in a non-default slot on the document wrapper and had no top-level position to move to.`,
        });
      }
    }

    const rootStyles = toNodeStyles(root);
    if (rootStyles || root.customCss !== undefined) {
      document.settings = {};
      if (rootStyles) document.settings.styles = rootStyles;
      if (root.customCss !== undefined) {
        document.settings.customCss = root.customCss;
      }
    }
  } else {
    document.nodes = [toEngineNode(root, notes)];
    notes.push({
      path: root.id,
      field: "root",
      detail:
        "The document root carried its own configuration, so it was kept as a top-level block rather than unwrapped.",
    });
  }

  if (legacy.assets) document.assets = legacy.assets;

  if (legacy.settings?.seo !== undefined) {
    notes.push({
      path: "document",
      field: "settings.seo",
      detail:
        "Stored SEO values were dropped. The engine derives SEO from document content rather than storing it.",
    });
  }
  if (legacy.locale !== undefined) {
    notes.push({
      path: "document",
      field: "locale",
      detail: `Authoring locale "${legacy.locale}" was dropped; localization is carried outside the document.`,
    });
  }
  if (legacy.translationGroup !== undefined) {
    notes.push({
      path: "document",
      field: "translationGroup",
      detail: `Translation group "${legacy.translationGroup}" was dropped; localization is carried outside the document.`,
    });
  }

  return { document, notes };
}

/**
 * True when a stored value is a legacy document rather than an engine one.
 *
 * The two envelopes do not share their format-stamp key — the legacy shape
 * spells it `version` and carries `root`, the engine spells it `formatVersion`
 * and carries `nodes` — so presence alone separates them with no version
 * number to compare and no ambiguity to resolve. That is what lets a
 * migration run on documents written before anyone thought to stamp them.
 */
export function isLegacyDocument(value: unknown): value is LegacyDocument {
  return (
    isPlainObject(value) &&
    !("nodes" in value) &&
    isLegacyNode((value as { root?: unknown }).root)
  );
}

/**
 * True when a value carries the node fields the conversion DEREFERENCES.
 *
 * The guard has to promise what the narrowed type promises, not merely that
 * something called `root` is an object. `toEngineDocument` reads `props`,
 * `type` and `id` without checking them, on the strength of this predicate —
 * so a stored value of `{ root: {} }` would satisfy a shallower guard, narrow
 * to `LegacyDocument` with TypeScript's blessing, and then throw partway
 * through the walk. A migration that throws on a corrupt row turns a
 * repairable document into a failed migration; refusing it here makes the same
 * row a controlled rejection the caller can report and skip.
 *
 * Children are deliberately NOT walked. This runs on every stored value to
 * decide which format it is, and a deep validation would make that decision
 * cost a full tree traversal; the engine's own validator owns depth checking,
 * and a malformed descendant surfaces there rather than being silently
 * reclassified as an engine document here.
 */
function isLegacyNode(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    isPlainObject(value.props)
  );
}
