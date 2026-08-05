/**
 * The permissions this plugin declares, and the strings its rules read.
 *
 * One permission, not a vocabulary. A permission is only worth declaring where
 * something reads it: one that no check consults grants nothing when held and
 * prevents nothing when withheld, while still appearing in the admin's matrix
 * as though it protected something. Custom CSS has a check to attach to — the
 * `pages` collection carries a `customCss` field — so it is declared here.
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
