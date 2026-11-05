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
  contentPropsOf,
  getBlock,
  findNode,
  isLinkableUrl,
  locateNode,
  nodeLocks,
  registryBlockSource,
  type ActiveSlotLock,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type ComponentPath,
  type NodeLock,
  type PropSchema,
  type SlotDefaultSource,
} from "@nextlyhq/blocks-engine";

import {
  CONTENT_CONTROL_TYPES,
  hasContentControl,
} from "./content-control-types";
import type { RefusalWording } from "./drag-refusal";
import type { EditorState } from "./editor-state";
import { blockLabel, insertionPropSets } from "./inserter";
import { layerLabel } from "./layers";
import { lockRefusalWording } from "./lock-refusal";
import { isLocked, lockBlockingEdit, lockedAncestorOf } from "./locking";
import { refusalAnnouncement } from "./move-refusal";
import type { BuilderOp, NodePatch } from "./op-vocabulary";

/**
 * The prop types this inspector can draw a control for.
 *
 * Named as a set rather than inferred from what the switch happens to handle,
 * so an unsupported prop is a KNOWN gap rather than a silent fallthrough. A
 * block declaring `type: "array"` still appears in the panel — the author is
 * told the prop exists and is not editable here — because omitting it entirely
 * would present an incomplete block as a complete one.
 */
export const SUPPORTED_PROP_TYPES: typeof CONTENT_CONTROL_TYPES =
  CONTENT_CONTROL_TYPES;

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
  /**
   * Whether the inspector draws a control for it: `false` for a prop that
   * applies only without another that is set, as a linked button's "Acts as",
   * and for a choice with nothing to pick. Listed even so, since a component
   * may still expose it to pages that clear what hides it.
   */
  readonly offered: boolean;
  /**
   * Whether a lock fixes this prop where the block sits: it is not content,
   * and the block is inside an area locked to its content. Shown, not hidden,
   * so the author sees the value and is told why it holds.
   */
  readonly readOnly: boolean;
  /**
   * What the block holds when the prop was never set: its `defaultProps`
   * entry, or `undefined`. A switch or a choice shows it until a value is
   * stored, since it is the value that applies.
   */
  readonly defaultValue?: unknown;
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
   * The rule treats the field as present whenever it is a string, so a stored
   * `""` shadows any `id` in the attribute bag and the element renders no id
   * at all. Collapsing the two into `""` here left the panel unable to tell
   * them apart, so every
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
   * The block's one-line description, from its definition, for the card under
   * the title. Every definition declares one.
   */
  readonly description: string;
  /** The concept its icon names, from `editor.icon`, if it names one. */
  readonly icon: string | undefined;
  /**
   * Props in the order the definition declares them.
   *
   * Declaration order rather than alphabetical: a block author writes a heading
   * before its level and a button before its destination, and sorting that into
   * alphabetical order rearranges a form somebody designed.
   */
  readonly props: readonly EditableProp[];
  /**
   * The block's own inspector component (`editor.component`), when it names
   * one, drawn in place of the controls generated from {@link props}.
   *
   * Read here with everything else the panel shows, so the panel never goes
   * back to the registry for a second reading of the same definition.
   */
  readonly inspector: ComponentPath | undefined;
  /**
   * Why the block's design and settings can't change, when it sits inside an
   * area locked to its content; undefined where nothing fixes them. Worded as
   * the store's refusal of the same edit is, so the read-only controls and a
   * refused edit give one reason.
   */
  readonly designLock: RefusalWording | undefined;
  /**
   * Every set of props the block can be placed with (its defaults under its
   * example, then each variation's), for a control that must tell a value an
   * author set from one the block started with.
   */
  readonly placedWith: ReadonlyArray<Readonly<Record<string, unknown>>>;
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
  const label = spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
  // The editor's spelling, which its own words ("Colour for", the Colour
  // form) already use: a key's American "color" read beside them as the same
  // word spelled two ways in one panel.
  return label.replace(/\b([Cc])olor\b/g, "$1olour");
}

/**
 * What an author calls a prop: the label its block gives it, or its name,
 * spaced and capitalised, when the block gives none.
 */
export function propLabel(name: string, schema: PropSchema): string {
  const given = schema.label;
  return typeof given === "string" && given.trim() !== ""
    ? given
    : fieldLabel(name);
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
 * Whether a prop is offered at all.
 *
 * Left out: a prop that applies only while others are empty
 * (`onlyWithout`), once any of them is set, as a button's "Acts as" means
 * nothing once the button links to a URL or an entry. Each entry names one
 * prop, or several that only together are something, as an entry link is a
 * collection and an entry. Also left out: a choice with fewer than two
 * options, which offers nothing to pick, as a column's one HTML tag, unless
 * what is stored is not that option, since the choice is then how it is put
 * back.
 */
function offered(
  schema: PropSchema,
  value: unknown,
  values: Readonly<Record<string, unknown>>,
  declared: Readonly<Partial<Record<string, PropSchema>>>,
  options: readonly string[]
): boolean {
  const without = schema.onlyWithout;
  const entries: readonly unknown[] =
    typeof without === "string"
      ? [without]
      : Array.isArray(without)
        ? without
        : [];
  const setHere = (name: unknown): boolean =>
    typeof name === "string" && propIsSet(declared[name], values[name]);
  const hidden = entries.some(entry =>
    Array.isArray(entry)
      ? entry.length > 0 && entry.every(setHere)
      : setHere(entry)
  );
  if (hidden) return false;
  if (schema.type !== "select" || options.length >= 2) return true;
  return propIsSet(undefined, value) && !options.includes(String(value));
}

/**
 * Whether a stored prop value is there: anything but absent or empty text,
 * and for a URL, only one a page can follow. The engine's rule, the one the
 * renderer reads, so a refused `javascript:` link that renders no link
 * leaves the block offering what it does without one. Exported so the
 * link group asks the same question of whether a link is set.
 */
export function propIsSet(
  schema: PropSchema | undefined,
  value: unknown
): boolean {
  if (schema?.type === "url") return isLinkableUrl(value);
  return value !== undefined && value !== null && value !== "";
}

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
  selectedId: string | null,
  /** The editor's lock source and composed page; see `contentOnlyAreaOf`. */
  view?: LockView
): BlockInspection | null {
  const selected = selectedBlock(document, selectedId);
  if (selected === null) return null;
  const { node, definition } = selected;
  const designLock = designLockOf(document, node.id, view);
  // Content stays editable under the lock; the rest is read-only. The same
  // set the save's lock rule keeps, read from the same declaration.
  const content = contentPropsOf(definition.props);

  const declared = definition.props ?? {};
  const props = Object.entries(declared).flatMap<EditableProp>(
    ([name, schema]) => {
      if (schema === undefined) return [];
      return [
        {
          name,
          schema,
          value: node.props[name],
          defaultValue: (
            definition.defaultProps as Record<string, unknown> | undefined
          )?.[name],
          supported: hasContentControl(schema.type),
          options: optionsOf(schema),
          offered: offered(
            schema,
            node.props[name],
            node.props,
            declared,
            optionsOf(schema)
          ),
          readOnly: designLock !== undefined && !content.has(name),
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
    // Narrowed for the reason the inspector component is: a definition
    // registered from JavaScript never had its type checked.
    description:
      typeof definition.description === "string" ? definition.description : "",
    icon:
      typeof definition.editor?.icon === "string"
        ? definition.editor.icon
        : undefined,
    props,
    inspector: inspectorOf(definition),
    designLock,
    placedWith: insertionPropSets(definition),
  };
}

/**
 * The custom inspector a definition names, or `undefined`.
 *
 * Narrowed rather than trusted: a definition registered from JavaScript never
 * had its type checked, and an empty or non-string path names nothing a host
 * could resolve.
 */
function inspectorOf(
  definition: AnyBlockDefinition
): ComponentPath | undefined {
  const component: unknown = definition.editor?.component;
  return typeof component === "string" && component.trim() !== ""
    ? component
    : undefined;
}

/**
 * Whether the block may not be changed from the inspector at all: locked in
 * Layers, itself or by a block it sits inside, or no longer in the document.
 *
 * Asked of the LIVE document at the moment a change is attempted, not of the
 * one a panel rendered with: a lock set in Layers after the panel drew must
 * still stop the next write.
 */
export function blockIsReadOnly(document: BlockDocument, id: string): boolean {
  const node = findNode(document.nodes, id);
  return node === undefined || lockBlockingEdit(document, id) !== undefined;
}

/**
 * Whether one prop of the block may be set from the inspector.
 *
 * Nothing may change on a read-only block. Inside an area locked
 * `"contentOnly"`, only the props its definition declares `role: "content"`
 * may: the lock fixes the block's design and leaves what it says editable,
 * which is the rule validation applies on save. The area and the content
 * props are read through the engine's own `nodeLocks` and `contentPropsOf`,
 * so the inspector and a save cannot disagree about either.
 */
export function propIsWritable(
  document: BlockDocument,
  id: string,
  name: string,
  view?: LockView
): boolean {
  if (blockIsReadOnly(document, id)) return false;
  const held = contentOnlyAreaOf(document, id, view);
  if (held === undefined) return true;
  return contentPropsOf(lockSourceOf(view).get(held.type)?.props).has(name);
}

/**
 * Why `node`'s design is fixed, when it sits inside a `"contentOnly"` area.
 *
 * Read from the engine's `nodeLocks`, the walk that passes each slot's lock
 * down as validation does, against the live registry the store's lock check
 * defaults to, so the inspector holds read-only exactly what a save refuses
 * to change. The area is named by its outermost locked block, the one the
 * author sees on the canvas. The inspector and the canvas's spacing handles
 * both ask it, so the two hold the same blocks.
 */
export function designLockOf(
  document: BlockDocument,
  nodeId: string,
  view?: LockView
): RefusalWording | undefined {
  const held = contentOnlyAreaOf(document, nodeId, view);
  if (held === undefined) return undefined;
  return lockRefusalWording({
    code: "locked-slot-content-only",
    holderType: held.area.holderType,
    lock: "contentOnly",
    childType: held.type,
  });
}

/**
 * Where `id` sits inside a `"contentOnly"` area, or `undefined` outside one.
 *
 * The one reading both {@link propIsWritable} and {@link designLockOf} take,
 * so the controls the inspector holds read-only and the commits it refuses
 * are the same set. Read from the engine's `nodeLocks` against the live
 * registry, the walk validation applies on save.
 *
 * Asked of the page first, then of the composed page: content a page gives
 * a component's exposed slot keeps its own id there, and sits under the
 * component's locks, which the page alone does not hold. The save judges the
 * composed page too. Both are read against the lock source the editor judges
 * edits by, so a host's own definitions hold here as they hold on `apply`.
 */
function contentOnlyAreaOf(
  document: BlockDocument,
  id: string,
  view?: LockView
): (NodeLock & { readonly area: NonNullable<NodeLock["area"]> }) | undefined {
  const source = lockSourceOf(view);
  const trees =
    view?.composed === undefined ? [document] : [document, view.composed];
  for (const tree of trees) {
    const held = nodeLocks(tree.nodes, source).get(id);
    if (held?.area !== undefined) return { ...held, area: held.area };
  }
  return undefined;
}

/**
 * What the editor judges locks by, as the inspector reads it: the lock source
 * its edits are refused against, and the page with its placements composed in.
 * Absent, the live registry and the page alone.
 */
export interface LockView {
  readonly definitions?: SlotDefaultSource;
  readonly composed?: BlockDocument;
}

/** The view's lock source, or the live registry the store defaults to. */
export function lockSourceOf(view: LockView | undefined): SlotDefaultSource {
  return view?.definitions ?? registryBlockSource();
}

/** An editor's {@link LockView}, read as it stands. */
export function lockViewOf(
  editor: Pick<EditorState, "composed" | "lockDefinitions">
): LockView {
  const composed = editor.composed();
  return {
    definitions: editor.lockDefinitions,
    ...(composed === undefined ? {} : { composed }),
  };
}

/**
 * The locks that hold one block, each kept apart from the other.
 *
 * Two kinds, and the inspector says each in its own words because they are
 * lifted in different places:
 *
 * - `layers` is the block's own lock, set from Layers or the inspector's menu.
 *   It is an edit of the page, so whoever may edit the page may lift it.
 * - `slot` is the lock of the slot the block sits in, which the block that
 *   declares that slot sets in code. Nothing on the page can lift it.
 */
export interface BlockLockStatus {
  /** Whether the block itself is locked in Layers. */
  readonly layers: boolean;
  /**
   * The name of the block locked in Layers that this one sits inside, when
   * it is not locked itself: a lock covers everything inside the block.
   */
  readonly inheritedFrom?: string | undefined;
  /**
   * The lock of the slot the block sits in, and the label of the block that
   * sets it, or `undefined` where no slot lock applies.
   */
  readonly slot:
    | {
        readonly lock: ActiveSlotLock;
        readonly holder: string;
        /** What the lock fixes, in the words a refused edit uses. */
        readonly reason: string;
      }
    | undefined;
}

/**
 * What a slot locked `all` or `insert` fixes, in an author's words. A
 * `contentOnly` area's reason is the lock refusal's own wording instead.
 */
const ARRANGEMENT_LOCK_WORDS = {
  all: "fixes which blocks it holds and their order, so this one can't be moved or removed",
  insert:
    "fixes which blocks it holds, so this one can't be removed or moved out",
} as const;

/**
 * Whether the block's own Layers lock may be set or lifted here. Not inside a
 * `contentOnly` area, which pins the node's `locked` field with its design, so
 * the save would refuse the change.
 */
export function layersLockChangeable(status: BlockLockStatus): boolean {
  return status.slot?.lock !== "contentOnly";
}

/**
 * Which locks hold a block.
 *
 * The slot lock is read through the engine's own `nodeLocks`, the walk a save
 * is judged by, so the inspector and the save cannot disagree about it.
 *
 * A `contentOnly` area wins wherever one applies, in the page or in the page
 * composed around it, and is found by the same reading that holds the design
 * read-only ({@link designLockOf}): a block an `all` slot holds on the page and
 * a component's `contentOnly` slot holds once composed is design-locked, and a
 * card naming only the arrangement lock would offer a Layers lock the save
 * refuses. Otherwise the first tree with a lock gives it, and the holder is the
 * nearest ancestor whose slot declares it, the block whose definition says so.
 */
export function lockStatusOf(
  document: BlockDocument,
  id: string,
  view?: LockView
): BlockLockStatus {
  const node = findNode(document.nodes, id);
  const layers = node !== undefined && isLocked(node);
  const around =
    node === undefined || layers ? undefined : lockedAncestorOf(document, id);
  const inherited =
    around === undefined ? {} : { inheritedFrom: layerLabel(around) };
  const area = contentOnlyAreaOf(document, id, view);
  if (area !== undefined) {
    const held = designLockOf(document, id, view);
    return {
      layers,
      ...inherited,
      slot: {
        lock: "contentOnly",
        holder: blockLabel(area.area.holderType),
        reason:
          held === undefined
            ? `${blockLabel(area.area.holderType)} fixes this block's design.`
            : refusalAnnouncement(held),
      },
    };
  }
  // The page first, then the document the editor composes around it (a
  // Layout's regions, a component's contents), each judged with the view's
  // definitions: the same trees and source a save and the canvas use.
  const source = lockSourceOf(view);
  const trees =
    view?.composed === undefined ? [document] : [document, view.composed];
  const found = trees
    .map(tree => ({ tree, at: nodeLocks(tree.nodes, source).get(id) }))
    .find(({ at }) => at?.lock !== undefined);
  const lock = found?.at?.lock;
  if (found === undefined || lock === undefined || lock === "contentOnly") {
    return { layers, ...inherited, slot: undefined };
  }
  const holderType = declaringAncestor(found.tree, id, source);
  const holder =
    holderType === undefined ? "The block it sits in" : blockLabel(holderType);
  return {
    layers,
    ...inherited,
    slot: {
      lock,
      holder,
      reason: `${holder} ${ARRANGEMENT_LOCK_WORDS[lock]}.`,
    },
  };
}

/**
 * The type of the nearest ancestor whose own slot declares a lock over the
 * block, walking up one parent at a time. A slot that declares nothing passes
 * its parent's lock down, so the declaration may be several levels up.
 */
function declaringAncestor(
  document: BlockDocument,
  id: string,
  source: SlotDefaultSource
): string | undefined {
  let current = id;
  // Bounded by the document's depth: each step moves one parent up.
  for (;;) {
    const location = locateNode(document.nodes, current);
    const parent = location?.parent;
    if (parent === undefined || location?.slot === undefined) return undefined;
    const declared = source.get(parent.type)?.slots?.[location.slot]?.lock;
    if (declared !== undefined && declared !== false) return parent.type;
    current = parent.id;
  }
}

/** What the inspector says while a block's own Layers lock holds it. */
const LAYERS_LOCK_REASON =
  "Locked: it can't be moved, deleted or edited. Unlock it from the block's menu.";

/**
 * Why a block's design may not be changed here, in an author's words, or
 * `undefined` while it may: its styles, classes, CSS id and attributes.
 *
 * Not on a block its Layers lock holds, and not inside a `"contentOnly"` area,
 * where the save refuses every one of them. Asked of the live document at the
 * moment of a write as well as when drawing, as {@link propIsWritable} is.
 */
export function designReadOnlyReason(
  document: BlockDocument,
  id: string,
  view?: LockView
): string | undefined {
  if (findNode(document.nodes, id) === undefined) {
    return "This block is no longer on the page.";
  }
  const status = lockStatusOf(document, id, view);
  if (status.layers) return LAYERS_LOCK_REASON;
  // Inside a block locked in Layers: that block's lock covers this one.
  if (status.inheritedFrom !== undefined) {
    return `Locked by ${status.inheritedFrom}: this block is inside it, so it can't be moved, deleted or edited. Unlock ${status.inheritedFrom} to change it.`;
  }
  // A `contentOnly` area's reason is the lock refusal's own wording, so the
  // inspector, a refused move and a refused save say one thing.
  const held = designLockOf(document, id, view);
  return held === undefined ? undefined : refusalAnnouncement(held);
}

/** Whether a block's design may be changed: {@link designReadOnlyReason}, as a yes or no. */
export function designIsWritable(
  document: BlockDocument,
  id: string,
  view?: LockView
): boolean {
  return designReadOnlyReason(document, id, view) === undefined;
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
  // `undefined` REMOVES the prop rather than storing it: a document holds no
  // undefined values, and an absent prop is what "not set" already means.
  if (value === undefined) {
    const { [name]: _removed, ...rest } = node.props;
    return { props: rest };
  }
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
