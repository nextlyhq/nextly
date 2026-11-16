/**
 * Client-free constants shared by the plugin definition (loaded in a Node
 * config context) and the admin component (loaded in the browser), so
 * `plugin.ts` never imports the client component.
 */

/** The plugin's name, which its route answers under. */
export const STARTUP_READ_PLUGIN = "startup-read-fixture";

/** The component the fixture's page draws, as the admin registry names it. */
export const STARTUP_READ_PAGE_COMPONENT =
  "playground/startup-read-fixture#Page";

/** The page's path under the plugin's namespace in the admin. */
export const STARTUP_READ_PAGE = "greeting";

/** The route the page reads as it opens, within the plugin's namespace. */
export const STARTUP_READ_ROUTE = "/greeting";

/** What the route answers, which only the page draws. */
export const STARTUP_READ_GREETING = "Hello from the startup read fixture";
