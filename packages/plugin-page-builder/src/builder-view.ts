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

/** The "Bindings to fix" page, an admin page of this plugin's own. */
export const BINDINGS_TO_FIX_PAGE_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#BindingsToFixPage";

/** The "Bindings to fix" dashboard card. */
export const BINDINGS_TO_FIX_CARD_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#BindingsToFixCard";

/**
 * The Design section of every entry's side panel, declared at the
 * `collection.edit` place: which design the entry is shown with, and its own
 * design. Here, beside the others, for the same reason.
 */
export const ENTRY_DESIGN_SECTION_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#EntryDesignSection";

/** The "Own designs" section of a template's document panel. */
export const TEMPLATE_OWN_DESIGNS_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#TemplateOwnDesigns";

/**
 * The "Own design" section of an own design's document panel: the entry it
 * serves and the template it was copied from, read-only.
 */
export const TEMPLATE_DESIGN_DETAILS_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#TemplateDesignDetails";

/** The delete on a template's document screen, which says what it means. */
export const TEMPLATE_DELETE_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#TemplateDeleteAction";

/**
 * The tools above the Components list: Import from file, and the dialog its
 * row action "Delete component…" opens. Declared here for the same reason.
 */
export const COMPONENT_LIST_TOOLS_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#ComponentListTools";

/**
 * The delete tools for a host's own component store, drawn through the
 * plugin's header slot: on every admin page, so on the store's list whatever
 * the host draws above it, where they register the row action and draw its
 * dialog.
 */
export const COMPONENT_STORE_DELETE_HOST_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#ComponentStoreDeleteHost";

/**
 * What the component store's own Delete opens in the document screen's menu:
 * the Delete component dialog, in the built-in Delete's place.
 */
export const DELETE_COMPONENT_REPLACEMENT_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#DeleteComponentReplacement";
