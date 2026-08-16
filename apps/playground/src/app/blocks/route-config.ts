/**
 * What the blocks route reads and where it serves from, for the route AND its
 * sitemap.
 *
 * Two surfaces answer questions about the same URLs — the page resolves them and
 * the sitemap advertises them — and a literal repeated between them is wrong in
 * a way nothing detects. Changing the mount in one place leaves a well-formed
 * sitemap naming paths that 404, and changing the collection leaves it omitting
 * every page that exists; neither errors, and neither surface can see the other
 * to disagree with it.
 *
 * Small enough to look like ceremony, which is why it is worth stating: the
 * failure is silent in both directions and the cost of preventing it is one
 * import.
 */

/** The collection holding the block documents this route renders. */
export const BLOCKS_COLLECTION = "block-pages";

/** Where the route is mounted: `app/blocks/[[...slug]]`. */
export const BLOCKS_MOUNT = "/blocks";
