import {
  findUnscopedRules,
  namespaceInternalProperties,
  prefixKeyframes,
  scopeCss,
} from "./css-scope.mjs";

/**
 * Prefix for the names the admin's stylesheet publishes document-wide: its
 * keyframes and its registered custom properties.
 *
 * Short and shared by both namespacing passes, so a keyframe and a custom
 * property that came from the same build are recognisable as one origin.
 */
export const ADMIN_NAME_PREFIX = "nx-";

/**
 * The admin's own compiled stylesheet, made safe to load in a host's document.
 *
 * The passes, in order: every selector under `.nextly-admin`; then the two
 * kinds of name a document resolves globally whatever selector accompanies
 * them, given the prefix. `@keyframes` names are global: the sheet defines
 * `spin`, `pulse` and `fade-in`, and a host defining its own gets whichever
 * loaded later. `@property` registrations are global too, and worse:
 * registering a name changes its semantics everywhere, and a host running
 * Tailwind registers the same `--tw-*` names. Then a check that no style rule
 * escaped the scope, which throws naming the first offenders: an escaped rule
 * restyles the host page.
 *
 * The one sequence, for the admin's build (`packages/admin/scripts/
 * build-css.mjs`) and for an app that compiles the admin's source stylesheet
 * itself (the playground), so the two cannot drift apart. Takes Tailwind's
 * unminified output, one rule to a line with its whole selector list on it,
 * which is what `scopeCss` reads.
 *
 * @param {string} css
 * @param {{ prefix?: string }} [options]
 * @returns {string}
 */
export function isolateAdminStylesheet(
  css,
  { prefix = ADMIN_NAME_PREFIX } = {}
) {
  let isolated = scopeCss(css);
  isolated = prefixKeyframes(isolated, prefix);
  isolated = namespaceInternalProperties(isolated, prefix);
  const unscoped = findUnscopedRules(isolated);
  if (unscoped.length > 0) {
    throw new Error(
      `${unscoped.length} style rule(s) escaped the .nextly-admin scope: ` +
        unscoped.slice(0, 5).join(" | ")
    );
  }
  return isolated;
}
