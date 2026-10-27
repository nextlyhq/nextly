import type { Metadata } from "next";

import {
  resolveAccountsSettings,
  type AccountsOptions,
  type AccountsSettings,
} from "../settings";

/**
 * The pages a link from an email lands on, each carrying the link's token
 * in its address until the visitor confirms.
 */
const LINK_PAGES = [
  "verify",
  "notMe",
  "reset",
  "confirmAddress",
  "cancelAddressChange",
] as const satisfies readonly (keyof AccountsSettings["pages"])[];

/**
 * The metadata for a page a link from an email lands on: it sends no
 * referrer, so the token in its address never reaches another site, an
 * image host or an analytics report. `export const metadata =
 * linkPageMetadata` on each such page.
 *
 * @experimental
 */
export const linkPageMetadata: {
  readonly referrer: "no-referrer";
} = {
  referrer: "no-referrer",
} as const satisfies Metadata;

/**
 * The `Referrer-Policy: no-referrer` header for every page a link from an
 * email lands on, at the paths the plugin's options give them, for
 * `headers()` in `next.config`: `async headers() { return
 * linkPageHeaders(accountsOptions); }`, with the options the site passes to
 * `accounts()`.
 *
 * @experimental
 * @throws `ACCOUNTS_INVALID_OPTIONS` for an option outside its bounds
 */
export function linkPageHeaders(options: AccountsOptions): Array<{
  source: string;
  headers: Array<{ key: string; value: string }>;
}> {
  const { pages } = resolveAccountsSettings(options);

  return LINK_PAGES.map(page => ({
    source: pages[page],
    headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
  }));
}
