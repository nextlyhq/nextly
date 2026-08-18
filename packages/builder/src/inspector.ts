/**
 * What the selected block exposes for editing, and the patch that changes it.
 *
 * Pure, for the reason every rule in this package is: which controls a block
 * offers, in what order, carrying which values, is derivation — and a component
 * test in jsdom cannot separate a correct answer from a plausible wrong one,
 * because both render a column of inputs.
 *
 * **A block declares its own editable surface.** `props` on the definition maps
 * each prop name to a `PropSchema`, and the schema's `type` decides the
 * control. Nothing here holds a list of which blocks have which fields: a
 * third-party block gets an inspector by declaring its props, exactly as a
 * first-party one does.
 *
 * @module inspector
 */

import {
  getBlock,
  findNode,
  type BlockDocument,
  type BlockNode,
  type PropSchema,
} from "@nextlyhq/blocks-engine";

import { blockLabel } from "./inserter";
import type { BuilderOp, NodePatch } from "./ops";

/**
 * The prop types this inspector can draw a control for.
 *
 * Named as a set rather than inferred from what the switch happens to handle,
 * so an unsupported prop is a KNOWN gap rather than a silent fallthrough. A
 * block declaring `type: "array"` still appears in the panel — the author is
 * told the prop exists and is not editable here — because omitting it entirely
 * would present an incomplete block as a complete one.
 */
export const SUPPORTED_PROP_TYPES = [
  "text",
  "textarea",
  "url",
  "number",
  "checkbox",
  "select",
] as const;

export type SupportedPropType = (typeof SUPPORTED_PROP_TYPES)[number];

/** One editable prop, with everything a control needs to draw itself. */
export interface EditableProp {
  readonly name: string;
  readonly schema: PropSchema;
  /** The node's current value, which may be absent. */
  readonly value: unknown;
  /**
   * Whether this inspector can draw a control for it.
   *
   * Carried rather than recomputed by the panel: the panel would have to repeat
   * the membership test, and the two would disagree the first time this set
   * gained a member.
   */
  readonly supported: boolean;
  /** The options a `select` offers, empty for every other type. */
  readonly options: readonly string[];
}

/**
 * What a block is, as distinct from what it holds.
 *
 * `name` and `locked` are fields on the NODE rather than entries in `props`, so
 * no `PropSchema` describes them and the prop loop below cannot reach them.
 * They are also the two the layers panel already displays — and until this
 * existed, nothing in the editor could set either, so the panel showed
 * information the editor had no way to produce.
 */
export interface BlockIdentity {
  /** The author's own name for this instance, empty when they have not given one. */
  readonly name: string;
  readonly locked: boolean;
}

/** The selected block, as something to edit. */
export interface BlockInspection {
  readonly nodeId: string;
  readonly blockName: string;
  /** What the block IS, beside what it holds. */
  readonly identity: BlockIdentity;
  /** What to title the panel: the block's label, or its name. */
  readonly label: string;
  /**
   * Props in the order the definition declares them.
   *
   * Declaration order rather than alphabetical: a block author writes a heading
   * before its level and a button before its destination, and sorting that into
   * alphabetical order rearranges a form somebody designed.
   */
  readonly props: readonly EditableProp[];
}

/** Read a schema's `options`, which is untyped by construction. */
function optionsOf(schema: PropSchema): readonly string[] {
  const declared = schema.options;
  if (!Array.isArray(declared)) return [];
  return declared.filter(
    (option): option is string => typeof option === "string"
  );
}

/**
 * How a lock reads across a whole selection.
 *
 * `"mixed"` is a real third state, not a rounding of the other two: some
 * selected blocks are locked and some are not, and a checkbox showing either
 * on or off there would tell the author something false about half of what
 * they have selected. ARIA models it as `aria-checked="mixed"`, and the first
 * click from mixed LOCKS everything — the reading every file manager and design
 * tool gives it, because the alternative is a first click that appears to do
 * nothing to half the selection.
 */
export type LockState = "locked" | "unlocked" | "mixed";

/**
 * The lock across a set.
 *
 * Ids the document no longer holds are skipped rather than counted as
 * unlocked. An undo removing a selected block is routine, and counting a
 * missing one as unlocked would report `mixed` for a set that is entirely
 * locked.
 */
export function lockStateOf(
  document: BlockDocument,
  ids: readonly string[]
): LockState {
  let locked = 0;
  let seen = 0;
  for (const id of ids) {
    const node = findNode(document.nodes, id);
    if (node === undefined) continue;
    seen += 1;
    if (node.locked === true) locked += 1;
  }
  if (seen === 0 || locked === 0) return "unlocked";
  return locked === seen ? "locked" : "mixed";
}

/**
 * Describe the selected block for editing, or `null` when there is nothing to
 * edit.
 *
 * `null` for no selection, for an id the document no longer holds, and for a
 * block the registry does not know — the last because an unregistered block's
 * props have no schemas, so every control would have to be guessed from the
 * stored value's runtime type. Guessing produces a text box for a number and
 * silently rewrites the value on save.
 */
export function inspectSelection(
  document: BlockDocument,
  selectedId: string | null
): BlockInspection | null {
  if (selectedId === null) return null;

  const node = findNode(document.nodes, selectedId);
  if (node === undefined) return null;

  const definition = getBlock(node.type);
  if (definition === undefined) return null;

  const declared = definition.props ?? {};
  const props = Object.entries(declared).flatMap<EditableProp>(
    ([name, schema]) => {
      if (schema === undefined) return [];
      return [
        {
          name,
          schema,
          value: node.props[name],
          supported: (SUPPORTED_PROP_TYPES as readonly string[]).includes(
            schema.type
          ),
          options: optionsOf(schema),
        },
      ];
    }
  );

  return {
    nodeId: node.id,
    blockName: node.type,
    identity: { name: node.name ?? "", locked: node.locked === true },
    // The same name the palette offered and the layers panel shows. Reading
    // `editor.label ?? node.type` here instead was a second rule that agreed
    // only for blocks which declare a label: an unlabelled third-party block
    // was "Collection loop" in the palette and `acme/collection-loop` here.
    label: blockLabel(node.type),
    props,
  };
}

/**
 * The patch that sets one prop.
 *
 * **The whole props object, not the one key.** `updateNode` merges at the top
 * level — `{ ...node, ...patch }` — so a patch carrying `{ props: { text } }`
 * REPLACES the node's props and drops every other one. Editing a heading's text
 * would silently discard its level.
 *
 * Built here rather than in the panel so that fact is stated once. A caller
 * assembling its own patch has to know a merge rule that is two files away, and
 * the failure is silent: the edit works and the other props are gone.
 */
export function propPatch(
  node: BlockNode,
  name: string,
  value: unknown
): NodePatch {
  return { props: { ...node.props, [name]: value } };
}

/**
 * The op that names a block, or takes its name away.
 *
 * An empty name UNSETS the field rather than storing `""`. The field is
 * optional, so absent is what "no name" already means everywhere else — a
 * stored empty string would be a second spelling of the same state, and
 * `layerLabel` would have to know about both to avoid rendering a blank row.
 *
 * Trimmed, because a name of spaces is the same thing wearing a disguise: it
 * satisfies a non-empty check, renders as nothing, and cannot be typed to in
 * the layers panel's typeahead.
 */
export function renameOp(id: string, name: string): BuilderOp {
  const trimmed = name.trim();
  return trimmed === ""
    ? { kind: "update", id, patch: {}, unset: ["name"] }
    : { kind: "update", id, patch: { name: trimmed } };
}

/**
 * The op that locks a block, or releases it.
 *
 * Unlocking UNSETS rather than storing `false`, for the reason above and one
 * more: `locked` is absent on every node in every document written so far, so
 * storing `false` on release would make an unlock a WRITE to every block an
 * author ever touched, and the documents would grow a field that means what
 * their absence already meant.
 */
export function lockOp(id: string, locked: boolean): BuilderOp {
  return locked
    ? { kind: "update", id, patch: { locked: true } }
    : { kind: "update", id, patch: {}, unset: ["locked"] };
}
