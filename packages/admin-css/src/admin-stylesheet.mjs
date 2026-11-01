import {
  findUnscopedRules,
  namespaceInternalProperties,
  prefixKeyframes,
  scopeCss,
  splitTopLevel,
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
 * How many element names a host selector may chain and still lose to the
 * shield below: `html body main article section div ul li a` is nine.
 */
const ELEMENT_ONLY_DEPTH = 10;

/**
 * `:is(*, x x … x)`: matches every element, through its first argument, with
 * the specificity of its most specific one, here (0,0,ELEMENT_ONLY_DEPTH). The
 * second argument never needs to match anything; it is there for its weight.
 */
const ANY_ELEMENT_WEIGHTED = `:is(*, ${Array(ELEMENT_ONLY_DEPTH)
  .fill("x")
  .join(" ")})`;

/**
 * The Page Builder's canvas root: `CANVAS_ROOT_CLASS` in `@nextlyhq/builder`
 * (`src/shell-state.ts`), the class its hit-test and positioning code find
 * the canvas by. A test here holds the two to the same name.
 */
const PAGE_BUILDER_CANVAS = ".nx-canvas";

/**
 * Everything but the Page Builder's canvas and what it draws.
 *
 * The canvas is not an iframe: it renders the page being composed inside the
 * admin's own document, and it has to look like the finished page, which on
 * the site takes the site's element rules. So the shield leaves it to them.
 * Inside `:where()`, so the exemption weighs nothing.
 */
const OUTSIDE_PAGE_BUILDER_CANVAS = `:not(:where(${PAGE_BUILDER_CANVAS}, ${PAGE_BUILDER_CANVAS} *))`;

/**
 * The admin's defence against a host's own element rules.
 *
 * The admin renders inside the host's document, so the host's global CSS is
 * in the cascade with it, and a host's rules are usually unlayered: a
 * `globals.css` with `h2 { font-size: ... }`. Every rule of the admin's
 * Tailwind-built sheet is in a cascade layer, and an unlayered rule beats a
 * layered one whatever their specificity, so `h2` beat the admin's own
 * `text-sm` and `leading-5`, and a dashboard card title drew at a site's 36px
 * on a 20px line. Unlayering the admin's sheet is no answer: its layers are
 * what order its own rules (a `divide-*` colour against the base layer's
 * border colour, both at (0,1,0), is decided by them).
 *
 * So one rule, unlayered, on the admin's root and everything inside it:
 * `all: revert-layer`. An unlayered declaration of `revert-layer` sets each
 * property to what it would be with no unlayered rule at all, so the value
 * comes from the admin's own layers, then the browser's defaults, as it does
 * in a host with no global CSS. Presentational hints (an `<svg>`'s `fill`
 * and `stroke-width`, an `<img>`'s `width`) are not reverted by
 * `revert-layer`, and custom properties are outside `all`, so the theme's
 * `--nx-*` tokens and a branding override stay put. An inline `style`
 * attribute is not a rule and still wins.
 *
 * It wins only where it outranks the rule it reverts, and its specificity is
 * chosen for that: (0,0,10). It beats a selector made only of element names
 * (`h2`, `body main p`, `*`, `button::before`), the rules a site writes for
 * its own elements, and loses to anything naming a class, an attribute, a
 * pseudo-class or an id. So the admin's own unlayered rules, every one of
 * them scoped as `.nextly-admin <something>` and so at least (0,1,0), keep
 * winning; so do the toast library's injected `[data-sonner-*]` rules; so does
 * a host's class-based styling of a component it put in the admin, and a
 * plugin's scoped sheet. A host's `a:hover` or `*:focus-visible` is not
 * reverted: reaching those would also revert the toasts' own rules.
 *
 * One part of the admin is exempt: the Page Builder's canvas (see
 * `OUTSIDE_PAGE_BUILDER_CANVAS`), which draws the site's own page and so
 * has to take the site's own rules.
 *
 * The root and the exemption are wrapped in `:where()` so they add nothing,
 * keeping the weight exactly the one chosen. With no host rule in the
 * document the shield changes no computed value, by the definition of
 * `revert-layer`.
 */
const SHIELD_SELECTORS = [
  `:where(.nextly-admin)${ANY_ELEMENT_WEIGHTED}`,
  ...["", "::before", "::after", "::marker", "::placeholder"].map(
    pseudo =>
      `:where(.nextly-admin) ${ANY_ELEMENT_WEIGHTED}${OUTSIDE_PAGE_BUILDER_CANVAS}${pseudo}`
  ),
];

const HOST_ELEMENT_SHIELD = `${SHIELD_SELECTORS.join(", ")} {\n  all: revert-layer;\n}`;

/**
 * One selector as a minifier may print it: whitespace collapsed, none around
 * a comma, and the legacy single colon of `::before` and `::after`.
 *
 * @param {string} selector
 */
function normaliseSelector(selector) {
  return selector
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .replace(/::(before|after)\b/g, ":$1");
}

/**
 * Whether a stylesheet carries the shield, in its source or minified form.
 *
 * The admin's build checks the file it ships with this, after the minifier: a
 * minifier that rewrote `:is(*, x x …)` down to `*` would keep the rule and
 * drop its weight, and the admin would quietly lose to a host's `h2` again.
 * Read by selector rather than as one block of text, because a minifier may
 * also split the list: lightningcss prints the `::marker` selector as a rule
 * of its own.
 *
 * @param {string} css
 * @returns {boolean}
 */
export function hasHostElementShield(css) {
  const reverting = new Set();
  // Every rule whose whole body is `all: revert-layer`, however spaced.
  for (const match of css.matchAll(
    /([^{}]*)\{\s*all\s*:\s*revert-layer\s*;?\s*\}/g
  )) {
    for (const selector of splitTopLevel(match[1])) {
      reverting.add(normaliseSelector(selector));
    }
  }
  return SHIELD_SELECTORS.every(selector =>
    reverting.has(normaliseSelector(selector))
  );
}

/**
 * The admin's own compiled stylesheet, made safe to load in a host's document.
 *
 * The passes, in order: every selector under `.nextly-admin`; then the two
 * kinds of name a document resolves globally whatever selector accompanies
 * them, given the prefix. `@keyframes` names are global: the sheet defines
 * `spin`, `pulse` and `fade-in`, and a host defining its own gets whichever
 * loaded later. `@property` registrations are global too, and worse:
 * registering a name changes its semantics everywhere, and a host running
 * Tailwind registers the same `--tw-*` names. Then the shield that keeps the
 * host's own element rules off the admin (see `HOST_ELEMENT_SHIELD`): the
 * passes before it keep the admin off the host, this keeps the host off the
 * admin. Then a check that no style rule escaped the scope, the shield's
 * included, which throws naming the first offenders: an escaped rule restyles
 * the host page.
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
  // Last, so no pass above reads it: it names no keyframe and no property,
  // and it is already scoped.
  isolated = `${isolated}\n${HOST_ELEMENT_SHIELD}\n`;
  const unscoped = findUnscopedRules(isolated);
  if (unscoped.length > 0) {
    throw new Error(
      `${unscoped.length} style rule(s) escaped the .nextly-admin scope: ` +
        unscoped.slice(0, 5).join(" | ")
    );
  }
  return isolated;
}
