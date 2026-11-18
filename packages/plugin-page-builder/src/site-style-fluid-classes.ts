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
 * It does nothing unless the range the site uses changes, and nothing to a
 * class without fluid sizes, so every other save is as it was.
 *
 * @module site-style-fluid-classes
 */
import {
  DEFAULT_FLUID_RANGE,
  classesAcrossFluidRange,
  isPlainRecord,
  type FluidRangeWidths,
  type NamedClass,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "nextly/errors";

import type { SiteStyleData } from "./site-style";
import { isFluidRange } from "./site-style-record";
import { readStoredJson } from "./stored-json";

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
    const change = rangeChange(hook, defaults);
    if (data === undefined || change === undefined) return undefined;
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
