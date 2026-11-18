/**
 * What the shared-style usage routes answer, named where both ends can read
 * it: the usage read and the where-used list, their paths and parameters,
 * the kinds of document a style is counted on, what the usage read names of
 * the document the editor has open, and the parts of that document's saved
 * blocks it answers. Free of imports, as `library-contract` is, which
 * re-exports it for every caller.
 *
 * @module shared-style-usage-contract
 */

/**
 * The kinds of document a shared style is counted on. Every collection with a
 * page builder field other than the composition stores holds pages.
 */
export type SharedStyleUsageKind =
  | "pages"
  | "components"
  | "patterns"
  | "layouts";

/** The stored forms of a document: its main row, and a pending working draft. */
type SharedStyleUsageVariant = "published" | "draft";

/**
 * What the editor has open, as the usage route is told of it: a saved
 * document (an entry of a collection by its id, or a Single, which has one),
 * the blocks field the editor is bound to, the language and the stored form.
 */
export interface SharedStyleUsageHere {
  readonly document:
    | { readonly collection: string; readonly id: string }
    | { readonly single: string };
  readonly field: string;
  /** The language by code; absent for the site's default language. */
  readonly locale?: string;
  /**
   * `draft` while the editor holds a published document's pending working
   * draft, which is stored apart; `published` for the main row.
   */
  readonly variant: SharedStyleUsageVariant;
  /**
   * Set while the open copy is live as saved and stays so until this edit is
   * published: a published document with no pending draft, which a save
   * turns into a draft beside it. Its saved blocks are still on the site,
   * so they count beside the live edit rather than being replaced by it.
   */
  readonly keepsSaved?: true;
}

/**
 * The open document's saved blocks wearing a style, in the parts the editor
 * replaces with its live field: with the open field's rows set aside,
 * `alongside` is the largest copy the open field is part of (the language
 * being edited, or each language for a field they all share) and `elsewhere`
 * the largest of the document's other copies (and of the open copy as saved,
 * where it stays live: `keepsSaved`), so the document counts
 * `max(alongside + live, elsewhere)`. `saved` is what the document adds to
 * `SharedStyleUsage.blocks`, 0 when it holds none. `null` where a count is
 * unknown (a row stored before counts were kept, or a field whose place
 * among the copies the rows cannot say).
 */
export interface SharedStyleUsageHereParts {
  readonly saved: number | null;
  readonly alongside: number | null;
  readonly elsewhere: number | null;
  readonly kind: SharedStyleUsageKind;
}

/**
 * Where the Design panel reads how widely its visible shared styles are used,
 * a page of rows at a time.
 *
 * @experimental Settles when the Shared styles tab ships.
 */
export const SHARED_STYLE_USAGE_ROUTE_PATH = "/shared-styles/usage";

/** The query parameter naming one shared style, by id; repeated for several. */
export const SHARED_STYLE_ID_PARAM = "id";

/** The most shared styles one usage read answers for: one page of rows. */
export const SHARED_STYLE_USAGE_IDS_MAX = 50;

/** How widely one shared style is used, from the class usage index. */
export interface SharedStyleUsage {
  /** How many documents apply it, gated and hidden content included. */
  readonly documents: number;
  /** The same documents, by kind. */
  readonly byKind: Readonly<Record<SharedStyleUsageKind, number>>;
  /**
   * How many blocks wear it across those documents, a document's draft and
   * published copies counted once. Absent where the index counts no blocks.
   */
  readonly blocks?: number;
  /**
   * The open document's saved blocks, in the parts the editor needs to count
   * it from its live field instead: see {@link SharedStyleUsageHereParts}.
   * Absent when no document was named, or the caller may not read it.
   */
  readonly here?: SharedStyleUsageHereParts;
  /** False makes every number a floor: "at least". */
  readonly complete: boolean;
}

/**
 * The code the remove route's issue carries when a stored document still uses
 * a style, so the editor can tell that refusal from one for a lock or a count
 * no longer whole. Carried only when every reason a removal is refused for is
 * a use: a refusal any of whose reasons is not (a lock, a style the site's
 * code defines, uses that could not all be counted) is a conflict naming
 * every reason, so the code never marks one that is not a use.
 *
 * @experimental Settles when the Shared styles tab ships.
 */
export const SHARED_STYLE_IN_USE_CODE = "IN_USE";

/**
 * What the usage read answers: the index's health once for the screen, what
 * this caller may do, and the usage of each style asked about.
 *
 * NOT A SECURITY BOUNDARY: every write is judged on its own.
 */
export interface SharedStylesUsageResponse {
  /** Whether the usage index covers the whole site, so counts can be exact. */
  readonly whole: boolean;
  /**
   * Whether counts that are not whole may still become whole: the site is
   * still being counted. False when they are whole, and when something the
   * index cannot reach keeps them floors for good, so there is nothing to
   * read again for.
   */
  readonly counting: boolean;
  /** Whether this caller may lock and unlock shared styles. */
  readonly mayLock: boolean;
  /**
   * Whether this caller may ask for the pages to be counted now, through
   * {@link SHARED_STYLE_COUNT_ROUTE_PATH}: whoever may change Design, the
   * people a whole count lets remove a style.
   */
  readonly mayCount: boolean;
  /** Each style asked about, by id. */
  readonly styles: Readonly<Record<string, SharedStyleUsage>>;
}

/**
 * Where the Design panel lists the documents a shared style is used on, read
 * as the caller: documents the caller may not read are counted, not named.
 * The answer is the canonical list envelope, paged twenty at a time with
 * `?page=` from 1: `meta.total` and the pages count the documents the caller
 * may read, and `meta.hiddenCount` the ones it may not.
 *
 * @experimental Settles when the Shared styles tab ships.
 */
export const SHARED_STYLE_WHERE_USED_ROUTE_PATH = "/shared-styles/where-used";

/** The most documents one where-used answer names. */
export const SHARED_STYLE_WHERE_USED_MAX = 20;

/** The query parameter naming which page of a where-used list, from 1. */
export const SHARED_STYLE_PAGE_PARAM = "page";

/**
 * The last page a where-used read may ask for: the most documents one usage
 * listing can name, twenty to a page.
 */
export const SHARED_STYLE_WHERE_USED_PAGES_MAX = 250;

/**
 * The query parameters naming what the editor has open, whose saved share of
 * each style's usage the route reports apart (`SharedStyleUsage.here`): the
 * document as `<collection>/<id>` or `single:<slug>`, the blocks field, the
 * language by code (absent for the site's default), the stored form the
 * editor edits, and whether that copy stays live as saved (`keepsSaved`).
 */
export const SHARED_STYLE_HERE_PARAM = "here";
export const SHARED_STYLE_HERE_FIELD_PARAM = "hereField";
export const SHARED_STYLE_HERE_LOCALE_PARAM = "hereLocale";
export const SHARED_STYLE_HERE_VARIANT_PARAM = "hereVariant";
export const SHARED_STYLE_HERE_KEEPS_SAVED_PARAM = "hereKeepsSaved";

/**
 * The usage route's path for some shared styles, each named by its own `id`
 * parameter, so the browser asks in the shape the route reads; with what the
 * editor has open named, when it has a saved document open.
 */
export function sharedStyleUsagePath(
  ids: readonly string[],
  here?: SharedStyleUsageHere
): string {
  const params = new URLSearchParams();
  for (const id of ids) params.append(SHARED_STYLE_ID_PARAM, id);
  if (here !== undefined) {
    const { document } = here;
    params.set(
      SHARED_STYLE_HERE_PARAM,
      "single" in document
        ? `single:${document.single}`
        : `${document.collection}/${document.id}`
    );
    params.set(SHARED_STYLE_HERE_FIELD_PARAM, here.field);
    if (here.locale !== undefined) {
      params.set(SHARED_STYLE_HERE_LOCALE_PARAM, here.locale);
    }
    params.set(SHARED_STYLE_HERE_VARIANT_PARAM, here.variant);
    if (here.keepsSaved === true) {
      params.set(SHARED_STYLE_HERE_KEEPS_SAVED_PARAM, "1");
    }
  }
  return `${SHARED_STYLE_USAGE_ROUTE_PATH}?${params.toString()}`;
}

/** The where-used route's path for one shared style and one page, from 1. */
export function sharedStyleWhereUsedPath(id: string, page: number): string {
  const params = new URLSearchParams({
    [SHARED_STYLE_ID_PARAM]: id,
    [SHARED_STYLE_PAGE_PARAM]: String(page),
  });
  return `${SHARED_STYLE_WHERE_USED_ROUTE_PATH}?${params.toString()}`;
}
