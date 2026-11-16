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
 * What is counted is what is STORED, because that is what a removal deletes:
 * a value the stylesheet does not write (an unknown property, a value it
 * cannot read, a block whose id another shares, a shared style the library
 * drops) is deleted all the same. Counting only what the page draws would
 * leave such deletions out, and a count that says less than a removal deletes
 * is the one direction a confirmation must never err in.
 *
 * @module breakpoint-removal/usage
 * @experimental
 */
import {
  DEFAULT_LIMITS,
  documentRefusal,
  isPlainRecord,
  MAX_SCANNED_KEYS,
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

/** The breakpoints asked about: some, by id, or every one a value holds. */
export type AskedBreakpoints = ReadonlySet<string> | "every";

/**
 * The keys of a stored record whose values `holds` accepts, read no further
 * than `bound`: as far as the engine reads the same record, so a count here
 * covers exactly the keys the engine acts on. Read with an early break rather
 * than `Object.keys`, which builds every key before anything can stop it.
 */
function* keysHolding(
  record: Record<string, unknown>,
  holds: (value: unknown) => boolean,
  bound: number
): Generator<string> {
  let read = 0;
  for (const key in record) {
    if (!Object.hasOwn(record, key)) continue;
    read += 1;
    if (read > bound) return;
    if (holds(record[key])) yield key;
  }
}

/** The keys of `record` asked about whose values `holds` accepts. */
function* askedKeys(
  record: Record<string, unknown>,
  asked: AskedBreakpoints,
  holds: (value: unknown) => boolean,
  bound: number
): Generator<string> {
  if (asked === "every") {
    yield* keysHolding(record, holds, bound);
    return;
  }
  for (const id of asked) {
    if (Object.hasOwn(record, id) && holds(record[id])) yield id;
  }
}

/** How many style values one breakpoint's entry holds; none for an empty one. */
function valueCount(values: unknown): number {
  if (!isPlainRecord(values)) return 0;
  return [...keysHolding(values, () => true, MAX_SCANNED_KEYS)].length;
}

/** Whether a breakpoint's entry holds a value the compiler would emit. */
function holdsValues(values: unknown): boolean {
  return valueCount(values) > 0;
}

/** Whether a stored per-device setting is one: anything else applies nothing. */
function isSetting(value: unknown): boolean {
  return typeof value === "boolean";
}

/**
 * Count a style envelope's values under the breakpoints asked about, in the
 * states the compiler writes: anything under a state it does not know is
 * written at no breakpoint, so no breakpoint's removal drops it. A state's map
 * is read no further than the compiler reads one: a map wider than that is
 * corrupt, and the keys past it are never read.
 */
function countEnvelope(
  styles: unknown,
  asked: AskedBreakpoints,
  uses: BreakpointUses,
  locked: boolean
): void {
  if (!isPlainRecord(styles)) return;
  for (const state of STYLE_STATES) {
    const byBreakpoint = styles[state];
    if (!isPlainRecord(byBreakpoint)) continue;
    for (const id of askedKeys(
      byBreakpoint,
      asked,
      holdsValues,
      MAX_SCANNED_KEYS
    )) {
      const use = entryFor(uses, id);
      use.styles += valueCount(byBreakpoint[id]);
      use.locked ||= locked;
    }
  }
}

/**
 * What a stored blocks value keeps under the breakpoints asked about: each
 * block's styles and own visibility, and the page's own styles.
 *
 * The blocks are the ones the compiler reads, by the engine's own walk within
 * `limits`, slot content included. A block inside a locked one is held by
 * that lock too. Visibility is read whole, as validation and the compiler
 * both read it. An unreadable value keeps nothing.
 */
export function breakpointUsesIn(
  stored: unknown,
  asked: AskedBreakpoints,
  limits: DocumentLimits = DEFAULT_LIMITS
): ValueUses {
  const uses: BreakpointUses = new Map();
  const document = readStoredJson(stored);
  if ((asked !== "every" && asked.size === 0) || !isPlainRecord(document)) {
    return { uses, complete: true };
  }
  // A document this version cannot interpret (an unknown format or kind, or
  // a broken envelope) may keep values in a shape nothing here reads, so
  // whatever is counted from it is not the whole of it.
  const readable = documentRefusal(document) === undefined;
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
    countEnvelope(read.styles, asked, uses, locked);
    const devices = isPlainRecord(read.visibility)
      ? read.visibility.devices
      : undefined;
    if (!isPlainRecord(devices)) return;
    for (const id of askedKeys(devices, asked, isSetting, Infinity)) {
      const use = entryFor(uses, id);
      use.hides += 1;
      use.locked ||= locked;
    }
  });
  const settings = document.settings;
  if (isPlainRecord(settings)) {
    countEnvelope(settings.styles, asked, uses, false);
  }
  return { uses, complete: readable && selection.stopped === undefined };
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
