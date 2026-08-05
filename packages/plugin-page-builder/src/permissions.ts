/**
 * The permissions this plugin declares, and the strings its rules read.
 *
 * One permission, not a vocabulary. A `publish` permission was declared here
 * once and nothing ever read it: granting it did nothing and withholding it
 * prevented nothing, so it was removed with the instruction to declare it again
 * alongside the check. That rule holds for every name the page-builder plans
 * eventually need — classes, tokens, patterns, components — so each arrives
 * with the surface that enforces it rather than ahead of it.
 *
 * Custom CSS is the one that has a surface today: the `pages` collection
 * carries a `customCss` field, so there is somewhere for a check to live.
 *
 * @module permissions
 */

/**
 * Custom CSS is a privilege, not an ordinary field.
 *
 * It is author-written CSS that reaches the published page. The compiler
 * refuses a remote `url()` by default, but a site that has declared
 * `remotePatterns` for its images has declared them for this too — and a
 * selector can make such a request conditional, so what loads can be made to
 * depend on what a page contains. It also styles a surface other people read.
 * Neither is a reason to forbid it; both are reasons for it to be granted.
 */
export const CUSTOM_CSS_ACTION = "write";
export const CUSTOM_CSS_RESOURCE = "builder-custom-css";

/**
 * The permission as an access RULE reads it: `resource:action`.
 *
 * Deliberately not spelled by hand at the call site. The database and the
 * admin's permission matrix use `action-resource` for the same row, and the two
 * are easy to confuse — a rule written with the database spelling silently
 * matches nothing and denies. One exported constant means the rule and the
 * declaration cannot drift apart.
 */
export const CUSTOM_CSS_GRANT = `${CUSTOM_CSS_RESOURCE}:${CUSTOM_CSS_ACTION}`;
