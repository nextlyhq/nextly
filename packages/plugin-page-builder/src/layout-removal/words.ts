/**
 * What an author is told about removing a Layout, in one place, so the route,
 * the guards and the dialog say the same thing.
 *
 * Imports nothing, so the admin's dialog can read the sentences without
 * bringing any server module into the browser.
 *
 * @module layout-removal/words
 */

/**
 * What a delete or unpublish of the site's default Layout is told, by the
 * default guard and by Remove Layout alike.
 */
export const DEFAULT_LAYOUT_REFUSAL =
  "This Layout is the site's default. Choose another default first.";

/** The dialog's sentence over the pages that stop a removal. */
export const PAGES_USE_IT =
  "These pages use this Layout. Choose another Layout for them first.";

/** What a plain delete or unpublish of a Layout is told: the way to do it. */
export const REMOVE_LAYOUT_REFUSAL =
  "Use Remove Layout to take a Layout down safely.";

/** A second removal of a Layout already being removed. */
export const ALREADY_BEING_REMOVED = "This Layout is already being removed.";

/** A promotion of a Layout that is being removed. */
export const BEING_REMOVED_NOT_DEFAULT =
  "This Layout is being removed, so it can't be the default.";

/** A delete that a promotion raced: the Layout was put back. */
export const KEPT_AS_DEFAULT =
  "This Layout just became the site default, so it was kept.";

/** A Layout that kept changing between its copy and its removal. */
export const CHANGED_WHILE_REMOVING =
  "This Layout changed while it was being removed. Try again.";

/** An unpublish of a Layout that is not published. */
export const NOT_PUBLISHED =
  "This Layout isn't published, so there is nothing to unpublish.";

/**
 * A Layout edit while its removal is running: the removal holds the Layout as
 * its copy took it, and finishes or gives up within moments.
 */
export const LAYOUT_EDIT_DURING_REMOVAL =
  "This Layout is being removed. Try again in a moment.";

/** Where a Layout a page tried to choose stands with Remove Layout. */
export type FencedLayoutState = "removing" | "unpublished" | "deleted";

/** What a page write naming a Layout behind Remove Layout's fence is told. */
export function pageLayoutRefusal(state: FencedLayoutState): string {
  switch (state) {
    case "removing":
      return "This Layout is being removed, so pages can't choose it. Choose another Layout.";
    case "unpublished":
      return "This Layout was unpublished with Remove Layout, so pages can't choose it until it is published again. Choose another Layout.";
    case "deleted":
      return "This Layout was deleted, so pages can't choose it. Choose another Layout.";
  }
}

/**
 * What a page save that landed while its Layout was being removed is told,
 * once its Layout choice was cleared.
 */
export const PAGE_LAYOUT_CLEARED =
  "The Layout this page named was removed while the page was being saved, so the page now uses the site's default Layout.";

/** Who stops a removal: the pages using the Layout, as the caller may see them. */
export interface PagesInTheWay {
  /** The pages the caller may read, by title. */
  readonly titles: readonly string[];
  /** How many more the caller may not read. */
  readonly unreadable: number;
  /** False when the scan ran out of budget before it reached every page. */
  readonly complete: boolean;
}

/** "1 page", "3 pages". */
function pages(count: number): string {
  return `${String(count)} ${count === 1 ? "page" : "pages"}`;
}

/** `"Home", "About" and 1 you can't view`. */
function listed(titles: readonly string[], unreadable: number): string {
  const parts = titles.map(title => `"${title}"`);
  if (unreadable > 0) {
    parts.push(`${String(unreadable)} you can't view`);
  }
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

/**
 * The refusal when pages use the Layout, naming those the caller may read and
 * counting the rest. An unfinished scan says "at least", since pages past the
 * budget were never looked at.
 */
export function pagesUseItRefusal(found: PagesInTheWay): string {
  const total = found.titles.length + found.unreadable;
  if (!found.complete) {
    const lead =
      total === 0
        ? "This site has more pages than one removal can check"
        : `At least ${pages(total)} use this Layout`;
    return `${lead}, so it can't be removed yet. Choose another Layout for the pages that use it first.`;
  }
  const verb = total === 1 ? "uses" : "use";
  return `${pages(total)} ${verb} this Layout: ${listed(found.titles, found.unreadable)}. Choose another Layout for ${total === 1 ? "it" : "them"} first.`;
}
