/**
 * Text styles following a change of the site's fluid range, in the write
 * that changes it.
 *
 * A text style's size made with "Fluid…" is stored as the `clamp()` it makes
 * across the range, with the two sizes it was made from (`fluidSizes`). A
 * fluid variable and a fluid Site text row are made again when the range
 * changes, in the tokens section the range lives in; a text style lives in the
 * classes section, so the Site Style Single's write that changes the range
 * makes them again too, before validation, as part of the SAME write: one
 * stored version, under the same `update-site-style` permission, judged by the
 * same validators and lock guard as any classes write.
 *
 * A classes write made across a range the site no longer uses (a save made
 * before a range change and sent after it) has each size whose fluid sizes it
 * newly sets made again across the range stored now, in that write.
 *
 * Nothing else is touched: a write that neither changes the range nor sets
 * new fluid sizes is as it was, and so is every class without fluid sizes.
 *
 * @module site-style-fluid-classes
 */
import {
  DEFAULT_FLUID_RANGE,
  classesAcrossFluidRange,
  fluidValue,
  isFluidSizes,
  isPlainRecord,
  type FluidRangeWidths,
  type FluidSizes,
  type NamedClass,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "nextly/errors";

import type { SiteStyleData } from "./site-style";
import { isFluidRange } from "./site-style-record";
import { readStoredJson, sameStoredValue } from "./stored-json";

/**
 * The name a refusal calls a style by: the lock guard's own, handed in by the
 * Single that runs both, so the two refusals name a style alike.
 */
type StyleName = (entry: Record<string, unknown>) => string;

/** What the hook reads of the Single's before-validate call. */
interface FluidRangeWrite {
  data?: Record<string, unknown>;
  originalData?: Record<string, unknown>;
  user?: { id: string };
  principal?: unknown;
}

/**
 * The range a stored or sent tokens section says the site uses: its own,
 * else the code's, else 360 to 1280, as the editor reads it. `undefined` for
 * a range the validator will refuse, which this hook leaves to it.
 */
function rangeOf(
  tokens: unknown,
  defaults: SiteStyleData | undefined
): FluidRangeWidths | undefined {
  const own = isPlainRecord(tokens) ? tokens.fluidRange : undefined;
  if (own !== undefined) return isFluidRange(own) ? own : undefined;
  const code = defaults?.tokens?.fluidRange;
  return code !== undefined && isFluidRange(code) ? code : DEFAULT_FLUID_RANGE;
}

/** Why a range change is refused: the locked text styles that follow it. */
function lockedRefusal(
  locked: readonly NamedClass[],
  nameOf: StyleName
): NextlyError {
  // Narrowed to a record for the lock guard's rule, which reads stored data.
  const names = locked.map(entry =>
    isPlainRecord(entry) ? nameOf(entry) : entry.id
  );
  const list =
    names.length === 1
      ? `the text style ${names[0]} is locked, and its size follows`
      : `the text styles ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are locked, and their sizes follow`;
  const them = names.length === 1 ? "it" : "them";
  return NextlyError.conflict({
    reason: "state",
    message: `The fluid range wasn't changed, and nothing was saved: ${list} the range. Unlock ${them} first (Design → Type → Text styles, each style's menu → Unlock), then change the range again.`,
    logContext: { classIds: locked.map(entry => entry.id) },
  });
}

/**
 * The Single's before-validate hook: the write's data with the classes made
 * again across the new range, or `undefined` (the data as it is) where the
 * write does not change the range or no class follows it.
 *
 * A locked text style that would change refuses the write for a caller, with
 * every such style named, so nothing of it is stored; server code acting as
 * nobody is trusted, as the lock guard trusts it.
 */
export function fluidClassesFollowRange(
  defaults: SiteStyleData | undefined,
  nameOf: StyleName
): (hook: FluidRangeWrite) => Record<string, unknown> | undefined {
  return hook => {
    const data = hook.data;
    if (data === undefined) return undefined;
    const change = rangeChange(hook, defaults);
    if (change === undefined) {
      return classesMadeAcrossStoredRange(data, hook.originalData, defaults);
    }
    const library = classesLeftBy(data, hook.originalData);
    if (library === undefined) return undefined;
    const across = classesAcrossFluidRange(library, change.from, change.to);
    if (across === library) return undefined;
    if (hook.user !== undefined || hook.principal !== undefined) {
      const locked = across.filter(
        (entry, at) => entry !== library[at] && entry.locked === true
      );
      if (locked.length > 0) throw lockedRefusal(locked, nameOf);
    }
    return { ...data, classes: across };
  };
}

/**
 * The range the site used before this write and the one it uses after, or
 * `undefined` where the write sends no tokens, leaves the range as it was, or
 * sends a range the validator will refuse.
 */
function rangeChange(
  hook: FluidRangeWrite,
  defaults: SiteStyleData | undefined
): { from: FluidRangeWidths; to: FluidRangeWidths } | undefined {
  const data = hook.data;
  if (data === undefined || !Object.hasOwn(data, "tokens")) return undefined;
  const to = rangeOf(readStoredJson(data.tokens), defaults);
  const from = rangeOf(readStoredJson(hook.originalData?.tokens), defaults);
  if (to === undefined || from === undefined) return undefined;
  return to.min === from.min && to.max === from.max ? undefined : { from, to };
}

/** The classes a write leaves stored: its own where it sends them. */
function classesLeftBy(
  data: Record<string, unknown>,
  original: Record<string, unknown> | undefined
): readonly NamedClass[] | undefined {
  const raw = Object.hasOwn(data, "classes") ? data.classes : original?.classes;
  const classes = readStoredJson(raw);
  return Array.isArray(classes)
    ? (classes as readonly NamedClass[])
    : undefined;
}

/**
 * A classes write whose sizes were made fluid across a range the site no
 * longer uses: the save was made before a range change landed and sent after
 * it, as a retry onto the newer copy sends the classes alone. Each device
 * whose fluid sizes are new or changed in this write, and whose size is a
 * clamp, is made again across the range the site uses now, since "Fluid…"
 * writes the clamp from those sizes. A device whose sizes this write leaves
 * as stored is not touched, so a size typed since keeps its value.
 * `undefined` where nothing changes.
 */
function classesMadeAcrossStoredRange(
  data: Record<string, unknown>,
  original: Record<string, unknown> | undefined,
  defaults: SiteStyleData | undefined
): Record<string, unknown> | undefined {
  if (!Object.hasOwn(data, "classes")) return undefined;
  const tokens = Object.hasOwn(data, "tokens") ? data.tokens : original?.tokens;
  const range = rangeOf(readStoredJson(tokens), defaults);
  const incoming = readStoredJson(data.classes);
  if (range === undefined || !Array.isArray(incoming)) return undefined;
  const stored = storedById(original?.classes);
  let changed = false;
  const classes = incoming.map((entry: unknown) => {
    const id = isPlainRecord(entry) ? entry.id : undefined;
    const next = entryAcross(entry, stored.get(id), range);
    if (next !== entry) changed = true;
    return next;
  });
  return changed ? { ...data, classes } : undefined;
}

/** The stored classes by id, the first of each id. */
function storedById(raw: unknown): Map<unknown, unknown> {
  const list = readStoredJson(raw);
  const byId = new Map<unknown, unknown>();
  if (!Array.isArray(list)) return byId;
  for (const entry of list) {
    if (isPlainRecord(entry) && !byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return byId;
}

/** One sent class with each new or changed fluid size made across `range`. */
function entryAcross(
  entry: unknown,
  stored: unknown,
  range: FluidRangeWidths
): unknown {
  const sizes = isPlainRecord(entry) ? entry.fluidSizes : undefined;
  if (!isPlainRecord(entry) || !isPlainRecord(sizes)) return entry;
  let out: Record<string, unknown> = entry;
  for (const device in sizes) {
    const pair = newPairAt(sizes, stored, device);
    if (pair !== undefined) {
      out = withSizeAt(out, device, fluidValue(pair, range));
    }
  }
  return out;
}

/**
 * A device's fluid sizes where this write sets them anew (absent from the
 * stored class, or different there), or `undefined`.
 */
function newPairAt(
  sizes: Record<string, unknown>,
  stored: unknown,
  device: string
): FluidSizes | undefined {
  const pair = Object.hasOwn(sizes, device) ? sizes[device] : undefined;
  if (!isFluidSizes(pair)) return undefined;
  const before = isPlainRecord(stored) ? stored.fluidSizes : undefined;
  const was = isPlainRecord(before) ? before[device] : undefined;
  return sameStoredValue(pair, was) ? undefined : pair;
}

/**
 * The class with one device's clamp set to `size`, copied along the path; the
 * same class where that device's size is not a clamp or already is `size`.
 */
function withSizeAt(
  entry: Record<string, unknown>,
  device: string,
  size: string
): Record<string, unknown> {
  const styles = isPlainRecord(entry.styles) ? entry.styles : {};
  const atRest = isPlainRecord(styles.base) ? styles.base : {};
  const values = isPlainRecord(atRest[device]) ? atRest[device] : {};
  const now = values.fontSize;
  if (typeof now !== "string" || !now.startsWith("clamp(") || now === size) {
    return entry;
  }
  return {
    ...entry,
    styles: {
      ...styles,
      base: { ...atRest, [device]: { ...values, fontSize: size } },
    },
  };
}
