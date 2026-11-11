/**
 * Client-free constants shared by the plugin definition (loaded in a Node
 * config context) and the admin component (loaded in the browser), so
 * `plugin.ts` never imports the client component.
 */

/** The component the widget check's page draws, as the admin registry names it. */
export const WIDGET_CHECK_PAGE_PATH = "playground/widget-check-fixture#Page";

/** The page's path under the plugin's namespace in the admin. */
export const WIDGET_CHECK_PAGE = "widgets";
