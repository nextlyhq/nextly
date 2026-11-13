/**
 * The SEO tab, as the plugin adds it to the admin: one tab on the edit page
 * of each collection and Single the plugin adds SEO to, while creating one
 * as well, after the page's own content; and the side panel's one read-only
 * line saying whether the page is listed, after the panel's details.
 *
 * The tab edits the `seo` group, so the page draws the group there and not
 * among its own fields; its values stay in the document's form and are saved
 * with the rest of the document, as a draft where the type has drafts.
 *
 * @module tab/contributions
 */
import type { AdminContribution } from "@nextlyhq/plugin-sdk";

import { SEO_TAB_ID, SINGLE_SEO_TAB_ID } from "../problems/contract";

import { STRUCTURED_DATA_FIELD } from "./contract";
import { SEO_GROUP } from "./typed";

/** The tab's component, as the admin's component map names it. */
export const SEO_TAB_COMPONENT = "@nextlyhq/plugin-seo/admin#SeoTab";

/** The side panel's read-only SEO line, as the component map names it. */
export const SEO_STATUS_COMPONENT =
  "@nextlyhq/plugin-seo/admin#SeoStatusSection";

/** The tab's label. */
const LABEL = "SEO";

/** The side panel line's heading. */
const STATUS_LABEL = "Search";

/**
 * Every field of the `seo` group the tab has a control for, and the field
 * types that control writes: what a person types for the page, and the
 * page's choice of structured data type. A control is offered only for the
 * ones a group declares.
 */
const TAB_FIELDS: Readonly<Record<string, readonly string[]>> = {
  metaTitle: ["text"],
  metaDescription: ["text", "textarea"],
  socialTitle: ["text"],
  socialDescription: ["text", "textarea"],
  ogImage: ["upload"],
  canonical: ["text"],
  canonicalElsewhere: ["checkbox"],
  noindex: ["checkbox"],
  [STRUCTURED_DATA_FIELD]: ["text"],
  maxImagePreview: ["text"],
  maxSnippet: ["number"],
  nosnippet: ["checkbox"],
  noimageindex: ["checkbox"],
  unavailableAfter: ["date"],
  noarchive: ["checkbox"],
  nocache: ["checkbox"],
};

/**
 * Whether the tab's control for a field writes what the field stores: a
 * field of that type holding one value, not a list.
 */
function tabWrites(field: {
  name?: unknown;
  type?: unknown;
  hasMany?: unknown;
}): boolean {
  if (typeof field.name !== "string" || field.hasMany === true) return false;
  const types = Object.hasOwn(TAB_FIELDS, field.name)
    ? TAB_FIELDS[field.name]
    : undefined;
  return types !== undefined && types.includes(String(field.type));
}

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
  fields: readonly {
    name?: unknown;
    type?: unknown;
    hasMany?: unknown;
    admin?: unknown;
  }[]
): boolean {
  const names = fields.map(field => field.name);
  return (
    names.includes("metaTitle") &&
    names.includes("metaDescription") &&
    fields.every(field => !isGated(field.admin) && tabWrites(field))
  );
}

/**
 * The SEO tab, and its side panel line, on every page the plugin adds the
 * `seo` group to: on the types the site names, or, where SEO is on every
 * type, wherever core says the start added the plugin's own group
 * (`extendedWith`), so a type that kept a field of its own named `seo` gets
 * no tab writing into it.
 */
export function seoTabContributions(
  types:
    | { collections: readonly string[]; singles: readonly string[] }
    | "every"
): AdminContribution[] {
  const every = types === "every";
  const onCollections = every
    ? { extendedWith: [SEO_GROUP] }
    : { collections: [...types.collections] };
  const onSingles = every
    ? { extendedWith: [SEO_GROUP] }
    : { singles: [...types.singles] };
  const contributions: AdminContribution[] = [];
  if (every || types.collections.length > 0) {
    contributions.push({
      // The ids links open the tab by (`seoTabIdOf`), held in one place.
      id: SEO_TAB_ID,
      kind: "tab",
      place: "collection.edit",
      label: LABEL,
      component: SEO_TAB_COMPONENT,
      ...onCollections,
      fields: [SEO_GROUP],
    });
    contributions.push({
      id: "nextlyhq-plugin-seo.status",
      kind: "sidebarSection",
      place: "collection.edit",
      label: STATUS_LABEL,
      component: SEO_STATUS_COMPONENT,
      after: "details",
      ...onCollections,
    });
  }
  if (every || types.singles.length > 0) {
    contributions.push({
      id: SINGLE_SEO_TAB_ID,
      kind: "tab",
      place: "single.edit",
      label: LABEL,
      component: SEO_TAB_COMPONENT,
      ...onSingles,
      fields: [SEO_GROUP],
    });
    contributions.push({
      id: "nextlyhq-plugin-seo.single-status",
      kind: "sidebarSection",
      place: "single.edit",
      label: STATUS_LABEL,
      component: SEO_STATUS_COMPONENT,
      after: "details",
      ...onSingles,
    });
  }
  return contributions;
}
