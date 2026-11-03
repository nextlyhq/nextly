/**
 * The Page Builder's document view, as the plugin declares it and the field's
 * card links to it: one module, so the declared address and the linked one
 * cannot drift apart.
 *
 * @module builder-view
 */

/** The view's address segment, after the document's own address. */
export const BUILDER_VIEW_PATH = "builder";

/** The component the admin draws at that address. */
export const BUILDER_VIEW_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#PageBuilderView";

/**
 * The "Remove Layout…" action drawn in a Layout's document bar, through the
 * entry-form toolbar slot. Declared here,
 * a module with no React in it, so the plugin's node-safe entry can name it
 * without bringing the admin component along.
 */
export const REMOVE_LAYOUT_ACTION_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#RemoveLayoutToolbarSlot";
