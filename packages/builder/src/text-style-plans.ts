/**
 * What Design's Type → "Text styles" writes: a new text style, a copy of
 * one, a rename, and a size made fluid. Each is the site's whole class list after the action,
 * so the host stores it through the one writer every class write joins (and
 * so it undoes as one step), or why it can't be.
 *
 * A rename keeps the text style's id and class name, so every block and
 * Site text row following it keeps doing so; only the name changes.
 *
 * @module text-style-plans
 */
import {
  BASE_BREAKPOINT,
  fluidValue,
  isTextStyle,
  MAX_NAMED_CLASS_NAME_LENGTH,
  newId,
  tokenLabelIssue,
  type FluidRangeWidths,
  type FluidSizes,
  type NamedClass,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";

import {
  firstCopyName,
  nextOrderIndex,
  unusedSlug,
  type BlockStylePlan,
} from "./block-style-plans";
import { sharedStyleName, sharedStyleSlug } from "./shared-style-library";

/** A text style action's answer: the classes to store and the style it made, or why not. */
export type TextStylePlanResult = BlockStylePlan;

/** What a text style no longer on the site is told. */
const GONE = "This text style is no longer on the site.";

/** A text style by id, or `undefined` for none, or a class of another kind. */
function textStyleOf(
  library: readonly NamedClass[],
  id: string
): NamedClass | undefined {
  return library.find(entry => entry.id === id && isTextStyle(entry));
}

/** Whether another text style has this name, in any case. */
function nameHeld(
  library: readonly NamedClass[],
  label: string,
  except: string | undefined
): boolean {
  return library.some(
    entry =>
      entry.id !== except &&
      isTextStyle(entry) &&
      sharedStyleName(entry).toLowerCase() === label.toLowerCase()
  );
}

/** Why a name can't be a text style's, or `undefined`. */
function nameRefusal(
  library: readonly NamedClass[],
  label: string,
  except: string | undefined
): string | undefined {
  if (label === "") return "A text style needs a name.";
  const issue = tokenLabelIssue(label);
  if (issue !== undefined) return issue.replace("A label", "A name");
  if (sharedStyleSlug(label) === "") {
    return "Use at least one letter or digit in the name.";
  }
  if (nameHeld(library, label, except)) {
    return `There is already a text style named “${label}”. Choose another name.`;
  }
  return undefined;
}

/** A text style the site made, last in the library, with the styles given. */
function madeTextStyle(
  library: readonly NamedClass[],
  label: string,
  styles: NamedClass["styles"],
  mintId: () => string
): NamedClass {
  const slug = sharedStyleSlug(label)
    .slice(0, MAX_NAMED_CLASS_NAME_LENGTH)
    .replace(/-+$/, "");
  return {
    id: mintId(),
    slug: unusedSlug(library, slug),
    label,
    orderIndex: nextOrderIndex(library),
    role: "text",
    // A copy, so an edit to the new style never edits the one it came from.
    styles: structuredClone(styles),
  };
}

/**
 * A new text style, named by the author, on the site's Body font: a start
 * every other part is then set over.
 */
export function newTextStylePlan(
  library: readonly NamedClass[],
  name: string,
  mintId: () => string = newId
): TextStylePlanResult {
  const label = name.trim();
  const refusal = nameRefusal(library, label, undefined);
  if (refusal !== undefined) return { ok: false, reason: refusal };
  const entry = madeTextStyle(
    library,
    label,
    { base: { [BASE_BREAKPOINT]: { fontFamily: { $token: "font.body" } } } },
    mintId
  );
  return { ok: true, classes: [...library, entry], id: entry.id };
}

/** The first "<name> copy", "<name> copy 2"… no text style is named. */
function copyName(
  library: readonly NamedClass[],
  name: string
): string | undefined {
  return firstCopyName(
    name,
    candidate => nameRefusal(library, candidate, undefined) === undefined
  );
}

/**
 * A copy of a text style: its parts and the sizes a fluid size was made
 * from (each only while it still makes its size across `range`), under the
 * next free "copy" name, and unlocked, since a lock is the original's.
 */
export function duplicateTextStylePlan(
  library: readonly NamedClass[],
  id: string,
  mintId: () => string = newId,
  /** The site's fluid range now, or `undefined` where it is not known. */
  range?: FluidRangeWidths
): TextStylePlanResult {
  const source = textStyleOf(library, id);
  if (source === undefined) return { ok: false, reason: GONE };
  const label = copyName(library, sharedStyleName(source));
  if (label === undefined) {
    return {
      ok: false,
      reason: `There are as many copies of “${sharedStyleName(source)}” as a name can count. Rename one first.`,
    };
  }
  const made = madeTextStyle(library, label, source.styles, mintId);
  // The sizes its fluid sizes were made from go with them, so the copy's
  // follow a change of the site's fluid range as the original's do.
  const fluidSizes = fluidSizesStillMaking(source, range);
  const entry = fluidSizes === undefined ? made : { ...made, fluidSizes };
  return { ok: true, classes: [...library, entry], id: entry.id };
}

/**
 * A text style's fluid sizes for each device whose size they still make
 * across `range`, or `undefined` for none. A size typed since, or made across
 * another range, is the author's: sizes copied beside it would be taken for
 * the ones it was made from, and the copy's size made again from them.
 * Nothing is copied where the range is not known.
 */
function fluidSizesStillMaking(
  source: NamedClass,
  range: FluidRangeWidths | undefined
): NamedClass["fluidSizes"] {
  const sizes = source.fluidSizes;
  if (sizes === undefined || range === undefined) return undefined;
  const atRest = source.styles.base ?? {};
  const kept = Object.entries(sizes).filter(
    ([device, made]) => atRest[device]?.fontSize === fluidValue(made, range)
  );
  return kept.length === 0 ? undefined : Object.fromEntries(kept);
}

/**
 * A text style an action may change, or why not: it is gone, or locked, said
 * with the action's own words after "<name> is locked".
 */
function unlockedTextStyle(
  library: readonly NamedClass[],
  id: string,
  whenLocked: string
): { readonly source: NamedClass } | { readonly reason: string } {
  const source = textStyleOf(library, id);
  if (source === undefined) return { reason: GONE };
  return source.locked === true
    ? { reason: `${sharedStyleName(source)} is locked${whenLocked}` }
    : { source };
}

/**
 * A text style renamed: its name only. Its id and class name stay, so every
 * block and row following it keeps resolving.
 */
export function renameTextStylePlan(
  library: readonly NamedClass[],
  id: string,
  name: string
): TextStylePlanResult {
  // A lock holds a style's name as well as its parts.
  const found = unlockedTextStyle(library, id, ", so it can't be renamed.");
  if ("reason" in found) return { ok: false, reason: found.reason };
  const { source } = found;
  const label = name.trim();
  const refused = nameRefusal(library, label, id);
  if (refused !== undefined) return { ok: false, reason: refused };
  return {
    ok: true,
    classes: library.map(entry =>
      entry === source ? { ...entry, label } : entry
    ),
    id,
  };
}

/**
 * A text style's size on one device made fluid: the value "Fluid…" made, and
 * the two sizes it was made from kept beside the styles, so a change of the
 * site's fluid range makes the size again. One edit, so the two are stored
 * and undone together, and never apart.
 */
export function fluidTextStyleSizePlan(
  library: readonly NamedClass[],
  id: string,
  device: string,
  sizes: FluidSizes,
  value: string
): TextStylePlanResult {
  const found = unlockedTextStyle(library, id, ". Unlock it to change it.");
  if ("reason" in found) return { ok: false, reason: found.reason };
  const { source } = found;
  const atRest = source.styles.base ?? {};
  const styles: NodeStyles = {
    ...source.styles,
    base: { ...atRest, [device]: { ...atRest[device], fontSize: value } },
  };
  const fluidSizes = {
    ...source.fluidSizes,
    [device]: { small: sizes.small, large: sizes.large },
  };
  return {
    ok: true,
    classes: library.map(entry =>
      entry === source ? { ...entry, styles, fluidSizes } : entry
    ),
    id,
  };
}
