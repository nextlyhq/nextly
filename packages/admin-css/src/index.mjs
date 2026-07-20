/**
 * @nextlyhq/admin-css — the one implementation of admin CSS scoping.
 *
 * The admin mounts inside the host's document, so every rule must stay under
 * `.nextly-admin` or it restyles the host page. This module owns that scoping
 * and is shared by two builds: the admin's own `build-css.mjs` and the
 * `nextly-build-admin-css` CLI that third-party plugins use to compile their
 * `admin.styles`. One implementation so the two can never drift.
 */
export {
  scopeCss,
  confineVariantClasses,
  findUnscopedRules,
  isScoped,
  namespaceInternalProperties,
  prefixKeyframes,
  scopeSelector,
  splitTopLevel,
} from "./css-scope.mjs";
export { checkAdminStyles } from "./check-admin-styles.mjs";
