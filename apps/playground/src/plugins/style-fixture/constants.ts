/**
 * Client-free constants shared by the plugin definition (loaded in a Node
 * config context) and the admin component (loaded in the browser). Keeping the
 * component-path string here means `plugin.ts` never imports the client
 * component, so loading `nextly.config.ts` doesn't pull admin/React into Node.
 */
export const STYLE_FIXTURE_PATH = "playground/style-fixture#Showcase";
