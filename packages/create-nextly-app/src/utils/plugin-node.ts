// The range test is the CLI's one semver reading, shared with the Next.js
// and React check an existing app goes through.
import { satisfiesRange } from "./version-range";

/**
 * The Node versions a scaffolded plugin supports, and the check that refuses
 * to scaffold one on a Node it cannot build on.
 *
 * A plugin builds with tsdown and tests with Vitest, and each declares the
 * Node it runs on; the plugin's floor is where both agree. The repository's
 * packages have a lower floor, because only a plugin author runs these tools.
 * `scaffold-plugin.test.ts` derives this range from the installed tools' own
 * `engines`, so a version bump that moves either one fails there.
 */
export const PLUGIN_NODE_ENGINES = "^22.18.0 || ^24.11.0 || >=26.0.0";

/**
 * Why the plugin template cannot be scaffolded on `nodeVersion`, or
 * `undefined` when it can. Checked before anything is written, since a plugin
 * scaffolded on an older Node would install and then fail its first build.
 */
export function pluginNodeRefusal(nodeVersion: string): string | undefined {
  if (satisfiesRange(nodeVersion, PLUGIN_NODE_ENGINES)) return undefined;
  return (
    `The plugin template builds with tools that need Node ${PLUGIN_NODE_ENGINES}, ` +
    `and this is Node ${nodeVersion}. Install a supported Node (for example ` +
    "`nvm install 24`) and run create-nextly-app again."
  );
}
