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
  type AnyBlockDefinition,
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

/**
 * The block's HTML surface: what it renders AS, rather than what it holds.
 *
 * Read here with everything else the inspector shows, so one function reads the
 * document and the panels read the function. A panel reaching back for the node
 * itself would be a second reader of the same selection, free to disagree with
 * this one about which node is selected.
 */
export interface BlockHtml {
  /**
   * The element's `id`. `undefined` when the node does not carry the field at
   * all, which is NOT the same as carrying an empty one.
   *
   * The renderer treats the field as present whenever it is a string — it
   * writes `extra.id = cssId` on `cssId !== undefined` — so a stored `""`
   * renders `id=""` and shadows any `id` in the attribute bag. Collapsing the
   * two into `""` here left the panel unable to tell them apart, so every
   * attempt to clear an empty-but-present field read as no change and the
   * field could never be removed. The distinction the document draws has to
   * survive the reading of it.
   */
  readonly cssId: string | undefined;
  /**
   * The author's own attributes, absent when there are none.
   *
   * Absent rather than empty, because the node itself distinguishes them: a
   * block that never had attributes and one whose last was removed both store
   * nothing, and an empty record here would invite writing one back.
   */
  readonly attributes: Readonly<Record<string, string>> | undefined;
}

/** The selected block, as something to edit. */
export interface BlockInspection {
  readonly nodeId: string;
  readonly blockName: string;
  /** What the block IS, beside what it holds. */
  readonly identity: BlockIdentity;
  /** What the block renders as, beside what it holds. */
  readonly html: BlockHtml;
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

/** The selected node together with the definition that describes it. */
export interface SelectedBlock {
  readonly node: BlockNode;
  readonly definition: AnyBlockDefinition;
}

/**
 * The selected NODE, whether or not the registry knows what it is.
 *
 * Separate from {@link selectedBlock} because the two tabs need different
 * things from a selection, and only one of them needs the definition. Both
 * derive from this, so "which node is selected" has one answer.
 */
export function selectedNode(
  document: BlockDocument,
  selectedId: string | null
): BlockNode | null {
  if (selectedId === null) return null;
  return findNode(document.nodes, selectedId) ?? null;
}

/**
 * The block an inspector is describing, or `null` when there is none.
 *
 * `null` for no selection, for an id the document no longer holds, and for a
 * block the REGISTRY does not know. The last is the one worth stating, because
 * it is a policy rather than a lookup failing: an unregistered block's props
 * have no schemas, so every content control would have to be guessed from the
 * stored value's runtime type — which produces a text box for a number and
 * silently rewrites the value on save.
 *
 * The STYLE tab does not use this, and the difference is the point. It reads a
 * definition's `supports` where one exists and needs nothing from it where one
 * does not: a node whose block is unregistered still has its styles compiled,
 * because neither `validation.ts` nor `compile-page.ts` consults the registry
 * before emitting them. Withholding the style panel there would leave an author
 * looking at styling nothing can remove, so `inspectStyle` resolves the node
 * itself and treats every stored property as retained.
 */
export function selectedBlock(
  document: BlockDocument,
  selectedId: string | null
): SelectedBlock | null {
  const node = selectedNode(document, selectedId);
  if (node === null) return null;
  const definition = getBlock(node.type);
  if (definition === undefined) return null;
  return { node, definition };
}

/**
 * A stored key as a human reads it: `backgroundColor` becomes "Background color".
 *
 * Here rather than in a panel because both panels label the same way and from
 * the same kind of key — a prop name on the content tab, a catalog key on the
 * style tab — and two spellings of one rule would drift the first time either
 * learned about an acronym or a digit.
 */
export function fieldLabel(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
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
 * edit. See {@link selectedBlock} for what "nothing" covers and why.
 */
/**
 * Whether the inspector can show anything for this selection.
 *
 * Exported because the CANVAS needs the same answer and cannot reach
 * {@link inspectSelection}'s result: when this is false the panel replaces its
 * whole tab strip, so a host still forcing an interaction state would draw the
 * selected block mid-hover with the control that explains it off screen.
 *
 * Derived from {@link selectedBlock}, which is the lookup `inspectSelection`
 * already starts with, so the two cannot disagree about what is inspectable —
 * an unregistered block type is the case that separates them, and it reads as
 * an ordinary selection to anything counting ids.
 */
export function selectionIsInspectable(
  document: BlockDocument,
  selectedId: string | null
): boolean {
  return selectedBlock(document, selectedId) !== null;
}

export function inspectSelection(
  document: BlockDocument,
  selectedId: string | null
): BlockInspection | null {
  const selected = selectedBlock(document, selectedId);
  if (selected === null) return null;
  const { node, definition } = selected;

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
    /*
     * Narrowed HERE rather than trusted. A stored document can hold anything
     * the database returned — the engine's validator reports these but does not
     * rewrite them — so a `cssId` that is not a string, or an `attributes`
     * that is an array or null, must not reach a control typed for neither.
     */
    html: {
      cssId: typeof node.cssId === "string" ? node.cssId : undefined,
      attributes: editableAttributes(node.attributes),
    },
    // The same name the palette offered and the layers panel shows. Reading
    // `editor.label ?? node.type` here instead was a second rule that agreed
    // only for blocks which declare a label: an unlabelled third-party block
    // was "Collection loop" in the palette and `acme/collection-loop` here.
    label: blockLabel(node.type),
    props,
  };
}

/**
 * The entries of a stored attribute bag the editor can actually put in a row.
 *
 * Narrowed ENTRY BY ENTRY, not bag by bag. The renderer skips a single
 * non-string value and emits every other attribute beside it, so an
 * all-or-nothing check disagreed with the page: a bag holding
 * `{ "data-keep": "yes", "data-bad": 5 }` rendered `data-keep` while the panel
 * showed no rows at all — and the first attribute the author added was written
 * from that empty view, deleting `data-keep` without saying so.
 *
 * The unrepresentable entries cannot be carried through an edit: `update`
 * refuses an `attributes` bag holding a non-string, so an op preserving one
 * would never apply. They therefore survive exactly as long as the author
 * leaves the attributes alone — `htmlUpdate` names only the field that changed,
 * so editing the CSS id does not rewrite the bag — and are dropped by the first
 * edit to the attributes themselves, which is the only form that edit can take.
 */
function editableAttributes(
  value: unknown
): Readonly<Record<string, string>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const cached = editableBags.get(value);
  if (cached !== undefined) return cached;
  const kept: Record<string, string> = {};
  let dropped = false;
  for (const [name, each] of Object.entries(value)) {
    if (typeof each === "string") kept[name] = each;
    else dropped = true;
  }
  // `undefined` rather than `{}` for a bag with nothing readable in it, so it
  // compares equal to no bag at all wherever the two are asked apart.
  if (Object.keys(kept).length === 0) return undefined;
  // Nothing was dropped, so the stored object IS the readable one — handed back
  // as itself rather than as a copy, which is both the common case and the one
  // that needs no help staying identical between renders.
  if (!dropped) return value as Readonly<Record<string, string>>;
  editableBags.set(value, kept);
  return kept;
}

/**
 * Filtered bags, keyed by the stored object they were read from.
 *
 * An inspection is rebuilt on EVERY render, and the attributes panel resets its
 * draft whenever the stored bag it is given changes. A copy made fresh each
 * time is a new object each time, so the panel would see the document change on
 * every render — resetting the draft under the author's cursor, and re-running
 * the effect that reset it. A node's `attributes` object is itself replaced
 * only by an op, so keying on it hands back one reference for as long as the
 * document holds one bag.
 */
const editableBags = new WeakMap<object, Readonly<Record<string, string>>>();

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
