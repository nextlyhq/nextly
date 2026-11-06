/**
 * The rules behind a block's shared style: which shared styles a block wears,
 * whether its look may be saved as a new one, and the edits that move values
 * between the block and its style (save as, Move to, Detach).
 *
 * Pure, so each rule is tested without a DOM. The writes themselves are the
 * host's (a shared style lives in the site style, a block in the page), so
 * every plan here answers with what to store, never stores it.
 *
 * A shared style is stored as a class (`NamedClass`) and a block wears one by
 * listing its id in `node.classes`; the interface calls it a shared style.
 *
 * @module shared-style-target
 */
import {
  breakpointContexts,
  findNode,
  isPlainRecord,
  isTokenRef,
  newId,
  overlaidStyles,
  STYLE_STATES,
  type BlockDocument,
  type BlockNode,
  type BreakpointSet,
  type NamedClass,
  type NodeStyles,
  type StyleState,
  type StyleValue,
} from "@nextlyhq/blocks-engine";

import { liveBreakpointsFor } from "./breakpoints";
import {
  appliedClasses,
  newClassName,
  withClassApplied,
  withClassRemoved,
} from "./class-library";
import { designReadOnlyReason, type LockView } from "./inspector";
import { sameStyleValue, type BuilderOp } from "./op-vocabulary";
import {
  renameSharedStyle,
  sharedStyleRows,
  sharedStylesOnly,
  sharedStyleSlug,
  type SharedStyleRow,
} from "./shared-style-library";
import { stateLabel } from "./state-switcher";
import {
  readStyleValue,
  styleClearOp,
  styleWriteOp,
  type StyleAddress,
  type StylePolicy,
  type StyleWrite,
} from "./style-values";

/** What an author without the right to change the site's design is told. */
export const NO_DESIGN_RIGHT = "You can't change this site's design.";

/** No code-supplied ids, as one value: the rows here never ask. */
const NO_SUPPLIED: ReadonlySet<string> = new Set();

/**
 * The shared styles a block wears that the page renders, in library order
 * (the order that decides which wins), with their names. Classes the site
 * does not define, or stored past the page's limit, are not listed: they
 * style nothing.
 */
export function nodeSharedStyles(
  library: readonly NamedClass[],
  nodeClassIds: readonly string[]
): SharedStyleRow[] {
  // The rows the Shared styles tab lists, so a style is named the same in
  // the tab and on the block.
  const rows = new Map(
    sharedStyleRows(library, NO_SUPPLIED).map(row => [row.id, row])
  );
  return appliedClasses(library, nodeClassIds).flatMap(choice => {
    const row = rows.get(choice.id);
    return row === undefined ? [] : [row];
  });
}

/** Whether an envelope sets any value at all, in any state or breakpoint. */
export function hasOwnStyles(styles: NodeStyles | undefined): boolean {
  // Through the guarded walk, so a malformed tier reads as holding nothing.
  return ownEntries<unknown>(styles).some(([, byBreakpoint]) =>
    ownEntries<unknown>(byBreakpoint).some(
      ([, values]) => ownEntries(values).length > 0
    )
  );
}

/** What the host knows about the site's shared styles and the author's right. */
export interface SharedStyleOffer {
  /** The site's library, or `undefined` while it has not been read. */
  readonly library: readonly NamedClass[] | undefined;
  /** Whether the author may change the site's design (`update-site-style`). */
  readonly mayChange: boolean;
  /**
   * The editor's lock view (`lockViewOf`), so a block inside an area locked
   * to its content is refused here as the dialog refuses it. The registry's
   * locks alone when omitted.
   */
  readonly view?: LockView;
}

/**
 * Why the block's look cannot be saved as a shared style, in words, or
 * `undefined` when it can. The first release lets a block wear one shared
 * style, so a block already wearing one is refused; the reason names it.
 */
export function saveAsSharedStyleRefusal(
  document: BlockDocument,
  nodeId: string,
  offer: SharedStyleOffer,
  view?: LockView
): string | undefined {
  if (!offer.mayChange) return NO_DESIGN_RIGHT;
  const node = findNode(document.nodes, nodeId);
  // The Layers lock's own words, the ones the inspector shows for it; they
  // also cover a block that is no longer on the page.
  const locked = designReadOnlyReason(document, nodeId, view ?? offer.view);
  if (node === undefined || locked !== undefined) {
    return locked ?? "This block is no longer on the page.";
  }
  if (offer.library === undefined) {
    return "This site's shared styles haven't been read yet.";
  }
  // A look is worn beside a shared style, so only a shared style refuses.
  const [worn] = nodeSharedStyles(
    sharedStylesOnly(offer.library),
    node.classes ?? []
  );
  if (worn !== undefined) return `This block already uses ${worn.name}.`;
  if (!hasOwnStyles(node.styles)) {
    return "This block has no styles of its own yet.";
  }
  // The page's per-block limit, asked of the one rule that owns it.
  if (!withClassApplied(node.classes ?? [], "").ok) {
    return "This block already lists as many shared styles as the page applies.";
  }
  return undefined;
}

/** One past the highest position in the library, so a new style wins. */
function nextOrderIndex(library: readonly NamedClass[]): number {
  return library.reduce(
    (highest, entry) =>
      Number.isFinite(entry.orderIndex)
        ? Math.max(highest, entry.orderIndex + 1)
        : highest,
    0
  );
}

/** A plan's answer: what to store, or why not. */
export type SharedStylePlan<T> =
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly reason: string };

/**
 * Why a new style's name can't be used because another style already has its
 * class name, in words naming it as the author typed it, or `undefined`. One
 * rule for the dialog, which asks it of the library it read, and for the host,
 * which asks it again of the library its queue holds just before it stores.
 */
export function sharedStyleNameTaken(
  name: string,
  slug: string,
  library: readonly Pick<NamedClass, "slug">[]
): string | undefined {
  if (slug === "" || !library.some(entry => entry.slug === slug)) {
    return undefined;
  }
  return `“${name}” is already a shared style. Choose another name.`;
}

/** The name typed in the save dialog, checked: the label and class name, or why not. */
export function newSharedStyleName(
  name: string,
  library: readonly NamedClass[]
): SharedStylePlan<{ label: string; slug: string }> {
  // A name whose class name another style has is refused naming it as the
  // author typed it, which is the name they will look for.
  const typed = name.trim();
  const taken = sharedStyleNameTaken(typed, sharedStyleSlug(typed), library);
  if (taken !== undefined) return { ok: false, reason: taken };
  // Otherwise the rename rule with no style excluded: one rule for a name, so
  // a name refused on rename is refused here in the same words.
  const named = renameSharedStyle(name, "", library);
  if (!named.ok) return named;
  const room = newClassName(named.slug, library);
  if (!room.ok && room.refusal === "library-full") {
    return {
      ok: false,
      reason: "This site has as many shared styles as it can hold.",
    };
  }
  return { ok: true, label: named.label, slug: named.slug };
}

/**
 * "Save as shared style": a new style made of the block's own styles, whole
 * (every state and breakpoint, variable references as they are), and the op
 * that clears them from the block and puts the style on it. The block looks
 * the same after, because a class's rules and a block's have one specificity
 * and the class comes first: with the block's values gone, the class's apply.
 *
 * The style must be stored before the op is applied, since a page may not
 * reference a style the site does not define.
 */
export function planSaveAsSharedStyle(
  document: BlockDocument,
  nodeId: string,
  name: string,
  offer: SharedStyleOffer,
  view?: LockView,
  mintId: () => string = newId
): SharedStylePlan<{ entry: NamedClass; ops: BuilderOp[] }> {
  const refused = saveAsSharedStyleRefusal(document, nodeId, offer, view);
  const node = findNode(document.nodes, nodeId);
  const library = offer.library;
  if (refused !== undefined || node === undefined || library === undefined) {
    return { ok: false, reason: refused ?? "This block can't be saved." };
  }
  const named = newSharedStyleName(name, library);
  if (!named.ok) return named;
  const entry: NamedClass = {
    id: mintId(),
    slug: named.slug,
    label: named.label,
    orderIndex: nextOrderIndex(library),
    styles: node.styles ?? {},
  };
  return {
    ok: true,
    entry,
    ops: saveAsSharedStyleOps(node, entry),
  };
}

/**
 * Save as's page half: the new style put on the block, and the values it took
 * cleared from it. Built from the block as it stands once the style is stored,
 * so a value the block gained meanwhile (one the style does not hold) is kept.
 */
export function saveAsSharedStyleOps(
  node: Pick<BlockNode, "id" | "styles" | "classes">,
  entry: Pick<NamedClass, "id" | "styles">
): BuilderOp[] {
  return [
    nodeStylesAndClassesOp(
      node.id,
      // Only what still equals what the style took: a value the author has
      // set since, at the same place, is the block's own now.
      uncoveredStyles(node.styles ?? {}, entry.styles, true),
      [...(node.classes ?? []), entry.id]
    ),
  ];
}

/**
 * What the save dialog says will move: "Moves this block's 6 values (2
 * devices, Hover) into Card." A value is one property set in one state at one
 * breakpoint; the devices are named only when there is more than one.
 */
export function sharedStyleMoveSummary(
  styles: NodeStyles | undefined,
  name: string
): string {
  const into = name.trim() === "" ? "the new shared style" : name.trim();
  return `Moves ${sharedStyleMoveWhat(styles)} into ${into}.`;
}

/**
 * What a save would move, in words: "this block's 6 values (2 devices,
 * Hover)". The summary's subject, also said on its own while the name in
 * the dialog cannot be used.
 */
export function sharedStyleMoveWhat(styles: NodeStyles | undefined): string {
  const { values, devices, states } = countValues(styles);
  const extras = [
    ...(devices > 1 ? [`${devices} devices`] : []),
    ...states.map(stateLabel),
  ];
  const what = `${values} ${values === 1 ? "value" : "values"}`;
  const detail = extras.length > 0 ? ` (${extras.join(", ")})` : "";
  return `this block's ${what}${detail}`;
}

/**
 * The values an envelope sets, how many breakpoints they sit at, and the
 * states other than Normal that hold any, for the move summary.
 */
function countValues(styles: NodeStyles | undefined): {
  values: number;
  devices: number;
  states: StyleState[];
} {
  let values = 0;
  const devices = new Set<string>();
  const states: StyleState[] = [];
  for (const [state, byBreakpoint] of ownEntries<object>(styles)) {
    const sets = ownEntries<object>(byBreakpoint).filter(
      ([, set]) => ownEntries(set).length > 0
    );
    for (const [breakpoint, set] of sets) {
      values += ownEntries(set).length;
      devices.add(breakpoint);
    }
    if (sets.length > 0 && state !== "base") states.push(state as StyleState);
  }
  return { values, devices: devices.size, states };
}

/** Whether a stored value holds named sub-values (a token reference does not). */
function isComposite(
  value: StyleValue | undefined
): value is { readonly [key: string]: StyleValue } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isTokenRef(value)
  );
}

/** A record's own entries, with `__proto__` read as a key like any other. */
function ownEntries<T>(record: unknown): [string, T][] {
  // The envelope guard the style readers use at every level (`isPlainRecord`,
  // as `stateHasOwnValues` asks it): a stored tier that is null, a primitive
  // or an array holds nothing the compiler emits, and is read as empty here
  // rather than thrown on.
  return isPlainRecord(record) ? (Object.entries(record) as [string, T][]) : [];
}

/** A copy of a record defining one more own key, whatever its name. */
function withKey<T>(
  record: Record<string, T>,
  key: string,
  value: T
): Record<string, T> {
  const copy = { ...record };
  Object.defineProperty(copy, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return copy;
}

/**
 * The op that stores a block's styles and classes, removing a field that
 * empties rather than storing an empty one, so its undo puts back exactly
 * what was there.
 */
function nodeStylesAndClassesOp(
  nodeId: string,
  styles: NodeStyles,
  classes: readonly string[]
): BuilderOp {
  const patch: { styles?: NodeStyles; classes?: string[] } = {};
  const unset: ("styles" | "classes")[] = [];
  if (hasOwnStyles(styles)) patch.styles = styles;
  else unset.push("styles");
  if (classes.length > 0) patch.classes = [...classes];
  else unset.push("classes");
  return unset.length > 0
    ? { kind: "update", id: nodeId, patch, unset }
    : { kind: "update", id: nodeId, patch };
}

/**
 * The block a page edit of its design would change, or why it may not be
 * changed: its lock's words, the ones the inspector shows for it.
 */
function editableNode(
  document: BlockDocument,
  nodeId: string,
  view: LockView | undefined
): SharedStylePlan<{ node: BlockNode }> {
  const locked = designReadOnlyReason(document, nodeId, view);
  const node = findNode(document.nodes, nodeId);
  if (locked !== undefined || node === undefined) {
    return {
      ok: false,
      reason: locked ?? "This block is no longer on the page.",
    };
  }
  return { ok: true, node };
}

/**
 * One value with what another sets at the same place removed: a composite
 * keeps the sides the other leaves alone; anything else is gone once the
 * other sets it.
 */
function uncoveredValue(
  under: StyleValue,
  over: StyleValue | undefined,
  onlyEqual: boolean
): StyleValue | undefined {
  if (over === undefined) return under;
  if (!isComposite(under) || !isComposite(over)) {
    // Taken out where `over` sets it, or, asked for equal values only, where
    // it sets the very same value (the op layer's own comparison).
    return onlyEqual && !sameStyleValue(under, over) ? under : undefined;
  }
  let left: Record<string, StyleValue> = {};
  for (const [key, value] of ownEntries<StyleValue>(under)) {
    const kept = uncoveredValue(
      value,
      Object.hasOwn(over, key) ? over[key] : undefined,
      onlyEqual
    );
    if (kept !== undefined) left = withKey(left, key, kept);
  }
  return Object.keys(left).length > 0 ? left : undefined;
}

/** A record's own entry at a key, or an empty one, `__proto__` included. */
function ownRecord<T>(record: unknown, key: string): Record<string, T> {
  // Guarded as `ownEntries` is: anything but a plain record reads as empty.
  if (!isPlainRecord(record) || !Object.hasOwn(record, key)) return {};
  const value = record[key];
  return isPlainRecord(value) ? (value as Record<string, T>) : {};
}

/** One breakpoint's values with what another sets taken out, property by property. */
function uncoveredValues(
  under: object,
  over: Record<string, StyleValue>,
  onlyEqual: boolean
): Record<string, StyleValue> {
  let left: Record<string, StyleValue> = {};
  for (const [property, value] of ownEntries<StyleValue>(under)) {
    const kept = uncoveredValue(
      value,
      Object.hasOwn(over, property) ? over[property] : undefined,
      onlyEqual
    );
    if (kept !== undefined) left = withKey(left, property, kept);
  }
  return left;
}

/**
 * An envelope with every value another envelope sets at the same state,
 * breakpoint and property taken out: what `under` still shows once `over`,
 * coming after it, has applied. With `onlyEqual`, only the values `over` sets
 * to the very same value are taken out.
 */
function uncoveredStyles(
  under: NodeStyles,
  over: NodeStyles,
  onlyEqual = false
): NodeStyles {
  let left: Record<string, Record<string, Record<string, StyleValue>>> = {};
  for (const [state, byBreakpoint] of ownEntries<object>(under)) {
    const overBreakpoints = ownRecord<Record<string, StyleValue>>(over, state);
    for (const [breakpoint, values] of ownEntries<object>(byBreakpoint)) {
      const set = uncoveredValues(
        values,
        ownRecord<StyleValue>(overBreakpoints, breakpoint),
        onlyEqual
      );
      if (Object.keys(set).length === 0) continue;
      left = withKey(
        left,
        state,
        withKey(ownRecord(left, state), breakpoint, set)
      );
    }
  }
  return left;
}

/** One value a tier sets for one property: a composite's sides one by one. */
interface StyleLeafValue {
  /** The property and the path inside it, as one comparable key. */
  readonly key: string;
  readonly path: readonly string[];
  readonly value: StyleValue;
}

/** One breakpoint's values as leaves, a composite's sides each their own. */
function leavesOf(
  values: unknown,
  path: readonly string[] = []
): StyleLeafValue[] {
  const leaves: StyleLeafValue[] = [];
  for (const [key, value] of ownEntries<StyleValue>(values)) {
    const at = [...path, key];
    if (isComposite(value)) leaves.push(...leavesOf(value, at));
    else leaves.push({ key: JSON.stringify(at), path: at, value });
  }
  return leaves;
}

/**
 * One state at one width band: the rules that apply there, in the order the
 * compiler writes them inside a tier (`STYLE_STATES` outer, then the site's
 * contexts widest first), so the last that sets a value is the one shown.
 */
interface LookSituation {
  readonly state: StyleState;
  readonly breakpoint: string;
  readonly states: readonly StyleState[];
  readonly breakpoints: readonly string[];
}

/**
 * Every state at every band the site defines, in an order where a value
 * written at one situation's own place reaches only situations after it.
 *
 * A band is a viewport width band crossed with a query-container band, or
 * with no query container at all, since the browser applies both axes at
 * once. Its place is the last context that applies there in the order the
 * compiler writes them, which is where a rule on the block wins it. Bands
 * are taken by that place, and base before the interaction states.
 */
function lookSituations(set: BreakpointSet | undefined): LookSituation[] {
  const contexts = breakpointContexts(set);
  const ids = contexts.map(context => context.id);
  const onAxis = (axis: string): string[] =>
    contexts
      .filter(context => context.axis === axis)
      .map(context => context.id);
  const containers: (string | undefined)[] = [
    undefined,
    ...onAxis("container"),
  ];
  const bands = onAxis("viewport").flatMap(viewport =>
    containers.map(container => {
      // The contexts that match within the band, by the reader the
      // inspector asks the same question with, one axis at a time.
      const live = new Set<string>([
        ...liveBreakpointsFor(set, viewport),
        ...(container === undefined ? [] : liveBreakpointsFor(set, container)),
      ]);
      const breakpoints = ids.filter(id => live.has(id));
      return { breakpoint: breakpoints.at(-1) ?? viewport, breakpoints };
    })
  );
  // Stable, so bands sharing a place keep the viewport's own order.
  bands.sort((a, b) => ids.indexOf(a.breakpoint) - ids.indexOf(b.breakpoint));
  return STYLE_STATES.flatMap(state =>
    bands.map(band => ({
      state,
      ...band,
      states: state === "base" ? ["base"] : ["base", state],
    }))
  );
}

/**
 * The value each leaf shows in one situation, from tiers in the order the
 * page writes them: every rule has one weight (a state's selector is
 * wrapped in `:where()`), so the last applying rule wins.
 */
function shownIn(
  tiers: readonly NodeStyles[],
  situation: LookSituation
): Map<string, StyleLeafValue> {
  const shown = new Map<string, StyleLeafValue>();
  for (const tier of tiers) {
    for (const state of situation.states) {
      const byBreakpoint = ownRecord<unknown>(tier, state);
      for (const breakpoint of situation.breakpoints) {
        for (const leaf of leavesOf(ownRecord(byBreakpoint, breakpoint))) {
          shown.set(leaf.key, leaf);
        }
      }
    }
  }
  return shown;
}

/** An envelope holding one leaf at one state and breakpoint. */
function styleOfLeaf(
  state: string,
  breakpoint: string,
  leaf: StyleLeafValue
): NodeStyles {
  let value: StyleValue = leaf.value;
  for (const key of [...leaf.path.slice(1)].reverse()) {
    value = withKey<StyleValue>({}, key, value);
  }
  const values = withKey<StyleValue>({}, leaf.path[0] ?? "", value);
  return withKey({}, state, withKey({}, breakpoint, values));
}

/**
 * The block's styles once a set of shared styles stops applying, holding
 * what the page shows today in every state and at every width.
 *
 * Each situation is compared before and after, and where a leaf would show
 * something else, the value it shows today is written on the block at that
 * situation's own place: the last rule to apply there, since the block's
 * rules come after every style's. Situations are taken in an order where
 * such a write reaches only those still to come, so each is settled once.
 * The block's own values always win already, so they are kept as they are.
 */
function lookKept(
  before: readonly NodeStyles[],
  after: readonly NodeStyles[],
  own: NodeStyles,
  set: BreakpointSet | undefined
): NodeStyles | undefined {
  let kept = own;
  const situations = lookSituations(set);
  for (const situation of situations) {
    const now = shownIn([...after, kept], situation);
    for (const [key, was] of shownIn([...before, own], situation)) {
      const shown = now.get(key);
      if (shown !== undefined && sameStyleValue(shown.value, was.value)) {
        continue;
      }
      kept = overlaidStyles(
        kept,
        styleOfLeaf(situation.state, situation.breakpoint, was)
      );
    }
  }
  /*
   * Checked as a whole once written: a look that depends on a viewport and a
   * container width together can need two values at one place, which the
   * block's own rules, having no combined queries, cannot hold. Detach then
   * keeps nothing rather than a look that differs somewhere.
   */
  const keeps = situations.every(situation =>
    sameLook(
      shownIn([...before, own], situation),
      shownIn([...after, kept], situation)
    )
  );
  return keeps ? kept : undefined;
}

/** Whether two situations show every leaf alike, none missing from either. */
function sameLook(
  was: ReadonlyMap<string, StyleLeafValue>,
  now: ReadonlyMap<string, StyleLeafValue>
): boolean {
  if (was.size !== now.size) return false;
  for (const [key, leaf] of was) {
    const shown = now.get(key);
    if (shown === undefined || !sameStyleValue(shown.value, leaf.value)) {
      return false;
    }
  }
  return true;
}

/** Why a style can't be detached when its look can't be kept exactly. */
export const DETACH_LOOK_NOT_KEPT =
  "This look depends on screen and container width together, so it can't be detached yet.";

/**
 * "Detach": keep the look on this block only. The style is taken off the
 * block, and the block is given what it needs to show what it shows today, in
 * every state and at every width: the detached style's values where they win,
 * and, since the block's own rules come after every style's, a later style's
 * narrower or interaction-state value wherever the copy would otherwise beat
 * it. The block's own values are kept as they are. Where that can't be done
 * exactly (a look that depends on a viewport and a container width
 * together), it refuses and the style stays worn. A page edit, so a locked
 * style may be detached; the block's own lock refuses.
 *
 * @param worn - every shared style the block wears, in library order
 */
export function planDetachSharedStyle(
  document: BlockDocument,
  nodeId: string,
  style: Pick<NamedClass, "id" | "styles">,
  worn: readonly Pick<NamedClass, "id" | "styles">[],
  view?: LockView,
  breakpoints?: BreakpointSet
): SharedStylePlan<{ ops: BuilderOp[] }> {
  const held = editableNode(document, nodeId, view);
  if (!held.ok) return held;
  const node = held.node;
  // The styles in the order the page writes them, the detached one among
  // them (first, should the list not hold it), and the same without it.
  const listed = worn.some(row => row.id === style.id);
  const before = [...(listed ? [] : [style]), ...worn].map(row => row.styles);
  const after = worn.filter(row => row.id !== style.id).map(row => row.styles);
  const kept = lookKept(before, after, node.styles ?? {}, breakpoints);
  // Refused, the style still worn, rather than a look changed quietly.
  if (kept === undefined) return { ok: false, reason: DETACH_LOOK_NOT_KEPT };
  return {
    ok: true,
    ops: [
      nodeStylesAndClassesOp(
        nodeId,
        kept,
        withClassRemoved(node.classes ?? [], style.id)
      ),
    ],
  };
}

/** Take a shared style off a block, leaving the block's own values. */
export function planRemoveSharedStyle(
  document: BlockDocument,
  nodeId: string,
  styleId: string,
  view?: LockView
): SharedStylePlan<{ ops: BuilderOp[] }> {
  const held = editableNode(document, nodeId, view);
  if (!held.ok) return held;
  const node = held.node;
  const classes = withClassRemoved(node.classes ?? [], styleId);
  return {
    ok: true,
    ops: [
      classes.length > 0
        ? { kind: "update", id: nodeId, patch: { classes } }
        : { kind: "update", id: nodeId, patch: {}, unset: ["classes"] },
    ],
  };
}

/**
 * One edit to a shared style, applied to whatever its styles are when the
 * host stores it: an edit is a change at one address, never a whole envelope,
 * so two edits made before the first is stored both survive.
 */
export interface SharedStyleChange {
  (styles: NodeStyles): SharedStyleWrite;
  /**
   * The change that puts back what this one replaced, given the styles it was
   * applied to: the same address, its previous value (or cleared, where it
   * held none). An undo is then a change at that address too, applied to the
   * style as it stands when undone, so nothing else changed meanwhile is
   * put back with it.
   */
  readonly invert: (before: NodeStyles) => SharedStyleChange;
}

/** The change that sets (or with `null`, clears) one control's value. */
export function sharedStyleChange(
  address: StyleAddress,
  value: StyleValue | null,
  policy?: StylePolicy
): SharedStyleChange {
  return Object.assign(
    (styles: NodeStyles) => sharedStyleWrite(styles, address, value, policy),
    {
      invert: (before: NodeStyles) =>
        sharedStyleChange(
          address,
          readStyleValue(before, address) ?? null,
          policy
        ),
    }
  );
}

/** A style write's answer: the styles to store, no change, or the refusal. */
export type SharedStyleWrite =
  | { readonly kind: "write"; readonly styles: NodeStyles }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly reason: string };

/** The styles an op over a style's envelope stores, read off the op. */
function stylesOfWrite(write: StyleWrite): SharedStyleWrite {
  if (!write.ok) {
    return {
      kind: "refused",
      reason: write.issues[0]?.message ?? "This value cannot be used here.",
    };
  }
  if (write.op === null) return { kind: "unchanged" };
  const patch = write.op.kind === "update" ? write.op.patch : undefined;
  const styles =
    patch !== undefined && "styles" in patch ? patch.styles : undefined;
  return { kind: "write", styles: styles ?? {} };
}

/**
 * One control's value written into a shared style's envelope: the block's
 * own write path (`styleWriteOp`, `styleClearOp`), judged under the same
 * policy, so a value a block may hold is a value its style may hold. `null`
 * clears, as it does for a block.
 */
export function sharedStyleWrite(
  styles: NodeStyles,
  address: StyleAddress,
  value: StyleValue | null,
  policy?: StylePolicy
): SharedStyleWrite {
  // The id only names the op this reads the envelope back out of; no node
  // is written.
  return stylesOfWrite(
    value === null
      ? styleClearOp("", styles, address, policy)
      : styleWriteOp("", styles, address, value, policy)
  );
}

/**
 * "Move to Card": the block's value at one control written into the style
 * and cleared from the block. Two writes (the style, then the page), so the
 * style is stored first and the op applied after it lands. The style's part
 * is a change at that address, applied to the style as it is when stored.
 */
export function planMoveToSharedStyle(
  node: Pick<BlockNode, "id" | "styles">,
  style: Pick<NamedClass, "styles">,
  address: StyleAddress,
  policy?: StylePolicy
): SharedStylePlan<{ change: SharedStyleChange; moved: StyleValue }> {
  const value = readStyleValue(node.styles, address);
  if (value === undefined) {
    return { ok: false, reason: "This block sets no value here to move." };
  }
  const change = sharedStyleChange(address, value, policy);
  // Judged now against the styles in hand, so a value the style may not hold
  // is refused before anything is stored.
  const write = change(style.styles);
  if (write.kind === "refused") return { ok: false, reason: write.reason };
  return { ok: true, change, moved: value };
}

/**
 * Move to's page half: the block's value cleared at one address, built from
 * the block as it stands when the style has taken the value, so an edit made
 * to the block meanwhile is kept, at another address or at this one. Nothing
 * for a block that is gone or no longer holds the moved value there.
 */
export function moveToSharedStyleClear(
  node: Pick<BlockNode, "id" | "styles"> | undefined,
  address: StyleAddress,
  moved: StyleValue,
  policy?: StylePolicy
): BuilderOp[] {
  if (node === undefined) return [];
  // Only the value that was moved: one the author has set here since, while
  // the style's write was on its way, is the block's new value and stays.
  const now = readStyleValue(node.styles, address);
  if (now === undefined || !sameStyleValue(now, moved)) return [];
  const cleared = styleClearOp(node.id, node.styles, address, policy);
  return cleared.ok && cleared.op !== null ? [cleared.op] : [];
}
