/**
 * The contributions fixture's component paths, shared by the plugin
 * definition (loaded with the config, in Node) and `admin.tsx` (loaded in the
 * browser), so the definition never imports the client components.
 */

/** The module the fixture's components live in. */
const COMPONENTS = "@/plugins/contributions-fixture/components";

/** A labelled block, drawn on the dashboard and on Posts' pages. */
export const BLOCK = `${COMPONENTS}#FixtureBlock`;
/** The block drawn behind a permission. */
export const GATED_BLOCK = `${COMPONENTS}#FixtureGatedBlock`;
/** A list column the plugin draws from its row. */
export const CELL = `${COMPONENTS}#FixtureCell`;
/** A tab on a Post's edit page. */
export const TAB = `${COMPONENTS}#FixtureTab`;
/** A side panel section on a Post's edit page. */
export const SECTION = `${COMPONENTS}#FixtureSection`;
/** The dialog the row and bulk actions open. */
export const ACTION_DIALOG = `${COMPONENTS}#FixtureActionDialog`;
/** The replacement of the edit page's `editor`. */
export const REPLACEMENT = `${COMPONENTS}#FixtureReplacement`;
