/**
 * The SEO tab, as the plugin adds it to the admin: one tab on the edit page
 * of each collection and Single the plugin adds SEO to, while creating one
 * as well, after the page's own content.
 *
 * The tab edits the `seo` group, so the page draws the group there and not
 * among its own fields; its values stay in the document's form and are saved
 * with the rest of the document, as a draft where the type has drafts.
 *
 * @module tab/contributions
 */
import type { AdminContribution } from "@nextlyhq/plugin-sdk";

import { SEO_GROUP } from "./typed";

/** The tab's component, as the admin's component map names it. */
export const SEO_TAB_COMPONENT = "@nextlyhq/plugin-seo/admin#SeoTab";

/** The tab's label, and its name in the address (`?tab=`). */
const LABEL = "SEO";

/** The SEO tab on every page the plugin adds the `seo` group to. */
export function seoTabContributions({
  collections,
  singles,
}: {
  collections: readonly string[];
  singles: readonly string[];
}): AdminContribution[] {
  const contributions: AdminContribution[] = [];
  if (collections.length > 0) {
    contributions.push({
      id: "nextlyhq-plugin-seo.tab",
      kind: "tab",
      place: "collection.edit",
      label: LABEL,
      component: SEO_TAB_COMPONENT,
      collections: [...collections],
      fields: [SEO_GROUP],
    });
  }
  if (singles.length > 0) {
    contributions.push({
      id: "nextlyhq-plugin-seo.single-tab",
      kind: "tab",
      place: "single.edit",
      label: LABEL,
      component: SEO_TAB_COMPONENT,
      singles: [...singles],
      fields: [SEO_GROUP],
    });
  }
  return contributions;
}
