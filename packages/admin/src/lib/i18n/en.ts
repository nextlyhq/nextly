/**
 * The admin's own strings in English: the catalog every other interface
 * language falls back to, and the list of keys the admin may ask for.
 *
 * A key is named for where its string is shown, so a screen's strings sit
 * together. A `{name}` in a string is a parameter the caller fills in.
 *
 * @module lib/i18n/en
 */
export const en = {
  "errors.page.title": "Something went wrong",
  "errors.page.description.development":
    "An unexpected error occurred while loading this page. Check the console for more details.",
  "errors.page.description":
    "An unexpected error occurred while loading this page. Please try reloading or contact support if the problem persists.",
  "errors.page.reload": "Reload page",
  "errors.page.retry": "Try again",
  "errors.page.home": "Go home",
  "errors.page.details": "View technical details",
} as const;
