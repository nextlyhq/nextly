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

/**
 * What a move is told while the site has no published default to move its
 * pages to: they would be left with no header or footer.
 */
export const NO_USABLE_DEFAULT =
  "The site has no published default Layout to move these pages to. Publish one or choose another default first.";

/** The dialog's sentence over the pages that stop a removal. */
export const PAGES_USE_IT =
  "These pages use this Layout. Choose another Layout for them first.";

/** What a plain delete or unpublish of a Layout is told: the way to do it. */
export const REMOVE_LAYOUT_REFUSAL =
  "Use Remove Layout… on the Layout's screen to take it down safely.";

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
 * The short reason the Layout picker shows beside a Layout behind the fence,
 * muted after its name; the whole sentence (`pageLayoutRefusal`) is the
 * option's tooltip and description.
 */
export function pickerRemovalNote(state: FencedLayoutState): string {
  switch (state) {
    case "removing":
      return "Being removed";
    case "unpublished":
      return "Unpublished. Publish it again to choose it.";
    case "deleted":
      return "Deleted";
  }
}

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
    // Unfinished: the site has more pages than one removal checks, or a page
    // that is still there could not be read.
    if (total === 0) {
      return "Not every page could be checked, so this Layout can't be removed yet. Choose another Layout for any page that uses it, or try again in a moment.";
    }
    return `At least ${pages(total)} use this Layout, so it can't be removed yet. Choose another Layout for the pages that use it first.`;
  }
  const verb = total === 1 ? "uses" : "use";
  return `${pages(total)} ${verb} this Layout: ${listed(found.titles, found.unreadable)}. Choose another Layout for ${total === 1 ? "it" : "them"} first.`;
}

/** "Home", "Home and About", "Home, About and 1 page you can't view". */
function namedPages(titles: readonly string[], unreadable: number): string {
  const parts = [...titles];
  if (unreadable > 0) {
    parts.push(`${pages(unreadable)} you can't view`);
  }
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

/**
 * What a delete is told when a page published while it ran still names the
 * Layout: the delete stands, and those pages show the site default until
 * they are published with another Layout.
 */
export function stillUsedAfterDelete(found: {
  readonly titles: readonly string[];
  readonly unreadable: number;
}): string {
  const one = found.titles.length + found.unreadable === 1;
  return one
    ? `${namedPages(found.titles, found.unreadable)} still uses this Layout. It shows the site default until it is published with another Layout.`
    : `${namedPages(found.titles, found.unreadable)} still use this Layout. They show the site default until they are published with another Layout.`;
}

/** Why a move left a page the person may not edit, or may not read. */
export const CANT_EDIT_PAGE = "You can't edit this page.";

/** Why a move left a page whose save failed for a reason it can't name. */
export const PAGE_NOT_SAVED = "This page couldn't be saved. Try again.";

/**
 * A move's tick that finds its move gone: stopped, swept after its dialog
 * closed, or taken up again elsewhere.
 */
export const MOVE_STOPPED =
  "Moving stopped, so the Layout was not removed. Pages already moved stay on the site default.";

/** Why a move left a page that kept being saved while it was moved. */
export const PAGE_KEPT_CHANGING =
  "This page kept changing while it was being moved. Try again when nobody is editing it.";

/**
 * Why a page moved off a Layout, as its history keeps it beside the Page
 * Builder's name: the Layout by the title it had, and what is happening to it.
 */
export function movedOffLayoutReason(
  title: string,
  action: "delete" | "unpublish"
): string {
  const named = title.trim() === "" ? "Its Layout" : `Layout "${title}"`;
  const going = action === "delete" ? "deleted" : "unpublished";
  return `${named} is being ${going}, so this page was moved to the site default.`;
}

/**
 * What a finished move says about published pages whose live copy still names
 * the Layout: changing a live copy needs the right to publish the page, so
 * where the person lacks it only the draft moved. They show the site default
 * until someone who may publish them chooses another Layout.
 */
export function liveCopiesLeftSentence(count: number): string {
  return count === 1
    ? "The published version of 1 page still names this Layout, because changing it needs permission to publish it. Visitors see the site default's header and footer there until someone who can publish it chooses another Layout."
    : `The published versions of ${String(count)} pages still name this Layout, because changing them needs permission to publish them. Visitors see the site default's header and footer there until someone who can publish them chooses another Layout.`;
}
