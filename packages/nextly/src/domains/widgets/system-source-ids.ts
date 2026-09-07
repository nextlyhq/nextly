/**
 * The identifiers of the `system:` sources core ships, declared ONCE.
 *
 * 🔴 A card's `query.source` and the registration that answers it are two halves
 * of one name, and nothing checks that they agree: a definition naming an
 * unregistered source is a legal definition, refused only at query time and only
 * for the reader unlucky enough to hold the card. Renaming a source with the
 * literal repeated in `core-widgets.ts` therefore leaves both cards querying an
 * id nothing serves while the source and every one of its own tests still pass.
 *
 * Its own module rather than an export of each source, because `core-widgets.ts`
 * would otherwise import the registration modules for their constants alone --
 * pulling a domain's service wiring into the definition list, and making the
 * widget domain depend on every domain that publishes a source.
 *
 * @module domains/widgets/system-source-ids
 */

/** What ships next: the releases the caller may see. */
export const RELEASES_SOURCE_ID = "system:releases";

/** The documents carrying edits that are not live. */
export const VERSIONS_SOURCE_ID = "system:versions";
