/**
 * What the Design panel's Shared styles tab shows, and the rules behind each
 * edit it offers: a style's name and the class name derived from it, the
 * search, and how widely a style is used, said in words.
 *
 * Rules here, presentation in {@link shared-styles-panel}, so each is tested
 * without a DOM. Built on {@link class-library}: the rows are the classes the
 * compiler emits, and a declaration is what the compiler writes.
 *
 * @module shared-style-library
 */
import {
  MAX_NAMED_CLASS_NAME_LENGTH,
  namedClassName,
  tokenLabelIssue,
  type NamedClass,
  type NodeStyles,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";

import {
  classDeclarations,
  everyClassDeclaration,
  usableSiteClasses,
} from "./class-library";
import { EDITOR_WORDS } from "./editor-words";

/** The kinds of document a shared style is counted on. */
export type SharedStyleKind = "pages" | "components" | "patterns" | "layouts";

/** How widely one shared style is used across the site, from the index. */
export interface SharedStyleReach {
  /** How many documents apply it. */
  readonly documents: number;
  /** The same documents, by kind. */
  readonly byKind: Readonly<Record<SharedStyleKind, number>>;
  /** False makes both numbers floors: "at least". */
  readonly complete: boolean;
}

/** One read of how widely some shared styles are used. */
export interface SharedStylesUsage {
  /** Whether every page has been counted, so counts can be exact. */
  readonly whole: boolean;
  /** Whether this author may lock and unlock shared styles. */
  readonly mayLock: boolean;
  /** Each style asked about, by id. */
  readonly styles: ReadonlyMap<string, SharedStyleReach>;
}

/** One document a shared style is used on. */
export interface SharedStyleUse {
  /** Unique only within its collection. */
  readonly id: string;
  readonly title: string;
  /** The collection holding it: with `id`, what tells one document from another. */
  readonly collection: string;
  readonly kind: SharedStyleKind;
}

/** One page of the documents a shared style is used on. */
export interface SharedStyleUsesPage {
  readonly items: readonly SharedStyleUse[];
  /** Every document this author may open, across all pages. */
  readonly total: number;
  /** Documents using it that this author may not open. */
  readonly hidden: number;
  /** Whether another page follows. */
  readonly hasNext: boolean;
  /** False while some pages are still being counted. */
  readonly complete: boolean;
}

/** One shared style as the tab lists it. */
export interface SharedStyleRow {
  readonly id: string;
  /** The name an author gave it, or its slug when it has none. */
  readonly name: string;
  readonly slug: string;
  /** The class the page carries, as hand-written CSS selects it: `.nx-c-card`. */
  readonly className: string;
  readonly locked: boolean;
  /** Supplied by the site's code: shown, never renamed, locked or removed. */
  readonly inCode: boolean;
  readonly styles: NodeStyles;
}

/** The tab's own name inside a sentence. */
export const SHARED_STYLES_WORD: string =
  EDITOR_WORDS.sharedStyles.toLowerCase();

/** Every shared style the site renders, in the order that decides precedence. */
export function sharedStyleRows(
  library: readonly NamedClass[],
  suppliedIds: ReadonlySet<string>
): SharedStyleRow[] {
  return usableSiteClasses(library).map(entry => ({
    id: entry.id,
    name: sharedStyleName(entry),
    slug: entry.slug,
    className: `.${namedClassName(entry.slug)}`,
    locked: entry.locked === true,
    inCode: suppliedIds.has(entry.id),
    styles: entry.styles,
  }));
}

/** A style's name: its label, or its slug for a style made before labels. */
function sharedStyleName(entry: Pick<NamedClass, "slug" | "label">): string {
  const label = entry.label?.trim();
  return label === undefined || label === "" ? entry.slug : label;
}

/**
 * The class name a name gives: lowercase letters, digits and dashes, starting
 * with a letter, as the engine's slug grammar requires. Empty when the name
 * holds no letter or digit at all.
 */
export function sharedStyleSlug(name: string): string {
  const words = name
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  if (words === "") return "";
  // A class name may not start with a digit, so "2 columns" reads as a style.
  const slug = /^[a-z]/.test(words) ? words : `style-${words}`;
  return slug.slice(0, MAX_NAMED_CLASS_NAME_LENGTH).replace(/-+$/, "");
}

/** A rename's verdict: the label and slug to store, or why not. */
export type SharedStyleRename =
  | { readonly ok: true; readonly label: string; readonly slug: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Whether a style may take a new name, and the label and class name to store
 * if it may. The class name is derived from the name, and a class name
 * another style already has is refused, since two styles with one class name
 * would write one selector and the later would be dropped.
 */
export function renameSharedStyle(
  name: string,
  classId: string,
  library: readonly NamedClass[]
): SharedStyleRename {
  const label = name.trim();
  if (label === "")
    return { ok: false, reason: "A shared style needs a name." };
  const labelIssue = tokenLabelIssue(label);
  if (labelIssue !== undefined) {
    return { ok: false, reason: labelIssue.replace("A label", "A name") };
  }
  const slug = sharedStyleSlug(label);
  if (slug === "") {
    return {
      ok: false,
      reason: "Use at least one letter or digit in the name.",
    };
  }
  if (library.some(entry => entry.id !== classId && entry.slug === slug)) {
    return {
      ok: false,
      reason: `“${slug}” is already a shared style. Choose another name.`,
    };
  }
  return { ok: true, label, slug };
}

/** Text for a search: lowercase, with dashes, dots and runs of space as one space. */
function searchable(text: string): string {
  return text.toLowerCase().replaceAll(/[\s\-_.]+/g, " ");
}

/**
 * What a row is found by: its name, its class name as written and as the page
 * emits it, and every property and value it sets, in every state and at every
 * breakpoint. A value naming a variable is found by the variable's name,
 * since the reference compiles to that name.
 */
export function sharedStyleSearchText(
  row: SharedStyleRow,
  context?: StyleCompileContext
): string {
  const declarations = everyClassDeclaration(row.styles, context).map(
    entry => `${entry.property}: ${entry.value}`
  );
  return searchable(
    [row.name, row.slug, row.className, ...declarations].join("\n")
  );
}

/** The rows a search finds, by name, class name, property or value. */
export function searchSharedStyles(
  rows: readonly SharedStyleRow[],
  query: string,
  textOf: (row: SharedStyleRow) => string
): SharedStyleRow[] {
  const needle = searchable(query.trim());
  if (needle === "") return [...rows];
  return rows.filter(row => textOf(row).includes(needle));
}

/** What a style declares at the base, as lines, and how much more elsewhere. */
export function sharedStyleDeclares(
  styles: NodeStyles,
  context?: StyleCompileContext
): { lines: string[]; elsewhere: number } {
  const { shown, elsewhere } = classDeclarations(styles, context);
  return {
    lines: shown.map(entry => `${entry.property}: ${entry.value}`),
    elsewhere,
  };
}

/**
 * The base declarations a row's "Aa" is drawn with: its colours and type,
 * where the value stands alone. A value reading a variable or a file is left
 * out, since the panel has neither the site's variables nor its hosts.
 */
const PREVIEWED: Readonly<Record<string, string>> = {
  color: "color",
  "background-color": "backgroundColor",
  "font-family": "fontFamily",
  "font-weight": "fontWeight",
  "font-style": "fontStyle",
};

export function sharedStylePreview(
  styles: NodeStyles,
  context?: StyleCompileContext
): Record<string, string> {
  const preview: Record<string, string> = {};
  for (const entry of classDeclarations(styles, context).shown) {
    const key = Object.hasOwn(PREVIEWED, entry.property)
      ? PREVIEWED[entry.property]
      : undefined;
    if (key === undefined || entry.descendant !== undefined) continue;
    if (/\b(?:var|url)\(/i.test(entry.value)) continue;
    preview[key] = entry.value;
  }
  return preview;
}

const KIND_WORDS: Record<SharedStyleKind, readonly [string, string]> = {
  pages: ["page", "pages"],
  components: ["component", "components"],
  patterns: ["pattern", "patterns"],
  layouts: ["layout", "layouts"],
};

/** A kind as a document is labelled in a list: "Page", "Component". */
export function sharedStyleKindName(kind: SharedStyleKind): string {
  const [one] = KIND_WORDS[kind];
  return one.charAt(0).toUpperCase() + one.slice(1);
}

/** "1 page", "4 pages". */
function counted(
  count: number,
  [one, many]: readonly [string, string]
): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "a", "a and b", "a, b and c". */
function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

/** The blocks on the open page that carry a style. */
export interface BlocksOnThisPage {
  readonly count: number;
  /** False when the page has more blocks than could be read. */
  readonly complete: boolean;
}

/**
 * How widely a style is used, in words: "3 blocks on this page · on 4 pages
 * and 1 component". The blocks come from the open page, the documents from
 * the site's index; "at least" goes before a number that is a floor.
 * Empty while neither is known.
 */
export function sharedStyleReachSentence(
  blocks: BlocksOnThisPage | undefined,
  reach: SharedStyleReach | undefined
): string {
  const parts: string[] = [];
  if (blocks !== undefined && blocks.count > 0) {
    const count = counted(blocks.count, ["block", "blocks"]);
    parts.push(`${blocks.complete ? "" : "at least "}${count} on this page`);
  }
  if (reach !== undefined) {
    const kinds = (Object.keys(KIND_WORDS) as SharedStyleKind[])
      .filter(kind => reach.byKind[kind] > 0)
      .map(kind => counted(reach.byKind[kind], KIND_WORDS[kind]));
    if (kinds.length > 0) {
      parts.push(`on ${reach.complete ? "" : "at least "}${listed(kinds)}`);
    }
  }
  if (parts.length > 0) {
    const sentence = parts.join(" · ");
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
  }
  if (reach === undefined) return "";
  const exact = reach.complete && (blocks?.complete ?? true);
  return exact ? "Not used anywhere" : "No uses counted yet";
}

/** A row's count: its documents, with "+" when that is a floor. */
export function sharedStyleReachChip(reach: SharedStyleReach): string {
  return `${reach.documents}${reach.complete ? "" : "+"}`;
}

/**
 * Whether a style may be removed from its popover: only when it is stored
 * here, unlocked, every page has been counted, and nothing uses it, this open
 * page included (its unsaved blocks are not in the index yet).
 *
 * `quiet` when the popover already says why elsewhere (locked, set in code)
 * or while the usage is still being read.
 */
export type SharedStyleRemoval =
  | { readonly kind: "removable" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "quiet" };

export function sharedStyleRemoval(
  row: Pick<SharedStyleRow, "locked" | "inCode">,
  blocks: BlocksOnThisPage | undefined,
  reach: SharedStyleReach | undefined,
  whole: boolean | undefined
): SharedStyleRemoval {
  if (row.inCode || row.locked) return { kind: "quiet" };
  if (reach === undefined || whole === undefined) return { kind: "quiet" };
  if (!whole)
    return { kind: "refused", reason: SHARED_STYLE_NOT_WHOLE_REMOVAL };
  if (!isUnused(blocks, reach)) {
    return {
      kind: "refused",
      reason:
        "In use, so it can’t be removed. Take it off the blocks that use it first.",
    };
  }
  return { kind: "removable" };
}

/**
 * Whether nothing uses a style: no document the index counted, in full, and
 * no block on the open page, read in full. Unknown reads as used.
 */
export function isUnused(
  blocks: BlocksOnThisPage | undefined,
  reach: SharedStyleReach
): boolean {
  return (
    sharedStyleUse(blocks, reach) === "unused" &&
    blocks !== undefined &&
    blocks.complete &&
    reach.complete
  );
}

/**
 * Whether any use of a style has been counted: on a block of the open page or
 * on a document in the index. "unused" says only that none has been counted;
 * it is certain once every count is ({@link isUnused}). Undefined while the
 * style's usage has not been read.
 */
export function sharedStyleUse(
  blocks: BlocksOnThisPage | undefined,
  reach: SharedStyleReach | undefined
): "used" | "unused" | undefined {
  if (reach === undefined) return undefined;
  return (blocks?.count ?? 0) > 0 || reach.documents > 0 ? "used" : "unused";
}

/** Which styles the tab lists: every one, or those used, unused or locked. */
export type SharedStyleFilter = "all" | "used" | "unused" | "locked";

/** The filters in the order the tab offers them, with their words. */
export const SHARED_STYLE_FILTERS: readonly {
  readonly filter: SharedStyleFilter;
  readonly word: string;
}[] = [
  { filter: "all", word: "All" },
  { filter: "used", word: "Used" },
  { filter: "unused", word: "Unused" },
  { filter: "locked", word: "Locked" },
];

/**
 * Whether a row belongs under a filter. A style whose usage has not been read
 * yet is under neither Used nor Unused until it has.
 */
export function inSharedStyleFilter(
  row: Pick<SharedStyleRow, "locked">,
  filter: SharedStyleFilter,
  use: "used" | "unused" | undefined
): boolean {
  if (filter === "all") return true;
  if (filter === "locked") return row.locked;
  return use === filter;
}

/** What the tab says when a filter, with or without a search, lists nothing. */
export function sharedStyleFilterEmpty(
  filter: Exclude<SharedStyleFilter, "all">,
  query: string
): string {
  const word = SHARED_STYLE_FILTERS.find(entry => entry.filter === filter);
  const kind = `${(word?.word ?? filter).toLowerCase()} ${SHARED_STYLES_WORD}`;
  return query === "" ? `No ${kind}.` : `No ${kind} match “${query}”.`;
}

/**
 * The words the remove route refuses with while the index is not whole, so
 * the tab says the same before it is asked.
 */
export const SHARED_STYLE_NOT_WHOLE_REMOVAL =
  "Some pages are still being counted, so no shared style can be removed yet.";

/**
 * Why Lock, Remove and Remove unused wait: a rename writes the whole list of
 * styles, and so does each of them, so whichever landed second would put the
 * other's list back.
 */
export const SHARED_STYLE_RENAME_PENDING =
  "Wait until the name change is saved.";

/** The note under counts that are floors. */
export const SHARED_STYLE_NOT_WHOLE_NOTE =
  "Some pages are still being counted, so these numbers are minimums.";
