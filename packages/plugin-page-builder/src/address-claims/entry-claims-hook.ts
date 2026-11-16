/**
 * The addresses of collections' entries, held in the same transaction as the
 * save that takes or gives them up.
 *
 * Registered on core's in-transaction phase for every collection given a
 * template address in code, for every other collection that may have a
 * template (whose address is set at runtime, stored on the template, and may
 * be set after start), and for the templates collection:
 *
 * - An entry's save holds `<address>/<slug>` in each language while the entry
 *   is published and drawn on the site (its collection's template or its own
 *   design is published, as `servedAt` decides), and is refused, naming the
 *   other document, where that address is held. Unpublishing, deleting or
 *   renaming it gives up the old address, handing it to whatever waited.
 * - A template's first publish claims every published entry's address, pages
 *   first: an entry whose address is held is left waiting for it, not
 *   refused, since nobody is saving the entry. Unpublishing or deleting the
 *   template gives up the address of every entry without a published own
 *   design, and pointing a published template at another collection does
 *   both. Changing a template's stored address moves every entry it serves:
 *   its old addresses are given up, handing them to whatever waited, and its
 *   new ones claimed, each waiting where it is held.
 * - An own design's publish claims its entry's address, waiting where it is
 *   held, and its unpublish or removal gives the address up, each only where
 *   the collection's template does not serve the entry anyway.
 * - Where the design drawing an entry (its published own design, else its
 *   collection's published template) splits a list into pages, the entry
 *   also holds that list's later pages (`<address>/<slug>/page/*`) as one
 *   space, as a page does: its save is refused where a document is published
 *   among them, and a template's or own design's write that starts the list
 *   paging leaves the entry waiting for them, as it does an entry left
 *   waiting for its address, which is given both together. Until the
 *   start-up pass has claimed every page, the pages published among them are
 *   claimed first, as those at the entry's address are. Paging or unpaging a
 *   published template's list settles every entry it draws, and an own
 *   design's publish, republish, unpublish or removal settles its entry.
 * - A collection created at runtime is addressed only by its template, so
 *   once the template is deleted its entries hold nothing, own designs or
 *   not: there is no address left to serve them at.
 * - A collection that may no longer have a template (its `slug` field
 *   removed, or made localized) is served nowhere, whatever address its
 *   template still stores: the start-up pass gives its entries' addresses
 *   up, and neither an entry's save under an unpublished template, an own
 *   design's write nor its template's unpublish claims one back (see
 *   `servable`).
 *
 * A collection's address declared in code wins over one its template
 * stores, so a collection promoted into code moves to the declared address,
 * and until it starts with the declaration its entries stay at the stored
 * one.
 *
 * An entry's save, its template's publish, a change of its address and its
 * own design's publish or unpublish take the collection's lock before any
 * reads the others, so none commits past another unseen: an entry published
 * while its template or own design is being published, or its address
 * moved, is claimed by whichever commits second.
 *
 * ## Where each part lives
 *
 * - `entry-claims-register.ts`: the in-transaction hooks, and an entry's own
 *   save.
 * - `entry-claims-settle.ts`: a template's or an own design's write settling
 *   the entries it serves.
 * - `entry-claims-at-start.ts`: the start-up pass.
 * - `entry-claims-serving.ts`: where an entry is served and what it wants.
 * - `entry-claims-published-pages.ts`: the pages published at an entry's
 *   addresses, claimed first.
 * - `entry-claims-deps.ts`: what the claims are handed.
 *
 * @module address-claims/entry-claims-hook
 */
export type {
  EntryClaimsDeps,
  OwnDesign,
  ServingTemplate,
} from "./entry-claims-deps";
export {
  collectionClaimInputs,
  releaseUndeclared,
  settleEntryClaimsAtStart,
  type CollectionClaimInputs,
  type EntryClaimsPassDeps,
} from "./entry-claims-at-start";
export { registerEntryAddressClaims } from "./entry-claims-register";
