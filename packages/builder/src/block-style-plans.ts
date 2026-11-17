/**
 * What the Styles tab's block style actions write: a new block style made
 * from the ★ style's values, a copy of one, the ★ moved, and a built-in style
 * hidden or shown again. Each is the site's whole class list after the
 * action, so the host stores it through the one writer every class write
 * joins, or why it can't be.
 *
 * A rename keeps the style's id and its class name, so every document
 * wearing it keeps resolving; only the name the author reads changes.
 *
 * @module block-style-plans
 * @experimental Settles with the Styles tab's Block styles.
 */

import {
  isDefaultLook,
  isLook,
  MAX_NAMED_CLASS_NAME_LENGTH,
  MAX_TOKEN_LABEL_LENGTH,
  newId,
  starredLooksOf,
  tokenLabelIssue,
  type NamedClass,
} from "@nextlyhq/blocks-engine";

import { usableSiteClasses } from "./class-library";
import { sharedStyleName, sharedStyleSlug } from "./shared-style-library";

/** A block style action's answer: the classes to store and the style it made, or why not. */
export type BlockStylePlan =
  | {
      readonly ok: true;
      readonly classes: NamedClass[];
      /** The style the action made. */
      readonly id: string;
    }
  | { readonly ok: false; readonly reason: string };

/** What a block style no longer on the site is told. */
const BLOCK_STYLE_GONE = "This block style is no longer on the site.";

/** A block type's ★ style as the page draws it, or `undefined` while its own style is. */
function starredStyleOf(
  library: readonly NamedClass[],
  blockType: string
): NamedClass | undefined {
  return starredLooksOf(usableSiteClasses(library)).get(blockType);
}

/** The part of a block style's class name its type gives: `button`, `acme-hero`. */
function typeSlug(blockType: string): string {
  return blockType.startsWith("core/")
    ? blockType.slice("core/".length)
    : blockType.replace("/", "-");
}

/**
 * The class name a block style of this type takes from its name, as the
 * built-in ones are written (`button-outline`), cut to the longest a class
 * name may be.
 */
function blockStyleSlug(blockType: string, name: string): string {
  const words = sharedStyleSlug(name);
  if (words === "") return "";
  return `${typeSlug(blockType)}-${words}`
    .slice(0, MAX_NAMED_CLASS_NAME_LENGTH)
    .replace(/-+$/, "");
}

/** Whether another style of the block type has this name, in any case. */
function nameHeld(
  library: readonly NamedClass[],
  blockType: string,
  label: string,
  except: string | undefined
): boolean {
  return library.some(
    entry =>
      entry.id !== except &&
      isLook(entry) &&
      entry.blockType === blockType &&
      sharedStyleName(entry).toLowerCase() === label.toLowerCase()
  );
}

/** Why a name can't be a block style's, or `undefined`: none, or one unwritable. */
function labelRefusal(blockType: string, label: string): string | undefined {
  if (label === "") return "A block style needs a name.";
  const issue = tokenLabelIssue(label);
  if (issue !== undefined) return issue.replace("A label", "A name");
  if (blockStyleSlug(blockType, label) === "") {
    return "Use at least one letter or digit in the name.";
  }
  return undefined;
}

/** What a name another style of the type has is told. */
function heldWords(blockTitle: string, label: string): string {
  return `${blockTitle} already has a style named “${label}”. Choose another name.`;
}

/**
 * Why a name can't be a new block style of this type, or `undefined`: its
 * name, or the class name it gives, is another style's.
 */
function nameRefusal(
  library: readonly NamedClass[],
  blockType: string,
  label: string,
  blockTitle: string
): string | undefined {
  const refused = labelRefusal(blockType, label);
  if (refused !== undefined) return refused;
  const slug = blockStyleSlug(blockType, label);
  if (
    nameHeld(library, blockType, label, undefined) ||
    library.some(entry => entry.slug === slug)
  ) {
    return heldWords(blockTitle, label);
  }
  return undefined;
}

/** The next position in the library: after every style, so the new one is last. */
function nextOrderIndex(library: readonly NamedClass[]): number {
  return (
    library.reduce(
      (max, entry) =>
        Number.isFinite(entry.orderIndex)
          ? Math.max(max, entry.orderIndex)
          : max,
      -1
    ) + 1
  );
}

/**
 * The block style a block can wear with this id, or `undefined`: none is on
 * the site, or the id is a block's own style, which no block wears.
 */
function wornStyleOf(
  library: readonly NamedClass[],
  id: string
): NamedClass | undefined {
  const source = library.find(entry => entry.id === id && isLook(entry));
  return source === undefined || isDefaultLook(source) ? undefined : source;
}

/** A block's own style, which stores the site's edits to its base. */
function ownStyleOf(
  library: readonly NamedClass[],
  blockType: string
): NamedClass | undefined {
  return library.find(
    entry => isDefaultLook(entry) && entry.blockType === blockType
  );
}

/**
 * A class name no style in the library has: the one given, or, where a long
 * name was cut to the same one, that one cut further with `-2`, `-3`… on it.
 */
function unusedSlug(library: readonly NamedClass[], slug: string): string {
  const taken = new Set(library.map(entry => entry.slug));
  if (!taken.has(slug)) return slug;
  for (let count = 2; ; count += 1) {
    const end = `-${count}`;
    const next = `${slug.slice(0, MAX_NAMED_CLASS_NAME_LENGTH - end.length).replace(/-+$/, "")}${end}`;
    if (!taken.has(next)) return next;
  }
}

/** A style the site made, for a block type, with the styles given. */
function siteStyle(
  library: readonly NamedClass[],
  blockType: string,
  label: string,
  styles: NamedClass["styles"],
  mintId: () => string
): NamedClass {
  return {
    id: mintId(),
    slug: unusedSlug(library, blockStyleSlug(blockType, label)),
    label,
    orderIndex: nextOrderIndex(library),
    blockType,
    // A copy, so an edit to the new style never edits the one it came from.
    styles: structuredClone(styles),
  };
}

/**
 * A new block style for a block type, named by the author, made from the ★
 * style's values: the ★ style's own when one is chosen, else the site's
 * edits to the block's own style, so it starts out looking as a block of
 * that type does until a style is picked.
 */
export function newBlockStylePlan(
  library: readonly NamedClass[],
  blockType: string,
  name: string,
  blockTitle: string,
  mintId: () => string = newId
): BlockStylePlan {
  const label = name.trim();
  const refusal = nameRefusal(library, blockType, label, blockTitle);
  if (refusal !== undefined) return { ok: false, reason: refusal };
  const from =
    starredStyleOf(library, blockType) ?? ownStyleOf(library, blockType);
  const entry = siteStyle(
    library,
    blockType,
    label,
    from?.styles ?? {},
    mintId
  );
  return { ok: true, classes: [...library, entry], id: entry.id };
}

/** The most copies of one style a copy's name counts to. */
const MAX_COPIES = 999;

/**
 * The first "<name> copy", "<name> copy 2"… no style of the type is named,
 * the name cut so the longest of them is still a name a style may have; or
 * `undefined` once every count is taken. Its class name is made free apart,
 * so two copies of a long name cut to one class name both have one.
 */
function copyName(
  library: readonly NamedClass[],
  blockType: string,
  name: string
): string | undefined {
  const room = MAX_TOKEN_LABEL_LENGTH - ` copy ${MAX_COPIES}`.length;
  const base = name.slice(0, room).trimEnd();
  for (let count = 1; count <= MAX_COPIES; count += 1) {
    const candidate = count === 1 ? `${base} copy` : `${base} copy ${count}`;
    if (
      labelRefusal(blockType, candidate) === undefined &&
      !nameHeld(library, blockType, candidate, undefined)
    ) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * A copy of a block style, built-in or the site's own, as a style the site
 * made: its values, under the next free "copy" name, with none of its marks
 * (★, hidden, locked).
 */
export function duplicateBlockStylePlan(
  library: readonly NamedClass[],
  id: string,
  blockTitle: string,
  mintId: () => string = newId
): BlockStylePlan {
  const source = wornStyleOf(library, id);
  if (source === undefined) return { ok: false, reason: BLOCK_STYLE_GONE };
  const blockType = source.blockType as string;
  const label = copyName(library, blockType, sharedStyleName(source));
  if (label === undefined) {
    return {
      ok: false,
      reason: `${blockTitle} has as many copies of “${sharedStyleName(source)}” as a name can count. Rename one first.`,
    };
  }
  const entry = siteStyle(library, blockType, label, source.styles, mintId);
  return { ok: true, classes: [...library, entry], id: entry.id };
}

/**
 * A block style the site made, renamed: its name only. Its id and class name
 * stay, so every document wearing it keeps resolving.
 */
export function renameBlockStylePlan(
  library: readonly NamedClass[],
  id: string,
  name: string,
  blockTitle: string
): BlockStylePlan {
  const source = wornStyleOf(library, id);
  if (source === undefined) return { ok: false, reason: BLOCK_STYLE_GONE };
  const blockType = source.blockType as string;
  const label = name.trim();
  const refused =
    labelRefusal(blockType, label) ??
    (nameHeld(library, blockType, label, id)
      ? heldWords(blockTitle, label)
      : undefined);
  if (refused !== undefined) return { ok: false, reason: refused };
  return {
    ok: true,
    classes: library.map(entry =>
      entry === source ? { ...entry, label } : entry
    ),
    id,
  };
}

/** A class with one mark set or taken off: present as `true`, never `false`. */
function withMark(
  entry: NamedClass,
  mark: "starred" | "hidden",
  on: boolean
): NamedClass {
  const { [mark]: _was, ...rest } = entry;
  return on ? { ...rest, [mark]: true } : rest;
}

/**
 * The library with ★ on one block style of a type, or given back to the
 * block's own style (`id` `null`): every other style of the type loses it,
 * so one style per type carries ★.
 */
export function withDefaultBlockStyle(
  library: readonly NamedClass[],
  blockType: string,
  id: string | null
): NamedClass[] {
  return library.map(entry => {
    if (!isLook(entry) || entry.blockType !== blockType) return entry;
    const starred = entry.id === id && !isDefaultLook(entry);
    if ((entry.starred === true) === starred) return entry;
    return withMark(entry, "starred", starred);
  });
}

/** The library with one block style hidden, or shown again. */
export function withHiddenBlockStyle(
  library: readonly NamedClass[],
  id: string,
  hidden: boolean
): NamedClass[] {
  return library.map(entry =>
    entry.id === id && isLook(entry) && (entry.hidden === true) !== hidden
      ? withMark(entry, "hidden", hidden)
      : entry
  );
}
