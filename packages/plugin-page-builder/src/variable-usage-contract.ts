/**
 * What the Design panel's variable routes answer, named where both ends can
 * read it: the usage read and how it counts groups of variables together, the
 * where-used list, removing variables and cleaning up unused ones, with their
 * paths and parameters. Free of runtime imports, as `library-contract` is,
 * which re-exports it for every caller.
 *
 * @module variable-usage-contract
 */
import type { SharedStyleUsageKind } from "./shared-style-usage-contract";

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
 * The query parameter naming a group of variables whose documents a usage
 * read counts together, each document once: the positions of its variables
 * among the read's `id` parameters, from 0, separated by commas (`0,1`).
 * Repeated for several groups, answered in the order asked.
 *
 * @experimental Settles with the Variables panel's usage.
 */
export const VARIABLE_TOGETHER_PARAM = "together";

/** The most groups one usage read counts together. */
export const VARIABLE_USAGE_GROUPS_MAX = 50;

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
  /**
   * Each group asked about with {@link VARIABLE_TOGETHER_PARAM}, in the order
   * asked; absent where none was, and from an older server.
   */
  readonly together?: readonly VariablesTogetherUsage[];
}

/**
 * How many documents a group of variables is used in together: each
 * document once, however many of the group's variables it names, counted
 * as {@link VariableUsage} counts them, gated and hidden content included.
 * Numbers alone: the variables' own answers name their shared styles and
 * block types, which a reader joins itself.
 *
 * @experimental Settles with the Variables panel's usage.
 */
export interface VariablesTogetherUsage {
  /** How many documents use any of the group's variables. */
  readonly documents: number;
  /** The same documents, by kind. */
  readonly byKind: Readonly<Record<SharedStyleUsageKind, number>>;
  /** False makes `documents` and `byKind` floors: "at least". */
  readonly complete: boolean;
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

/**
 * The usage route's path for some variables, each named by its own `id`, and for groups of them to count together, each a `together` naming
 * its variables' positions; a group's variable not among `ids` is asked too.
 */
export function variableUsagePath(
  ids: readonly string[],
  together: readonly (readonly string[])[] = []
): string {
  // The ids as handed, which the route reads once each, then any member of
  // a group they leave out.
  const asked = [
    ...ids,
    ...new Set(together.flat().filter(id => !ids.includes(id))),
  ];
  const params = new URLSearchParams();
  for (const id of asked) params.append(VARIABLE_ID_PARAM, id);
  for (const group of together) {
    params.append(
      VARIABLE_TOGETHER_PARAM,
      group.map(id => String(asked.indexOf(id))).join(",")
    );
  }
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
