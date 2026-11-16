/**
 * The read behind the editor's page search: the site's pages, searched by
 * title, as `{ id, collection, collectionLabel, field, title, status? }`.
 *
 * ## Which collections it reads
 *
 * Only a collection that declares a Page Builder field the editor can open
 * (`blocksFieldsOf`, the plugin's one reading of which blocks fields a
 * collection holds at an addressable path), read from the LIVE registry so a
 * collection the Schema Builder adds later is found too. Never any other
 * collection, and never the plugin's own composition stores — patterns and
 * components hold a blocks field too, but they are what pages are built FROM,
 * not pages. A site with no such collection answers an empty list.
 *
 * ## Who decides what the caller may read
 *
 * Core, and nothing here. Every read runs through the Direct API AS THE CALLER
 * (`findAsCaller`): `overrideAccess: false` with the identity the dispatcher
 * resolved, so each collection's read rule, row filters and field-level read
 * rules apply exactly as they do to the caller's own reads. A collection core
 * refuses this caller contributes nothing, rather than refusing the whole
 * search: the search spans collections, and the caller asked about none of
 * them by name. The registry listing that picks the collections is
 * configuration, not content, and nothing of a collection travels unless the
 * caller's own read of it returned a row.
 *
 * ## What travels
 *
 * The id, the title (core's title rule, as the entries route names an entry),
 * the collection and its label, the Page Builder field's name so the client can
 * build the editor's address, and the status where the collection has the
 * Draft/Published lifecycle. Only those columns are selected, the search and
 * the limit are applied in the database, and each collection is read once.
 *
 * ## Paging, and where each page stands
 *
 * A cursor carries each collection's position in its own read, so the next
 * page resumes every read where the merge stopped taking from it (see
 * `PagesSearchResponse`). By title the merge takes the lowest head each time;
 * by collection (`order=collection`, the Pages panel's grouped list) it takes
 * each collection's pages in turn, the plugin's own Pages first. Each returned
 * page of a Draft/Published collection
 * also says where it stands in publishing (`PageState`), from core's own
 * workflow filters read as the caller: two reads per collection, over the ids
 * on the page.
 *
 * The same reading of which collections hold pages serves the Pages panel's
 * writes (`pages-write-route`), so a collection is a page collection for both
 * or for neither.
 *
 * ## Where each part lives
 *
 * - `pages-search-handler.ts`: the search route, and the live-registry reads
 *   both routes make.
 * - `page-address-route.ts`: the page address route.
 * - `pages-search-read.ts`: the search itself, its merge and where each page
 *   stands.
 * - `pages-search-items.ts`: what one found page carries.
 * - `pages-search-collections.ts`: which collections hold pages, and what is
 *   known about each.
 * - `pages-search-request.ts`: the query and the paging cursor.
 *
 * @module pages-search-route
 */
export {
  type PagesCursor,
  type PagesSearchRequest,
  parsePagesSearchQuery,
} from "./pages-search-request";
export {
  type PageCollection,
  schemaIsLive,
  slugOf,
} from "./pages-search-collections";
export {
  type PagesFindArgs,
  type PagesSearchReads,
  readPagesSearch,
} from "./pages-search-read";
export { pageItemOf, pageStateOf } from "./pages-search-items";
export {
  findPageCollection,
  type PageCollectionsContext,
  pagesSearchRoute,
  registryRecords,
} from "./pages-search-handler";
export {
  type PageAddressReads,
  type PageAddressRequest,
  pageAddressRoute,
  parsePageAddressQuery,
  readPageAddress,
} from "./page-address-route";
