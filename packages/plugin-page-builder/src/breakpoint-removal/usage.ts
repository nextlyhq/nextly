/**
 * What a site keeps under each of its breakpoints: the style values and the
 * per-device hides one blocks value or one shared style stores there, and
 * whether a lock holds any of it.
 *
 * The answer a removal is confirmed with. Removing a breakpoint drops every
 * value stored under it, so the author is told how many, where, and which of
 * them a lock was protecting, before anything is dropped.
 *
 * Counted as the confirmation names them: a style is one property value at one
 * state, so a block coloured and padded at a breakpoint holds two; a hide is
 * one block storing its own visibility at the breakpoint.
 *
 * @module breakpoint-removal/usage
 * @experimental
 */
import {
  DEFAULT_LIMITS,
  isPlainRecord,
  selectNodes,
  STYLE_STATES,
  type DocumentLimits,
  type NamedClass,
} from "@nextlyhq/blocks-engine";

import { readStoredJson } from "../stored-json";

/** What one value keeps under one breakpoint. */
export interface BreakpointUse {
  /** Style property values, across every state. */
  styles: number;
  /** Blocks storing their own visibility at the breakpoint. */
  hides: number;
  /** Whether any of it is on a block a Layers lock holds. */
  locked: boolean;
}

/** One value's use of each breakpoint asked about; an id it holds nothing under is absent. */
export type BreakpointUses = Map<string, BreakpointUse>;

/**
 * Whether a blocks value could be read to the end: a value the engine's walk
 * stopped inside holds blocks nothing here has counted.
 */
export interface ValueUses {
  readonly uses: BreakpointUses;
  readonly complete: boolean;
}

/** The use of `id` in `uses`, made when first asked for. */
function entryFor(uses: BreakpointUses, id: string): BreakpointUse {
  let use = uses.get(id);
  if (use === undefined) {
    use = { styles: 0, hides: 0, locked: false };
    uses.set(id, use);
  }
  return use;
}

/**
 * Count a style envelope's values under each of `ids`, in the states the
 * compiler writes: anything under a state it does not know is written at no
 * breakpoint, so no breakpoint's removal drops it.
 */
function countEnvelope(
  styles: unknown,
  ids: ReadonlySet<string>,
  uses: BreakpointUses,
  locked: boolean
): void {
  if (!isPlainRecord(styles)) return;
  for (const state of STYLE_STATES) {
    const byBreakpoint = styles[state];
    if (!isPlainRecord(byBreakpoint)) continue;
    for (const id of ids) {
      const values = byBreakpoint[id];
      if (!isPlainRecord(values)) continue;
      const count = Object.keys(values).length;
      if (count === 0) continue;
      const use = entryFor(uses, id);
      use.styles += count;
      use.locked ||= locked;
    }
  }
}

/**
 * What a stored blocks value keeps under each of `ids`: each block's styles
 * and own visibility, and the page's own styles.
 *
 * The blocks are the ones the compiler reads, by the engine's own walk within
 * `limits`, slot content included. A block inside a locked one is held by
 * that lock too. An unreadable value keeps nothing.
 */
export function breakpointUsesIn(
  stored: unknown,
  ids: ReadonlySet<string>,
  limits: DocumentLimits = DEFAULT_LIMITS
): ValueUses {
  const uses: BreakpointUses = new Map();
  const document = readStoredJson(stored);
  if (ids.size === 0 || !isPlainRecord(document)) {
    return { uses, complete: true };
  }
  const selection = selectNodes(document, limits);
  // Level order puts a block's parent before it, so its lock is known.
  const lockedAt: boolean[] = [];
  selection.nodes.forEach(({ node, parent }, index) => {
    const read = node as {
      locked?: unknown;
      styles?: unknown;
      visibility?: unknown;
    };
    const locked = read.locked === true || (lockedAt[parent] ?? false);
    lockedAt[index] = locked;
    countEnvelope(read.styles, ids, uses, locked);
    const devices = isPlainRecord(read.visibility)
      ? read.visibility.devices
      : undefined;
    if (!isPlainRecord(devices)) return;
    for (const id of ids) {
      if (typeof devices[id] !== "boolean") continue;
      const use = entryFor(uses, id);
      use.hides += 1;
      use.locked ||= locked;
    }
  });
  const settings = document.settings;
  if (isPlainRecord(settings)) countEnvelope(settings.styles, ids, uses, false);
  return { uses, complete: selection.stopped === undefined };
}

/** What the shared styles keep under one breakpoint. */
export interface SharedStyleUse {
  /** How many shared styles hold a value there. */
  classes: number;
  /** Style property values, across every state and style. */
  styles: number;
  /** The locked shared styles among them, by the name an author knows. */
  locked: string[];
}

/** The shared styles' use of each of `ids`; an id none holds anything under is absent. */
export function sharedStyleUses(
  classes: readonly NamedClass[],
  ids: ReadonlySet<string>
): Map<string, SharedStyleUse> {
  const found = new Map<string, SharedStyleUse>();
  for (const entry of classes) {
    const uses: BreakpointUses = new Map();
    countEnvelope(entry.styles, ids, uses, false);
    for (const [id, use] of uses) {
      let shared = found.get(id);
      if (shared === undefined) {
        shared = { classes: 0, styles: 0, locked: [] };
        found.set(id, shared);
      }
      shared.classes += 1;
      shared.styles += use.styles;
      if (entry.locked === true) shared.locked.push(entry.label ?? entry.slug);
    }
  }
  return found;
}
