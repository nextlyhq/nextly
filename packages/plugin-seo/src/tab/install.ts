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
import type { ReadSocialCardRules } from "../social/card";
import type { ReadStructuredDataRules } from "../structured-data/rules";

import { seoTabContributions, tabEditsGroup } from "./contributions";
import { seoTabRoute } from "./route";

/** The tab and its route, for the collections and Singles with the group. */
export function seoTabParts(setup: {
  collections: readonly string[];
  singles: readonly string[];
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
}): Pick<PluginContributions, "admin"> & {
  routes: NonNullable<PluginContributions["routes"]>;
} {
  const { collections, singles, fields, baseUrl } = setup;
  const names = fields.flatMap(field =>
    typeof field.name === "string" ? [field.name] : []
  );
  return {
    // A group of fields the tab does not edit stays among the page's own
    // fields instead.
    ...(tabEditsGroup(fields)
      ? {
          admin: {
            contributions: seoTabContributions({ collections, singles }),
          },
        }
      : {}),
    routes: [
      seoTabRoute({
        collections,
        singles,
        fields: names,
        readRules: setup.readRules,
        readStructuredDataRules: setup.readStructuredDataRules,
        readSocialCardRules: setup.readSocialCardRules,
        ...(baseUrl === undefined ? {} : { baseUrl }),
      }),
    ],
  };
}
