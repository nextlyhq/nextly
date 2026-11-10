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
  // The labels of the development-only error boxes. Those boxes are folded out
  // of a production build, and these two strings go with them: the ternary
  // sits here, not in a helper, so the build's folding can drop the text. A
  // string left in the catalog ships to every production user. Each says
  // its type because the published declarations are written without inference.
  "nextly.errors.page.details": (process.env.NODE_ENV === "production"
    ? ""
    : "View technical details") as string,
  "nextly.errors.section.title": "Error loading section",
  "nextly.errors.section.description":
    "An error occurred while loading this section. Please try again.",
  "nextly.errors.section.details": (process.env.NODE_ENV === "production"
    ? ""
    : "Error details") as string,
  "nextly.errors.section.retry": "Try Again",
  "nextly.errors.inline.message": "Error loading content",
  "nextly.errors.inline.development": "Error: {message}",
  "nextly.status.back": "Go back",
  "nextly.status.dashboard": "Go to dashboard",
  "nextly.status.notFound.label": "Page Not Found",
  "nextly.status.notFound.title": "Oops! This page doesn't exist",
  "nextly.status.notFound.description":
    "The page you're looking for may have been moved, deleted, or the URL might be incorrect.",
  "nextly.status.noAccess.label": "No access",
  "nextly.status.noAccess.title.collection":
    "You don't have access to this collection",
  "nextly.status.noAccess.title.single": "You don't have access to this Single",
  "nextly.status.noAccess.title.page": "You don't have access to this page",
  "nextly.status.noAccess.description":
    "Your account doesn't have permission to open it. If you need it, ask an admin.",
  "nextly.pagination.label": "Pagination",
  "nextly.pagination.first": "Go to first page",
  "nextly.pagination.previous": "Go to previous page",
  "nextly.pagination.next": "Go to next page",
  "nextly.pagination.last": "Go to last page",
  "nextly.pagination.page": "Go to page {page}",
  "nextly.search.placeholder": "Search...",
  "nextly.search.clear": "Clear search",
  "nextly.userMenu.interfaceLanguage": "Interface language",
  "nextly.userMenu.followBrowser": "Follow the browser",
  "nextly.userMenu.unavailable": "{language} (not available)",
  "nextly.userMenu.saveFailed": "Your interface language could not be saved.",
  "nextly.places.userDetail.content": "Profile",
  "nextly.places.settings.content": "General",
  "nextly.places.unavailable": "This part of the page couldn't be loaded.",
} as const;
