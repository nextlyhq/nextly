/**
 * What the SEO tab adds to the plugin's contributions: the tab on each page
 * the `seo` group is added to, and the route it reads a page's automatic
 * values from. Kept apart from `tab/contributions`, which the admin bundle
 * imports, because the route is server code.
 *
 * @module tab/install
 */
import type { FieldConfig, PluginContributions } from "@nextlyhq/plugin-sdk";

import type { ReadRules } from "../resolver/provider";
import type { SeoTypes } from "../seo-types";
import type { ReadSocialCardRules } from "../social/card";
import type { ReadStructuredDataRules } from "../structured-data/rules";

import { seoTabContributions, tabEditsGroup } from "./contributions";
import { seoTabRoute } from "./route";

/** The tab and its route, for the collections and Singles with the group. */
export function seoTabParts(setup: {
  /** The types with the group, read when asked. */
  types: SeoTypes;
  /** The fields in the group; a group the tab cannot edit gets no tab. */
  fields: readonly FieldConfig[];
  /** The origin the plugin was configured with, where it was. */
  baseUrl: string | undefined;
  /** Where the page's head reads the site's rules from. */
  readRules: ReadRules;
  /** Where structured data reads its rules from. */
  readStructuredDataRules: ReadStructuredDataRules;
  /** Where the social card reads its rules from. */
  readSocialCardRules: ReadSocialCardRules;
  /** Whether a page's SEO has a permission of its own. */
  pagePermissions: boolean;
}): Pick<PluginContributions, "admin"> & {
  routes: NonNullable<PluginContributions["routes"]>;
} {
  const { types, fields, baseUrl } = setup;
  const names = fields.flatMap(field =>
    typeof field.name === "string" ? [field.name] : []
  );
  const edits = tabEditsGroup(fields);
  // Where else the tab is drawn, as in the Page Builder's Settings, it asks
  // the admin whether the edit page draws it for that page's type, so no
  // list of the tab's types is handed anywhere to go stale.
  return {
    // A group of fields the tab does not edit stays among the page's own
    // fields instead.
    ...(edits
      ? {
          admin: {
            contributions: seoTabContributions(types.named ? types : "every"),
          },
        }
      : {}),
    routes: [
      seoTabRoute({
        // Read on each request, as the types are.
        get collections() {
          return types.collections;
        },
        get singles() {
          return types.singles;
        },
        fields: names,
        readRules: setup.readRules,
        readStructuredDataRules: setup.readStructuredDataRules,
        readSocialCardRules: setup.readSocialCardRules,
        pagePermissions: setup.pagePermissions,
        ...(baseUrl === undefined ? {} : { baseUrl }),
      }),
    ],
  };
}
