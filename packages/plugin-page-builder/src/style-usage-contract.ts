/**
 * What the Design panel's shared style and variable routes answer, and
 * where: locking a shared style, how widely each shared style and variable
 * is used and where, and removing them, one at a time or as a clean-up.
 *
 * FREE OF RUNTIME IMPORTS, for the reason `library-contract.ts` gives, which
 * re-exports all of it, so nothing that names these from there changes.
 *
 * @module style-usage-contract
 */

/**
 * Where the Design panel locks and unlocks a shared style: the one write that
 * may move a lock, gated on the permission to lock shared styles alone.
 *
 * @experimental Settles when the Shared styles tab ships.
 */
export const SHARED_STYLE_LOCK_ROUTE_PATH = "/shared-styles/lock";

/** What the lock route is sent: which shared style, and whether to lock it. */
export interface SharedStyleLockRequest {
  readonly classId: string;
  readonly locked: boolean;
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

/**
 * The kinds of document a shared style is counted on. Every collection with a
 * page builder field other than the composition stores holds pages.
 */
export type SharedStyleUsageKind =
  | "pages"
  | "components"
  | "patterns"
  | "layouts";

/** How widely one shared style is used, from the class usage index. */
export interface SharedStyleUsage {
  /** How many documents apply it, gated and hidden content included. */
  readonly documents: number;
  /** The same documents, by kind. */
  readonly byKind: Readonly<Record<SharedStyleUsageKind, number>>;
  /** False makes both numbers floors: "at least". */
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
 * The usage route's path for some shared styles, each named by its own `id`
 * parameter, so the browser asks in the shape the route reads.
 */
export function sharedStyleUsagePath(ids: readonly string[]): string {
  const params = new URLSearchParams();
  for (const id of ids) params.append(SHARED_STYLE_ID_PARAM, id);
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

/** One document a shared style is used on, as the where-used list names it. */
export interface SharedStyleUseItem {
  readonly id: string;
  readonly title: string;
  readonly collection: string;
  readonly kind: SharedStyleUsageKind;
}

/**
 * Where the Design panel removes unused shared styles: the one write that may
 * remove one, made only after the server finds the usage index whole and
 * nothing using any of them.
 *
 * @experimental Settles when the Shared styles tab ships.
 */
export const SHARED_STYLE_REMOVE_ROUTE_PATH = "/shared-styles/remove";

/**
 * Where the Design panel asks for the site's pages to be counted now, rather
 * than waiting for a scheduler to run the usage backfill: it runs that job
 * for a bounded time and answers how far the counting got.
 *
 * @experimental Settles when the Shared styles tab ships.
 */
export const SHARED_STYLE_COUNT_ROUTE_PATH = "/shared-styles/count";

/**
 * What the count route answers, as its mutation's `item`: whether it ran the
 * counting (false when something else was already running it), and the
 * index's health read after, in the usage read's terms.
 */
export interface SharedStylesCountResponse {
  readonly ran: boolean;
  readonly whole: boolean;
  readonly counting: boolean;
}

/** What the remove route is sent: the shared styles to remove, by id. */
export interface SharedStyleRemoveRequest {
  readonly ids: readonly string[];
}

/**
 * Where the Design panel's Variables reads how widely its variables are used,
 * a page of rows at a time, each variable named by its identity (`$token`:
 * the token's `id`, else its name) with its own `id` parameter.
 *
 * @experimental Settles when the Variables panel shows usage.
 */
export const VARIABLE_USAGE_ROUTE_PATH = "/variables/usage";

/** The query parameter naming one variable, by identity; repeated for several. */
export const VARIABLE_ID_PARAM = "id";

/** The query parameter naming which page of a where-used list, from 1. */
export const VARIABLE_PAGE_PARAM = "page";

/** The most variables one usage read or one removal answers for. */
export const VARIABLE_USAGE_IDS_MAX = 50;

/**
 * How widely one variable is used: the documents whose blocks or page
 * settings name it, from the variable usage index; the shared styles whose
 * own styles name it, from the site style; and the block types whose own
 * default styles name it, from the block registry. A shared style's reference
 * is a use whether or not any block applies the style, and a block type's
 * whether or not any page places the block. The places it is used are
 * `documents` plus `sharedStyles.length` plus `blockDefaults.length`.
 */
export interface VariableUsage {
  /** How many documents use it, gated and hidden content included. */
  readonly documents: number;
  /** The same documents, by kind. */
  readonly byKind: Readonly<Record<SharedStyleUsageKind, number>>;
  /** The ids of the shared styles whose styles name it, in id order. */
  readonly sharedStyles: readonly string[];
  /**
   * The registered block types (`core/button`) whose own default styles
   * (`baseStyles`) name it, in type order.
   */
  readonly blockDefaults: readonly string[];
  /**
   * The site's variables whose own values name it through `var()`, by
   * identity, in the site's order: a shadow variable keeps its colour that
   * way. Absent from an older server.
   */
  readonly variables?: readonly string[];
  /**
   * The Site text rows using it (`link`, `h2`), by reference or through
   * `var()`. Absent from an older server.
   */
  readonly siteText?: readonly string[];
  /** False makes `documents` and `byKind` floors: "at least". */
  readonly complete: boolean;
}

/**
 * What the variables usage read answers: the index's health once for the
 * screen, whether this caller may ask for a count now, and each variable.
 *
 * NOT A SECURITY BOUNDARY: every write is judged on its own.
 */
export interface VariablesUsageResponse {
  /** Whether the usage index covers the whole site, so counts can be exact. */
  readonly whole: boolean;
  /** Whether counts that are not whole may still become whole. */
  readonly counting: boolean;
  /**
   * Whether this caller may ask for the pages to be counted now, through
   * {@link SHARED_STYLE_COUNT_ROUTE_PATH}: one count fills every usage index.
   */
  readonly mayCount: boolean;
  /** Each variable asked about, by identity. */
  readonly variables: Readonly<Record<string, VariableUsage>>;
}

/**
 * Where the Variables panel lists the places a variable is used: first the
 * shared styles naming it, then the block types whose default styles name
 * it, then the documents, read as the caller (documents the caller may not
 * read are counted in `meta.hiddenCount`, not named). The canonical list
 * envelope, twenty to a page with `?page=` from 1, up to the page the longest
 * such list ends on: every document one usage listing can name, with every
 * shared style and block type the site has.
 *
 * @experimental Settles when the Variables panel shows usage.
 */
export const VARIABLE_WHERE_USED_ROUTE_PATH = "/variables/where-used";

/**
 * Which kind of place a variable is used in: a document's kind, a shared
 * style, or a block type's own default style.
 */
export type VariableUseKind =
  | SharedStyleUsageKind
  | "shared-style"
  | "block-default";

/**
 * One place a variable is used. A document is named by its collection and id,
 * as the shared-style where-used names one. A shared style is named by its
 * class id in `id`, with the site-style Single's slug as its `collection`, so
 * the panel can open it in Design > Shared styles. A block type's default
 * style is named by the type in `id` (`core/button`) and its label in
 * `title`, with an empty `collection`: it is the block's code, not a stored
 * document.
 */
export interface VariableUseItem {
  readonly id: string;
  readonly title: string;
  readonly collection: string;
  readonly kind: VariableUseKind;
  /**
   * For a shared style that is a block look, the block type it is bound to.
   * Two block types' own looks may share an id, so a look is named by the
   * pair: the panel opens the look `{ id, blockType }`. Absent for every
   * other place.
   *
   * @experimental Settles when the Variables panel shows usage.
   */
  readonly blockType?: string;
}

/**
 * Where the Variables panel removes variables the site added: the one write
 * that checks first, just before it writes, that nothing uses any of them. A
 * variable the site's code supplies cannot be removed, only reset.
 *
 * Refused in use with a validation error whose issues carry
 * {@link SHARED_STYLE_IN_USE_CODE}: one issue per variable the index, a
 * shared style or a block type's default style finds in use, its `path` that
 * variable's identity, or one issue with an empty `path` when the stored
 * documents themselves still use one. Refused with a conflict naming every
 * reason when the uses cannot be counted, even if another variable asked
 * about is in use: no issue carries the in-use code for a variable whose
 * uses are not known. A page saved while the removal writes, that uses one
 * of the variables, puts it back and refuses the removal as in use.
 *
 * @experimental Settles when the Variables panel shows usage.
 */
export const VARIABLE_REMOVE_ROUTE_PATH = "/variables/remove";

/** What the remove route is sent: the variables to remove, by identity. */
export interface VariableRemoveRequest {
  readonly ids: readonly string[];
}

/**
 * Where "Clean up unused…" removes many variables the site added at once.
 * Unlike the remove route, each variable is judged and removed on its own,
 * by the same checks and in its own write: one found in use is kept and
 * named with why, and the rest are removed whatever became of it. Declares
 * Design's update permission, as the remove route does.
 *
 * @experimental Settles with the Colours tab's clean-up.
 */
export const VARIABLE_CLEAN_UP_ROUTE_PATH = "/variables/clean-up";

/** What the clean-up route is sent: the variables to remove, by identity. */
export interface VariableCleanUpRequest {
  readonly ids: readonly string[];
}

/** One variable the clean-up kept, with why, in words an author reads. */
export interface VariableKept {
  readonly id: string;
  /** The name an author knows it by, or its id where it has none. */
  readonly name: string;
  /** Why it stays, naming where it is used where that is known. */
  readonly reason: string;
}

/**
 * One variable a removal took out of the stored tokens section: its entry
 * as stored then, and its places in the list and in the colour order, so
 * Undo puts back exactly what went.
 */
export interface VariableTaken {
  readonly id: string;
  readonly entry: unknown;
  readonly at: number;
  /** Its place in the colour order, or `null` where the order did not name it. */
  readonly orderAt: number | null;
}

/**
 * What the clean-up did: the variables it removed and the ones it kept, by
 * identity, each in the order asked. One already gone is in neither.
 */
export interface VariableCleanUpAnswer {
  readonly removed: readonly string[];
  readonly kept: readonly VariableKept[];
  /** What each removal took out, in the order the removals were made. */
  readonly taken: readonly VariableTaken[];
  /**
   * The stored tokens section as the last removal wrote it; absent when
   * nothing was removed.
   */
  readonly section?: unknown;
}

/** The usage route's path for some variables, each named by its own `id`. */
export function variableUsagePath(ids: readonly string[]): string {
  const params = new URLSearchParams();
  for (const id of ids) params.append(VARIABLE_ID_PARAM, id);
  return `${VARIABLE_USAGE_ROUTE_PATH}?${params.toString()}`;
}

/** The where-used route's path for one variable and one page, from 1. */
export function variableWhereUsedPath(id: string, page: number): string {
  const params = new URLSearchParams({
    [VARIABLE_ID_PARAM]: id,
    [VARIABLE_PAGE_PARAM]: String(page),
  });
  return `${VARIABLE_WHERE_USED_ROUTE_PATH}?${params.toString()}`;
}
