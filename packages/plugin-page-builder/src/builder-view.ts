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

/**
 * The tools above the Components list: Import from file, and the dialog its
 * row action "Delete component…" opens. Declared here for the same reason.
 */
export const COMPONENT_LIST_TOOLS_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#ComponentListTools";

/**
 * The same delete tools alone, above a host's own component store's list,
 * where Import from file has nothing to bring in.
 */
export const COMPONENT_DELETE_LIST_TOOLS_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#ComponentDeleteListTools";

/**
 * What the component store's own Delete opens in the document screen's menu:
 * the Delete component dialog, in the built-in Delete's place.
 */
export const DELETE_COMPONENT_REPLACEMENT_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#DeleteComponentReplacement";
