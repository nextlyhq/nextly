import path from "node:path";

import {
  findUnscopedRules,
  namespaceInternalProperties,
  prefixKeyframes,
  scopeCss,
} from "@nextlyhq/admin-css";

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
 * restyle every page the admin has visited, the site's included. The
 * published `style.css` gets the same passes in `packages/admin/scripts/
 * build-css.mjs`; these run them on that one file, from the same package, so
 * the admin the playground shows is the one users get.
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

/**
 * The prefix `build-css.mjs` gives the names this sheet publishes
 * document-wide, so the keyframes and properties match the published sheet's.
 */
const NAME_PREFIX = "nx-";

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
      // One rule to a line, its whole selector list on it, as `scopeCss`
      // reads the Tailwind CLI's output in the admin's own build. Here
      // Tailwind keeps a list's line breaks from the source, and in a
      // production build minifies its output (its `optimize` follows
      // NODE_ENV), where the admin's build scopes before it minifies.
      root.cleanRaws();
      root.walkRules(rule => {
        rule.selector = rule.selectors.join(", ");
      });
      let css = scopeCss(root.toString());
      css = prefixKeyframes(css, NAME_PREFIX);
      css = namespaceInternalProperties(css, NAME_PREFIX);
      // The admin's build refuses a rule that escapes the scope, and so does
      // this: an escaped rule restyles the site, which is the defect this
      // module exists to prevent, so it fails the compile rather than pass.
      const unscoped = findUnscopedRules(css);
      if (unscoped.length > 0) {
        throw new Error(
          `${unscoped.length} rule(s) of the admin's source stylesheet escaped .nextly-admin: ${unscoped.slice(0, 5).join(" | ")}`
        );
      }
      root.removeAll();
      root.append(postcss.parse(css, { from }).nodes);
    },
  };
}
scopeAdminSource.postcss = true;
