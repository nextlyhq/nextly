import type { AccountsSettings } from "../settings";

/**
 * A link to one of the site's pages, always on the configured origin and
 * never on anything a request said, carrying `token` when there is one.
 */
export function pageLink(
  settings: Pick<AccountsSettings, "origin" | "pages">,
  page: keyof AccountsSettings["pages"],
  token?: string
): string {
  const url = new URL(settings.pages[page], settings.origin);
  if (token !== undefined) url.searchParams.set("token", token);

  return url.toString();
}
