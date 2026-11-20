/**
 * Whether this site draws its header and footer in code
 * (`siteHeaderFooter: "code"`), as the editor's tools ask it.
 *
 * Such a site's header and footer are its own code's, so the Page Builder's
 * header & footer tools would change nothing there: the Pages panel's group,
 * the per-page "Header & footer" menu (Page settings, the entry page, the New
 * page dialog) and the canvas regions are not drawn. Stored sets and the
 * pages' choices are kept as they are, so a site that switches back finds them
 * unchanged. One answer for every place, from the plugin's client config.
 *
 * @module header-footer-in-code
 */
import { usePluginClientConfig } from "@nextlyhq/plugin-sdk/admin";

import { readSiteHeaderFooter } from "./editor/double-header-notice";
import { PLUGIN_SOURCE } from "./editor/stored-document";

/** What the Pages panel says in place of its Header & footer group. */
export const HEADER_FOOTER_IN_CODE_LINE =
  "This site draws its header and footer in code.";

/** Whether the site draws its header and footer in code. */
export function useHeaderFooterInCode(): boolean {
  return readSiteHeaderFooter(usePluginClientConfig(PLUGIN_SOURCE)) === "code";
}
