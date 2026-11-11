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

import { STRUCTURED_DATA_FIELD } from "./contract";
import { SEO_GROUP, TYPED_SEO_FIELDS } from "./typed";

/** The tab's component, as the admin's component map names it. */
export const SEO_TAB_COMPONENT = "@nextlyhq/plugin-seo/admin#SeoTab";

/** The tab's label, and its name in the address (`?tab=`). */
const LABEL = "SEO";

/**
 * Every field of the `seo` group the tab has a control for: what a person
 * types for the page, and the page's choice of structured data type. A
 * control is offered only for the ones a group declares.
 */
const TAB_FIELDS: readonly string[] = [
  ...TYPED_SEO_FIELDS,
  STRUCTURED_DATA_FIELD,
];

/**
 * Whether a field's own admin options limit how it is edited: read-only,
 * disabled, hidden, or shown only under a condition. The tab edits every
 * field it draws, so a group with one of those stays among the page's own
 * fields, where the form honours them.
 */
function isGated(admin: unknown): boolean {
  if (typeof admin !== "object" || admin === null) return false;
  const options = admin as Record<string, unknown>;
  return (
    Boolean(options.readOnly) ||
    Boolean(options.disabled) ||
    Boolean(options.hidden) ||
    options.condition !== undefined
  );
}

/**
 * Whether the tab can edit every field of a group: it edits the fields the
 * plugin ships, so a group of other fields, such as one with a focus keyword
 * added, stays among the page's own fields, where each can be edited.
 */
export function tabEditsGroup(
  fields: readonly { name?: unknown; admin?: unknown }[]
): boolean {
  const names = fields.map(field => field.name);
  return (
    names.includes("metaTitle") &&
    names.includes("metaDescription") &&
    fields.every(field => !isGated(field.admin)) &&
    names.every(name => typeof name === "string" && TAB_FIELDS.includes(name))
  );
}

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
