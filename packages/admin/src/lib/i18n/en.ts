/**
 * The admin's own strings in English: the catalog every other interface
 * language falls back to, and the list of keys the admin may ask for.
 *
 * A key is named for where its string is shown, so a screen's strings sit
 * together. A `{name}` in a string is a parameter the caller fills in.
 *
 * Every key begins with `nextly.`, the segment startup reserves for the
 * admin's own strings: a plugin's keys begin with its own slug, and a plugin
 * slugged `nextly` may declare none, so no plugin key can stand in for one of
 * these.
 *
 * @module lib/i18n/en
 */
export const en = {
  "nextly.errors.page.title": "Something went wrong",
  "nextly.errors.page.description.development":
    "An unexpected error occurred while loading this page. Check the console for more details.",
  "nextly.errors.page.description":
    "An unexpected error occurred while loading this page. Please try reloading or contact support if the problem persists.",
  "nextly.errors.page.reload": "Reload page",
  "nextly.errors.page.retry": "Try again",
  "nextly.errors.page.home": "Go home",
  "nextly.errors.page.details": "View technical details",
} as const;
