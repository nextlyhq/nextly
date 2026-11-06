import path from "node:path";

import { isolateAdminStylesheet } from "@nextlyhq/admin-css";

/**
 * Scopes the playground's compile of the admin's source stylesheet the way the
 * admin's own build scopes what ships.
 *
 * `next.config.ts` aliases `@nextlyhq/admin` to the admin's source for HMR, so
 * the playground bundles `RootLayout.tsx` and its `import
 * "../styles/globals.css"`, which a published admin never carries (its build
 * resolves component stylesheet imports to an empty module). That file starts
 * with `@import "tailwindcss"`, and compiled here as it stands it is a whole
 * unscoped Tailwind sheet: a theme on `:root` and a reset on `html` that
 * restyle every page the admin has visited, the site's included. This runs
 * `isolateAdminStylesheet` on that one file, the same function the admin's
 * build (`packages/admin/scripts/build-css.mjs`) runs on the published
 * `style.css`, so the admin the playground shows is the one users get.
 */

/**
 * The admin's source stylesheet, the only file this touches, by the end of its
 * resolved path. Not from `import.meta.url`: Turbopack bundles this module
 * with the PostCSS config, so the module's own address is the bundle's.
 */
const ADMIN_SOURCE_STYLESHEET = path.join(
  "packages",
  "admin",
  "src",
  "styles",
  "globals.css"
);

/** @returns {import("postcss").Plugin} */
export default function scopeAdminSource() {
  return {
    postcssPlugin: "nextly-scope-admin-source",
    OnceExit(root, { result, postcss }) {
      const from = result.opts.from;
      if (
        !from ||
        !path.resolve(from).endsWith(path.sep + ADMIN_SOURCE_STYLESHEET)
      )
        return;
      // One rule to a line, its whole selector list on it, as the function
      // reads the Tailwind CLI's output in the admin's own build. Here
      // Tailwind keeps a list's line breaks from the source, and in a
      // production build minifies its output (its `optimize` follows
      // NODE_ENV), where the admin's build scopes before it minifies.
      root.cleanRaws();
      root.walkRules(rule => {
        rule.selector = rule.selectors.join(", ");
      });
      // Throws on a rule that escaped the scope, failing the compile: an
      // escaped rule restyles the site, the defect this module prevents.
      const css = isolateAdminStylesheet(root.toString());
      root.removeAll();
      root.append(postcss.parse(css, { from }).nodes);
    },
  };
}
scopeAdminSource.postcss = true;
