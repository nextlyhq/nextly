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
  findNode,
  isPlainRecord,
  isTokenRef,
  newId,
  type BlockDocument,
  type BlockNode,
  type NamedClass,
  type NodeStyles,
  type StyleState,
  type StyleValue,
} from "@nextlyhq/blocks-engine";

import {
  appliedClasses,
  newClassName,
  withClassApplied,
  withClassRemoved,
} from "./class-library";
import { designReadOnlyReason, type LockView } from "./inspector";
import type { BuilderOp } from "./ops";
import {
  renameSharedStyle,
  sharedStyleRows,
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
  const locked = designReadOnlyReason(document, nodeId, view);
  if (node === undefined || locked !== undefined) {
    return locked ?? "This block is no longer on the page.";
  }
  if (offer.library === undefined) {
    return "This site's shared styles haven't been read yet.";
  }
  const [worn] = nodeSharedStyles(offer.library, node.classes ?? []);
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

/** The name typed in the save dialog, checked: the label and class name, or why not. */
export function newSharedStyleName(
  name: string,
  library: readonly NamedClass[]
): SharedStylePlan<{ label: string; slug: string }> {
  // A name whose class name another style has is refused naming it as the
  // author typed it, which is the name they will look for.
  const typed = name.trim();
  const slug = sharedStyleSlug(typed);
  if (slug !== "" && library.some(entry => entry.slug === slug)) {
    return {
      ok: false,
      reason: `“${typed}” is already a shared style. Choose another name.`,
    };
  }
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
      uncoveredStyles(node.styles ?? {}, entry.styles),
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

/**
 * One value over another: the block's wins where it sets something, and a
 * composite (the sides of a padding) is merged side by side, since the block
 * may set one side over the style's four.
 */
function overlayValue(
  under: StyleValue | undefined,
  over: StyleValue | undefined
): StyleValue | undefined {
  if (over === undefined) return under;
  if (!isComposite(under) || !isComposite(over)) return over;
  const merged: Record<string, StyleValue> = { ...under };
  for (const key of Object.keys(over)) {
    const value = overlayValue(
      Object.hasOwn(under, key) ? under[key] : undefined,
      over[key]
    );
    if (value !== undefined) merged[key] = value;
  }
  return merged;
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
 * The look a block shows with a style under its own values, as one envelope:
 * the style's values, with the block's over them at every state, breakpoint
 * and property. What Detach leaves on the block.
 */
export function overlaidStyles(
  under: NodeStyles | undefined,
  over: NodeStyles | undefined
): NodeStyles {
  let merged: Record<string, Record<string, Record<string, StyleValue>>> = {};
  for (const source of [under, over]) {
    for (const [state, byBreakpoint] of ownEntries<object>(source)) {
      // A malformed state holds nothing to lay over, and adds no empty tier.
      if (!isPlainRecord(byBreakpoint)) continue;
      const states = Object.hasOwn(merged, state) ? merged[state] : {};
      const laid = overlaidBreakpoints(states, byBreakpoint);
      if (Object.keys(laid).length > 0) merged = withKey(merged, state, laid);
    }
  }
  return merged;
}

/** One state's breakpoints with another's laid over them. */
function overlaidBreakpoints(
  under: Record<string, Record<string, StyleValue>>,
  over: object
): Record<string, Record<string, StyleValue>> {
  let merged = under;
  for (const [breakpoint, values] of ownEntries<object>(over)) {
    if (!isPlainRecord(values)) continue;
    const set = Object.hasOwn(merged, breakpoint) ? merged[breakpoint] : {};
    merged = withKey(merged, breakpoint, overlaidValues(set, values));
  }
  return merged;
}

/** One breakpoint's values with another's laid over them, property by property. */
function overlaidValues(
  under: Record<string, StyleValue>,
  over: object
): Record<string, StyleValue> {
  let merged = under;
  for (const [property, value] of ownEntries<StyleValue>(over)) {
    const next = overlayValue(
      Object.hasOwn(merged, property) ? merged[property] : undefined,
      value
    );
    if (next !== undefined) merged = withKey(merged, property, next);
  }
  return merged;
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
  over: StyleValue | undefined
): StyleValue | undefined {
  if (over === undefined) return under;
  if (!isComposite(under) || !isComposite(over)) return undefined;
  let left: Record<string, StyleValue> = {};
  for (const [key, value] of ownEntries<StyleValue>(under)) {
    const kept = uncoveredValue(
      value,
      Object.hasOwn(over, key) ? over[key] : undefined
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
  over: Record<string, StyleValue>
): Record<string, StyleValue> {
  let left: Record<string, StyleValue> = {};
  for (const [property, value] of ownEntries<StyleValue>(under)) {
    const kept = uncoveredValue(
      value,
      Object.hasOwn(over, property) ? over[property] : undefined
    );
    if (kept !== undefined) left = withKey(left, property, kept);
  }
  return left;
}

/**
 * An envelope with every value another envelope sets at the same state,
 * breakpoint and property taken out: what `under` still shows once `over`,
 * coming after it, has applied.
 */
function uncoveredStyles(under: NodeStyles, over: NodeStyles): NodeStyles {
  let left: Record<string, Record<string, Record<string, StyleValue>>> = {};
  for (const [state, byBreakpoint] of ownEntries<object>(under)) {
    const overBreakpoints = ownRecord<Record<string, StyleValue>>(over, state);
    for (const [breakpoint, values] of ownEntries<object>(byBreakpoint)) {
      const set = uncoveredValues(
        values,
        ownRecord<StyleValue>(overBreakpoints, breakpoint)
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

/**
 * "Detach": keep the look on this block only. The style is taken off the
 * block, and the values it gives the block today are copied onto it, under
 * the block's own. A value a style later in library order sets at the same
 * place is not the detached style's to give (that style wins it now), so it is
 * left out, and the block looks the same after. A page edit, so a locked style
 * may be detached; the block's own lock refuses.
 *
 * @param worn - every shared style the block wears, in library order
 */
export function planDetachSharedStyle(
  document: BlockDocument,
  nodeId: string,
  style: Pick<NamedClass, "id" | "styles">,
  worn: readonly Pick<NamedClass, "id" | "styles">[],
  view?: LockView
): SharedStylePlan<{ ops: BuilderOp[] }> {
  const held = editableNode(document, nodeId, view);
  if (!held.ok) return held;
  const node = held.node;
  const later = worn.slice(worn.findIndex(row => row.id === style.id) + 1);
  const winning = later.reduce(
    (left, row) => uncoveredStyles(left, row.styles),
    style.styles
  );
  return {
    ok: true,
    ops: [
      nodeStylesAndClassesOp(
        nodeId,
        overlaidStyles(winning, node.styles),
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
export type SharedStyleChange = (styles: NodeStyles) => SharedStyleWrite;

/** The change that sets (or with `null`, clears) one control's value. */
export function sharedStyleChange(
  address: StyleAddress,
  value: StyleValue | null,
  policy?: StylePolicy
): SharedStyleChange {
  return styles => sharedStyleWrite(styles, address, value, policy);
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
): SharedStylePlan<{ change: SharedStyleChange }> {
  const value = readStyleValue(node.styles, address);
  if (value === undefined) {
    return { ok: false, reason: "This block sets no value here to move." };
  }
  const change = sharedStyleChange(address, value, policy);
  // Judged now against the styles in hand, so a value the style may not hold
  // is refused before anything is stored.
  const write = change(style.styles);
  if (write.kind === "refused") return { ok: false, reason: write.reason };
  return { ok: true, change };
}

/**
 * Move to's page half: the block's value cleared at one address, built from
 * the block as it stands when the style has taken the value, so an edit made
 * to the block meanwhile is kept. Nothing for a block that is gone or holds
 * nothing there any more.
 */
export function moveToSharedStyleClear(
  node: Pick<BlockNode, "id" | "styles"> | undefined,
  address: StyleAddress,
  policy?: StylePolicy
): BuilderOp[] {
  if (node === undefined) return [];
  const cleared = styleClearOp(node.id, node.styles, address, policy);
  return cleared.ok && cleared.op !== null ? [cleared.op] : [];
}
