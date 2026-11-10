/**
 * Per-device visibility as an author works with it: which devices a block
 * shows on, a hide that stays on one device, and what becomes of both when the
 * site's breakpoints change.
 *
 * Stored per node as `visibility.devices`, a boolean per breakpoint id, and
 * compiled to CSS by a cascade (`style/visibility-cascade`): a `false` hides
 * the block from that breakpoint down until a narrower one stores `true`. That
 * storage is compact and is what the published page has always read, but it
 * makes three operations easy to get wrong, and each is answered here once:
 *
 * - **Hiding on one device.** Writing `false` on tablet alone also hides the
 *   block on every narrower device that stores nothing. "This device only"
 *   means the narrower devices keep what they showed.
 * - **Removing a breakpoint.** Its stored value goes with it, and the devices
 *   narrower than it keep what they showed: a `false` they inherited from it
 *   would otherwise vanish with it, and a breakpoint added later under the
 *   same name must start visible rather than revive an old hide.
 * - **Adding a breakpoint.** The new breakpoint shows what its width showed
 *   before, and every other device keeps what it showed. Without a value of
 *   its own, a breakpoint added between a hiding device and a narrower one
 *   that shows the block again would inherit the hide.
 *
 * All three are the same move: read every device's resolved state, change
 * the states the operation names, and write back the fewest values that
 * resolve to them. So they share one writer, and nothing here can store a
 * value the cascade would read differently from what the author was shown.
 *
 * What the site does not define is never touched. A value stored under an id
 * that is not one of the site's breakpoints is kept as it is (the compiler
 * reports it), except under the breakpoint a change removes, whose values are
 * the ones that change drops.
 *
 * @module device-visibility
 */
import type {
  BlockDocument,
  BlockNode,
  BreakpointSet,
  NodeVisibility,
} from "./document";
import { isPlainRecord } from "./plain-record";
import { defineEntry } from "./safe-record";
import { breakpointContexts } from "./style/compile-page";
import type { BreakpointContext } from "./style/compile-page";
import { visibilityCascade } from "./style/visibility-cascade";
import { mapForest } from "./tree";

/** One device's visibility, as an author reads it. */
export interface DeviceVisibility {
  /** The breakpoint's id; the base breakpoint is `BASE_BREAKPOINT`. */
  readonly id: string;
  readonly axis: "viewport" | "container";
  /** Whether the block shows at this breakpoint. */
  readonly visible: boolean;
  /**
   * Whether the block stores a value of its own here, rather than carrying
   * the state of the breakpoint above.
   */
  readonly own: boolean;
}

/** The stored per-device record, or nothing when there is none to read. */
function storedDevices(
  visibility: unknown
): Readonly<Record<string, unknown>> | undefined {
  if (!isPlainRecord(visibility)) return undefined;
  const devices = visibility.devices;
  return isPlainRecord(devices) ? devices : undefined;
}

/** Whether `record` stores a boolean of its own under `id`. */
function ownBoolean(
  record: Readonly<Record<string, unknown>> | undefined,
  id: string
): boolean {
  return (
    record !== undefined &&
    Object.prototype.hasOwnProperty.call(record, id) &&
    typeof record[id] === "boolean"
  );
}

/** Each context's resolved state, by id. */
function resolvedStates(
  devices: Readonly<Record<string, unknown>> | undefined,
  contexts: readonly BreakpointContext[]
): Map<string, boolean> {
  const states = visibilityCascade(devices, contexts);
  return new Map(
    contexts.map((context, index) => [context.id, states[index] ?? true])
  );
}

/**
 * The block's visibility on every breakpoint the site emits, in cascade order:
 * the base breakpoint, then the viewport breakpoints from widest to narrowest,
 * then the container ones.
 *
 * Asked of the same normalised breakpoints the compiler emits under, so a
 * device this lists is one the published page answers for.
 */
export function deviceVisibility(
  visibility: unknown,
  breakpoints: BreakpointSet | undefined
): DeviceVisibility[] {
  const contexts = breakpointContexts(breakpoints);
  const devices = storedDevices(visibility);
  const states = visibilityCascade(devices, contexts);
  return contexts.map((context, index) => ({
    id: context.id,
    axis: context.axis ?? "viewport",
    visible: states[index] ?? true,
    own: ownBoolean(devices, context.id),
  }));
}

/**
 * Whether the block is hidden at one breakpoint. A breakpoint the site does
 * not define hides nothing.
 */
export function hiddenOnDevice(
  visibility: unknown,
  breakpoints: BreakpointSet | undefined,
  id: string
): boolean {
  return deviceVisibility(visibility, breakpoints).some(
    device => device.id === id && !device.visible
  );
}

/**
 * The fewest stored values that resolve to `states` over `contexts`.
 *
 * Per axis, a value is written only where the state differs from the one the
 * cascade carries down to it, so a block visible everywhere stores nothing.
 */
function minimalDevices(
  states: ReadonlyMap<string, boolean>,
  contexts: readonly BreakpointContext[]
): Record<string, boolean> {
  const written: Record<string, boolean> = {};
  const carried = { viewport: true, container: true };
  for (const context of contexts) {
    const axis = context.axis ?? "viewport";
    const state = states.get(context.id) ?? carried[axis];
    // Defined rather than assigned: an id is stored data, and assigning to
    // `"__proto__"` would run the prototype setter and store nothing.
    if (state !== carried[axis]) defineEntry(written, context.id, state);
    carried[axis] = state;
  }
  return written;
}

/**
 * The visibility envelope with `devices` replaced: the node's conditions and
 * whatever else it stores are kept, and an envelope left with nothing in it is
 * `undefined`, so a block visible everywhere stores no visibility at all.
 */
function withDevices(
  visibility: unknown,
  devices: Record<string, unknown>
): NodeVisibility | undefined {
  const rest: Record<string, unknown> = isPlainRecord(visibility)
    ? { ...visibility }
    : {};
  delete rest.devices;
  const next: Record<string, unknown> =
    Object.keys(devices).length === 0 ? rest : { ...rest, devices };
  return Object.keys(next).length === 0 ? undefined : next;
}

/**
 * The stored values a rewrite over `contexts` leaves alone: those under ids
 * the contexts do not define, except the ids in `dropped`.
 */
function foreignDevices(
  devices: Readonly<Record<string, unknown>> | undefined,
  contexts: readonly BreakpointContext[],
  dropped: ReadonlySet<string>
): Record<string, unknown> {
  const defined = new Set(contexts.map(context => context.id));
  const kept: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(devices ?? {})) {
    if (!defined.has(id) && !dropped.has(id)) defineEntry(kept, id, value);
  }
  return kept;
}

/**
 * Show or hide the block on ONE breakpoint, leaving every other breakpoint
 * showing what it showed.
 *
 * Answers the next visibility envelope, `undefined` when nothing is left to
 * store; the envelope as it was when `id` is not a breakpoint the site
 * defines, since a value stored there would hide nothing and the compiler
 * would only report it.
 */
export function setDeviceVisibility(
  visibility: unknown,
  breakpoints: BreakpointSet | undefined,
  id: string,
  visible: boolean
): NodeVisibility | undefined {
  const contexts = breakpointContexts(breakpoints);
  if (!contexts.some(context => context.id === id)) {
    return visibility as NodeVisibility | undefined;
  }
  const devices = storedDevices(visibility);
  const states = resolvedStates(devices, contexts);
  states.set(id, visible);
  return withDevices(visibility, {
    ...foreignDevices(devices, contexts, new Set()),
    ...minimalDevices(states, contexts),
  });
}

/**
 * The context of `contexts` whose band holds `width` on `axis`: the narrowest
 * one whose upper bound is at least that width. `undefined` when none does,
 * which happens only on the container axis: it has no unbounded base, so a
 * width above its widest breakpoint was held by no context at all.
 */
function coveringContext(
  contexts: readonly BreakpointContext[],
  axis: "viewport" | "container",
  width: number
): BreakpointContext | undefined {
  const onAxis = contexts.filter(
    context => (context.axis ?? "viewport") === axis
  );
  let covering: BreakpointContext | undefined;
  for (const context of onAxis) {
    if ((context.maxWidth ?? Number.POSITIVE_INFINITY) >= width) {
      covering = context;
    }
  }
  return covering;
}

/**
 * The block's per-device visibility carried across a change of the site's
 * breakpoints, from `before` to `after`.
 *
 * - A breakpoint in both keeps the state it resolved to.
 * - A breakpoint only in `after` shows what its width showed before.
 * - A breakpoint only in `before` is gone, and so is the value it stored.
 *
 * So every device looks as it did, a removed breakpoint leaves nothing
 * behind, and one added later under the same name starts from what its width
 * shows rather than from a value an earlier breakpoint left.
 */
export function carryDeviceVisibility(
  visibility: unknown,
  before: BreakpointSet | undefined,
  after: BreakpointSet | undefined
): NodeVisibility | undefined {
  const devices = storedDevices(visibility);
  if (devices === undefined) return visibility as NodeVisibility | undefined;
  const was = breakpointContexts(before);
  const now = breakpointContexts(after);
  const shown = resolvedStates(devices, was);
  const states = new Map<string, boolean>();
  for (const context of now) {
    const axis = context.axis ?? "viewport";
    const kept = shown.get(context.id);
    if (kept !== undefined) {
      states.set(context.id, kept);
      continue;
    }
    const covering = coveringContext(
      was,
      axis,
      context.maxWidth ?? Number.POSITIVE_INFINITY
    );
    states.set(
      context.id,
      covering === undefined ? true : (shown.get(covering.id) ?? true)
    );
  }
  const removed = new Set(
    was
      .map(context => context.id)
      .filter(id => !now.some(context => context.id === id))
  );
  return withDevices(visibility, {
    ...foreignDevices(devices, now, removed),
    ...minimalDevices(states, now),
  });
}

/** Whether two stored per-device records hold the same values. */
function sameDevices(a: unknown, b: unknown): boolean {
  const left = storedDevices(a) ?? {};
  const right = storedDevices(b) ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

/** What a document-wide carry changed. */
export interface CarriedVisibility {
  readonly document: BlockDocument;
  /** How many blocks' stored visibility changed: the count a confirmation names. */
  readonly changed: number;
}

/**
 * {@link carryDeviceVisibility} over every block of a document, slot content
 * included. A block whose stored values come out the same is returned as it
 * was, so a document no breakpoint change touches is the same document.
 */
export function carryDocumentDeviceVisibility(
  document: BlockDocument,
  before: BreakpointSet | undefined,
  after: BreakpointSet | undefined
): CarriedVisibility {
  let changed = 0;
  const nodes = mapForest(document.nodes, node => {
    const next = carryDeviceVisibility(node.visibility, before, after);
    if (sameDevices(node.visibility, next)) return node;
    changed += 1;
    const { visibility: _previous, ...rest } = node;
    return next === undefined ? rest : { ...rest, visibility: next };
  });
  return changed === 0
    ? { document, changed }
    : { document: { ...document, nodes }, changed };
}

/**
 * The document with the per-device hiding of `ids` lifted, for an editor
 * showing a hidden block while the author has it selected.
 *
 * Editor-only by construction: it answers a new document for a surface to
 * draw, and nothing stores it. The blocks' conditions stay, since whether a
 * block is served at all is not what the reveal is about.
 */
export function revealDeviceHidden(
  document: BlockDocument,
  ids: readonly string[]
): BlockDocument {
  if (ids.length === 0) return document;
  const wanted = new Set(ids);
  let changed = false;
  const nodes = mapForest(document.nodes, (node: BlockNode) => {
    if (!wanted.has(node.id) || storedDevices(node.visibility) === undefined) {
      return node;
    }
    changed = true;
    const next = withDevices(node.visibility, {});
    const { visibility: _previous, ...rest } = node;
    return next === undefined ? rest : { ...rest, visibility: next };
  });
  return changed ? { ...document, nodes } : document;
}

/**
 * The document with every block's visibility conditions lifted, for an
 * editor canvas that draws each conditioned block so the author can see and
 * select it, marked as conditional, whoever the page would show it to.
 *
 * Editor-only by construction, as {@link revealDeviceHidden} is: a new
 * document for a surface to draw, never stored. A block's devices stay, so
 * per-device hiding reads on the canvas as it always has. The same document
 * when no block holds conditions.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function revealConditioned(document: BlockDocument): BlockDocument {
  let changed = false;
  const nodes = mapForest(document.nodes, (node: BlockNode) => {
    const lifted = liftedVisibility(node.visibility);
    if (lifted === node.visibility) return node;
    changed = true;
    const { visibility: _previous, ...rest } = node;
    return lifted === undefined ? rest : { ...rest, visibility: lifted };
  });
  return changed ? { ...document, nodes } : document;
}

/**
 * A visibility with its conditions and placement gates removed: the same
 * value when it holds neither, `undefined` when nothing is left. A visibility
 * nothing can read keeps nothing, since it can't be split into devices to
 * keep and conditions to lift.
 */
function liftedVisibility(
  visibility: BlockNode["visibility"]
): BlockNode["visibility"] {
  if (visibility === undefined || visibility === null) return visibility;
  if (!isPlainRecord(visibility)) return undefined;
  if (!hasConditionKeys(visibility)) return visibility;
  const { conditions: _conditions, within: _within, ...kept } = visibility;
  return Object.keys(kept).length === 0 ? undefined : kept;
}

/** Whether a visibility holds conditions or placement gates to lift. */
function hasConditionKeys(
  visibility: Readonly<Record<string, unknown>>
): boolean {
  return (
    Object.hasOwn(visibility, "conditions") ||
    Object.hasOwn(visibility, "within")
  );
}
