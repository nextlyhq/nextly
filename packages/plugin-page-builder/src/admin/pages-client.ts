/**
 * The Pages panel's four writes, one function each: create, duplicate, rename
 * and delete a page, through the plugin's routes.
 *
 * Each sends through `writePluginRoute`, so it carries the admin's session and
 * CSRF token and rejects with the admin's parsed error when core refuses it,
 * and each answers the page as the search lists it (or, for a delete, which
 * page it was), taken from the canonical mutation envelope.
 *
 * @module @nextlyhq/plugin-page-builder/admin/pages-client
 */
import { writePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import type { PageItem, PageReference } from "../pages-search-contract";
import {
  pageDuplicatePath,
  pagePath,
  PAGES_ROUTE_PATH,
  type CreatePageRequest,
  type PageMutationResponse,
  type RenamePageRequest,
} from "../pages-write-contract";

/** One write to a pages route, answered by the item its envelope carries. */
async function writePage<TItem extends PageItem | PageReference>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: CreatePageRequest | RenamePageRequest
): Promise<TItem> {
  const answer = await writePluginRoute<PageMutationResponse<TItem>>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path,
    method,
    ...(body === undefined ? {} : { body }),
  });
  // The routes always answer an item; an answer without one is a response
  // this client cannot use, and saying so beats handing back `undefined` as a
  // page.
  if (answer?.item === undefined) {
    throw new Error("The page route answered without the page it wrote.");
  }
  return answer.item;
}

/** Create a draft page titled `title` in `collection`. */
export function createPage(request: CreatePageRequest): Promise<PageItem> {
  return writePage<PageItem>("POST", PAGES_ROUTE_PATH, request);
}

/** Duplicate `page` as a draft titled "Copy of" its title. */
export function duplicatePage(page: PageReference): Promise<PageItem> {
  return writePage<PageItem>("POST", pageDuplicatePath(page));
}

/**
 * Give `page` a new title, and change nothing else. The page's `rev`, as the
 * list read it, goes with it, so a save of the page since refuses the rename.
 */
export function renamePage(
  page: PageReference & Pick<PageItem, "rev">,
  title: string
): Promise<PageItem> {
  return writePage<PageItem>("PATCH", pagePath(page), {
    title,
    ...(page.rev === undefined ? {} : { rev: page.rev }),
  });
}

/** Delete `page`, if core lets this author. */
export function deletePage(page: PageReference): Promise<PageReference> {
  return writePage<PageReference>("DELETE", pagePath(page));
}
