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
  classNameOf,
  isLook,
  MAX_NAMED_CLASS_NAME_LENGTH,
  tokenLabelIssue,
  type NamedClass,
  type NodeStyles,
  type SiteTokenSet,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";

import {
  classDeclarations,
  everyClassDeclaration,
  usableSiteClasses,
} from "./class-library";
import { EDITOR_WORDS } from "./editor-words";
import type { TokenMode } from "./font-library";
import { colourHexOf, contrastOf } from "./style-colour";

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
  /**
   * Whether counts that are not whole may still become whole, so they are
   * worth asking for again. False when something the index cannot reach
   * keeps them floors for good.
   *
   * Optional, so a host written before it existed still compiles. Absent
   * means unknown, and the tab asks again as it does while counting: every
   * 15 seconds while the counts are not whole, until 20 asks in a row change
   * nothing (`USAGE_RECOUNT_MS` and `USAGE_RECOUNT_IDLE_MAX` in the panel), so
   * it neither stops while the counts still move nor asks for ever where they
   * cannot finish.
   */
  readonly counting?: boolean;
  /** Whether this author may lock and unlock shared styles. */
  readonly mayLock: boolean;
  /**
   * Whether this author may ask for the pages to be counted now
   * ({@link SharedStylesAccess.count}). Optional, so a host written before it
   * existed still compiles; absent means no.
   *
   * @experimental Settles with the Shared styles tab.
   */
  readonly mayCount?: boolean;
  /** Each style asked about, by id. */
  readonly styles: ReadonlyMap<string, SharedStyleReach>;
}

/**
 * What asking for the pages to be counted now answered: how far the counting
 * got, in the usage read's terms, or why it was refused.
 *
 * @experimental Settles with the Shared styles tab.
 */
export type SharedStylesCount =
  | {
      readonly kind: "counted";
      /** Every page is counted now, so the counts can be exact. */
      readonly whole: boolean;
      /** Pages are left that a further count would reach. */
      readonly counting: boolean;
    }
  | { readonly kind: "refused"; readonly reason: string };

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

/**
 * A removal the host refused, with whether the route said the style is still
 * used (its in-use refusal) rather than refusing for another reason, such as
 * a lock or a count no longer whole.
 *
 * @experimental Settles with the Shared styles tab.
 */
export interface SharedStyleRefusal {
  readonly reason: string;
  readonly inUse: boolean;
}

/**
 * A host's answer to a removal as a refusal, or nothing when it was stored.
 * Words alone are a refusal that does not say the style is used.
 */
export function sharedStyleRefusalOf(
  answer: string | undefined
): SharedStyleRefusal | undefined {
  return answer === undefined ? undefined : { reason: answer, inUse: false };
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
  /** A look, bound to one block type, rather than a shared style. */
  readonly look?: boolean;
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
    // A look's class is written under its own prefix.
    className: `.${classNameOf(entry)}`,
    locked: entry.locked === true,
    inCode: suppliedIds.has(entry.id),
    ...(isLook(entry) ? { look: true } : {}),
    styles: entry.styles,
  }));
}

/**
 * The library without its looks: the shared styles an author applies to any
 * block, as the Shared styles tab and the picker list them. A look is bound
 * to one block type and is picked from that block's own tiles.
 */
export function sharedStylesOnly(library: readonly NamedClass[]): NamedClass[] {
  return library.filter(entry => !isLook(entry));
}

/** A style's name: its label, or its slug for a style made before labels. */
/** A class's name as the surfaces show it: its label, or its slug when blank. */
export function sharedStyleName(
  entry: Pick<NamedClass, "slug" | "label">
): string {
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

/**
 * The rows a search finds, by name, class name, property or value, in their
 * order. Any row a shared style's row extends, so a look's row comes back as
 * the row it was.
 */
export function searchSharedStyles<Row extends SharedStyleRow>(
  rows: readonly Row[],
  query: string,
  textOf: (row: Row) => string
): Row[] {
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

/**
 * The tile a row's "Aa" is drawn on: the site's page, its background and text
 * colours in the mode the canvas shows, so a style's own colours read as they
 * do on a page rather than against the panel. Resolved through the colour
 * controls' own reading of the site's variables ({@link colourHexOf}), by the
 * identities the engine gives the page's two colours.
 *
 * Empty without the site's variables, or for a colour that cannot be read:
 * the tile then keeps its neutral look.
 */
export function sharedStylePageTile(
  tokens: SiteTokenSet | undefined,
  mode: TokenMode
): { backgroundColor?: string; color?: string } {
  const backgroundColor = colourHexOf(
    { $token: "color.background" },
    tokens,
    mode
  );
  const color = colourHexOf({ $token: "color.text" }, tokens, mode);
  return {
    ...(backgroundColor === undefined ? {} : { backgroundColor }),
    ...(color === undefined ? {} : { color }),
  };
}

/**
 * The contrast under which a tile's text counts as hard to read: WCAG AA for
 * normal text, since the "Aa" is small, regular-weight text.
 */
const READABLE_RATIO = 4.5;

/**
 * The engine's own variables, for readable text when the site's are not to
 * hand: a colour the tile can always fall back on.
 */
const ENGINE_TOKENS: SiteTokenSet = { tokens: [] };

/** One row's tile: the page under the preview, the preview, and a dark-mode flag. */
export interface SharedStyleTile {
  /** The page the preview stands on; empty for the neutral tile. */
  readonly page: { backgroundColor?: string; color?: string };
  /** The "Aa": the style's own colours, with readable text where it sets none. */
  readonly specimen: Readonly<Record<string, string>>;
  /**
   * The style's text is under 4.5:1 on the site's dark page, so the tile
   * shows the light page instead and says so.
   */
  readonly darkUnreadable: boolean;
  /**
   * The "Aa" is not shown to read on its background, a colour this cannot
   * measure, so it carries an outline in the page's colour: visible on any
   * background, without measuring it.
   */
  readonly outlined: boolean;
}

/** A canvas 2D context's colour slot, which is all the normaliser reads. */
interface FillStyleSlot {
  fillStyle: unknown;
}

/** The context colours are normalised through, by the constructor it came from. */
let canvasSlot: { maker: unknown; slot: FillStyleSlot | null } | undefined;

/**
 * The browser's 2D context, when there is one: an `OffscreenCanvas`, which
 * needs no document. Absent under a server render and in a test DOM, where
 * colours stay as written.
 */
function fillStyleSlot(): FillStyleSlot | null {
  if (typeof OffscreenCanvas === "undefined") return null;
  if (canvasSlot?.maker !== OffscreenCanvas) {
    canvasSlot = {
      maker: OffscreenCanvas,
      slot: new OffscreenCanvas(1, 1).getContext("2d"),
    };
  }
  return canvasSlot.slot;
}

/**
 * A colour as the browser resolves it, hex or rgba(), so the contrast verdict
 * can read a name, hsl() or any other colour CSS takes: a 2D context's
 * `fillStyle` normalises what it accepts and keeps its old value for what it
 * does not, so the value is set over two different colours and kept only
 * when both read back alike. The colour as written where there is no canvas.
 */
function resolvedColour(colour: string): string {
  const slot = fillStyleSlot();
  if (slot === null) return colour;
  slot.fillStyle = "#000";
  slot.fillStyle = colour;
  const overBlack = slot.fillStyle;
  slot.fillStyle = "#fff";
  slot.fillStyle = colour;
  const overWhite = slot.fillStyle;
  return typeof overBlack === "string" && overBlack === overWhite
    ? overBlack
    : colour;
}

/**
 * The contrast between two colours, each resolved by the browser first
 * ({@link resolvedColour}), by the verdict the colour field shows
 * ({@link contrastOf}); `undefined` when either still cannot be measured.
 * Nothing is guessed: two colours either side of a light/dark line can be
 * all but the same.
 */
function ratioOf(fg: string, bg: string): number | undefined {
  return contrastOf(resolvedColour(fg), resolvedColour(bg), undefined)?.ratio;
}

/**
 * Whether text drawn with `fg` on `bg` reads, by a measured ratio; unknown
 * where the pair cannot be measured, which is never taken as readable.
 */
function readability(fg: string, bg: string): boolean | undefined {
  const ratio = ratioOf(fg, bg);
  return ratio === undefined ? undefined : ratio >= READABLE_RATIO;
}

/**
 * Text that reads on a style's own background when it sets no colour: the
 * page's, else the site's light or dark text, else the engine's own light or
 * dark text, the first that reads. The engine's come last so a site whose
 * text fails on that background in both modes still gets readable text.
 */
function readableText(
  background: string,
  page: { color?: string },
  tokens: SiteTokenSet | undefined
): string | undefined {
  const candidates = [
    page.color,
    sharedStylePageTile(tokens, "light").color,
    sharedStylePageTile(tokens, "dark").color,
    sharedStylePageTile(ENGINE_TOKENS, "light").color,
    sharedStylePageTile(ENGINE_TOKENS, "dark").color,
  ];
  return candidates.find(
    colour => colour !== undefined && readability(colour, background) === true
  );
}

/**
 * A row's tile in the mode the canvas shows. In dark mode a style whose text
 * (its own, or the page's where it sets none) would be under 4.5:1 on its
 * background (its own, or the dark page's) is drawn on the light page
 * instead and marked, since on the site it is hard to read in dark mode. A
 * style with a background and no text colour gets text that reads on that
 * background, so it never draws as a blank square.
 */
export function sharedStyleTile(
  tokens: SiteTokenSet | undefined,
  mode: TokenMode,
  preview: Readonly<Record<string, string>>
): SharedStyleTile {
  const shown = sharedStylePageTile(tokens, mode);
  const darkUnreadable =
    mode === "dark" &&
    unreadablePair(
      preview.color ?? shown.color,
      preview.backgroundColor ?? shown.backgroundColor
    );
  const page = darkUnreadable ? sharedStylePageTile(tokens, "light") : shown;
  const background = preview.backgroundColor;
  const text =
    background !== undefined && preview.color === undefined
      ? readableText(background, page, tokens)
      : undefined;
  const specimen = text === undefined ? preview : { ...preview, color: text };
  const outlined = notShownToRead(preview, specimen, page);
  return {
    page,
    specimen: outlined
      ? outlinedSpecimen(
          specimen,
          page,
          preview.backgroundColor ?? page.backgroundColor
        )
      : specimen,
    darkUnreadable,
    outlined,
  };
}

/**
 * Whether a style that sets a colour is not shown to read on its tile: its
 * text (or the page's) against its background (or the page's) is under the
 * bar, or a pair this cannot judge. A style setting no colour draws as the
 * page does.
 */
function notShownToRead(
  preview: Readonly<Record<string, string>>,
  specimen: Readonly<Record<string, string>>,
  page: { backgroundColor?: string; color?: string }
): boolean {
  if (preview.color === undefined && preview.backgroundColor === undefined) {
    return false;
  }
  const fg = specimen.color ?? page.color;
  const bg = preview.backgroundColor ?? page.backgroundColor;
  if (fg === undefined || bg === undefined) return true;
  return readability(fg, bg) !== true;
}

/**
 * The "Aa" with an outline it shows by on its own background. Where that
 * background can be measured, one stroke painted under the fill, in the
 * colour that measures best against it of the page's background and text and
 * the engine's light and dark text. Where it cannot, a light and a dark halo
 * together, which show on any colour.
 */
function outlinedSpecimen(
  specimen: Readonly<Record<string, string>>,
  page: { backgroundColor?: string; color?: string },
  background: string | undefined
): Readonly<Record<string, string>> {
  const light = sharedStylePageTile(ENGINE_TOKENS, "dark").color;
  const dark = sharedStylePageTile(ENGINE_TOKENS, "light").color;
  const outline =
    background === undefined
      ? undefined
      : bestAgainst(background, [
          page.backgroundColor,
          page.color,
          dark,
          light,
        ]);
  if (outline !== undefined) {
    return {
      ...specimen,
      WebkitTextStroke: `2px ${outline}`,
      paintOrder: "stroke fill",
    };
  }
  return {
    ...specimen,
    textShadow: `0 0 1px ${dark ?? "currentcolor"}, 0 0 3px ${light ?? "currentcolor"}`,
    // No stroke over the halos, whatever a class supplies: one would hide the
    // inner dark halo, and could be the very colour of a background this
    // cannot measure.
    WebkitTextStroke: "0",
  };
}

/** The candidate that measures best against `background`, if any measures. */
function bestAgainst(
  background: string,
  candidates: readonly (string | undefined)[]
): string | undefined {
  let best: { colour: string; ratio: number } | undefined;
  for (const colour of candidates) {
    if (colour === undefined) continue;
    const ratio = ratioOf(colour, background);
    if (ratio !== undefined && (best === undefined || ratio > best.ratio)) {
      best = { colour, ratio };
    }
  }
  return best?.colour;
}

/**
 * Whether a pair is not shown to read: under the bar, or one this cannot
 * judge, which is drawn on the light page rather than risked blank. A pair
 * missing a colour (no site variables) has nothing to judge.
 */
function unreadablePair(
  fg: string | undefined,
  bg: string | undefined
): boolean {
  if (fg === undefined || bg === undefined) return false;
  return readability(fg, bg) !== true;
}

/** What a marked tile says, in its tooltip and the row's accessible name. */
export const SHARED_STYLE_DARK_UNREADABLE = "Hard to read in dark mode";

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
export function listedWords(parts: readonly string[]): string {
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
      parts.push(
        `on ${reach.complete ? "" : "at least "}${listedWords(kinds)}`
      );
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

/** A row's count in words, and whether it is a zero not counted yet. */
export interface SharedStyleReachChip {
  readonly words: string;
  /** No use found so far on a site not counted in full: drawn muted. */
  readonly uncounted: boolean;
}

/**
 * A row's count: its documents, with "+" when that is a floor, and what they
 * are. A bare number was read as uses, 17 blocks on 2 pages reading "2", so
 * the chip names the kind it counts: "4 pages", or "5 places" across several
 * kinds, which the row's name says one by one. A zero that is a floor says
 * "Not counted yet" rather than "0+ pages", a number that says nothing.
 */
export function sharedStyleReachChip(
  reach: SharedStyleReach
): SharedStyleReachChip {
  if (reach.documents === 0 && !reach.complete) {
    return { words: "Not counted yet", uncounted: true };
  }
  const kinds = (Object.keys(KIND_WORDS) as SharedStyleKind[]).filter(
    kind => reach.byKind[kind] > 0
  );
  const [only] = kinds;
  // Nothing used reads in pages, the kind a style is most often on.
  const words: readonly [string, string] =
    kinds.length > 1 ? ["place", "places"] : KIND_WORDS[only ?? "pages"];
  const plus = reach.complete ? "" : "+";
  const [one, many] = words;
  const noun = reach.documents === 1 && plus === "" ? one : many;
  return { words: `${reach.documents}${plus} ${noun}`, uncounted: false };
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
    blocks !== undefined &&
    blocks.complete &&
    blocks.count === 0 &&
    reach.complete &&
    reach.documents === 0
  );
}

/**
 * Where a style stands for the Used and Unused filters: "used" once any use
 * has been counted, on a block of the open page or a document in the index,
 * complete or not; "unused" only when it certainly is ({@link isUnused}, the
 * one rule removal also reads). Undefined otherwise: not read yet, or a zero
 * while some count is incomplete, which is "none counted yet", not unused.
 */
export function sharedStyleUse(
  blocks: BlocksOnThisPage | undefined,
  reach: SharedStyleReach | undefined
): "used" | "unused" | undefined {
  if (reach === undefined) return undefined;
  if ((blocks?.count ?? 0) > 0 || reach.documents > 0) return "used";
  return isUnused(blocks, reach) ? "unused" : undefined;
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
  "Some pages haven't been counted yet, so no shared style can be removed.";

/**
 * Why Lock, Remove and Remove unused wait: a rename writes the whole list of
 * styles, and so does each of them, so whichever landed second would put the
 * other's list back.
 */
export const SHARED_STYLE_RENAME_PENDING =
  "Wait until the name change is saved.";

/**
 * The one note while the tab's counts are floors and Unused holds rows back:
 * it covers the minimums, the withheld rows and Remove unused waiting.
 */
export const SHARED_STYLE_COUNTING_NOTE =
  "Some pages haven't been counted yet, so the numbers are minimums and no style can be called unused or removed.";

/**
 * The note while counts are floors for good: content the index cannot reach
 * keeps them so, so it promises no wait.
 */
export const SHARED_STYLE_UNCOUNTABLE_NOTE =
  "Some pages can't be counted, so these numbers are minimums.";

/** Why Remove unused waits when counts are floors for good. */
export const SHARED_STYLE_UNCOUNTABLE_REMOVAL =
  "Some pages can't be counted, so no shared style can be removed.";

/**
 * What Unused says when every page is counted but some style's count was cut
 * short, so it holds that style back, beside any rows it does list.
 */
export const SHARED_STYLE_UNUSED_UNCERTAIN =
  "Some uses could not all be counted, so some styles can't be called unused yet.";

/** The note under counts that are floors. */
export const SHARED_STYLE_NOT_WHOLE_NOTE =
  "Some pages haven't been counted yet, so these numbers are minimums.";
