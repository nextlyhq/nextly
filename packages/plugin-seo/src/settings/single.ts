/**
 * The SEO settings Single: one document of site-wide rules. The site's name,
 * production addresses, default description and share image, the title
 * pattern of each content type, the brand facts every output reads, what kind
 * of site it is, what AI tools may do, which optional outputs for AI tools
 * are switched on, and how far first-time setup got.
 *
 * A Single rather than plugin settings because it is content: its text is
 * kept per language where the site is translated, its images are media
 * library references, and every write expires the reads made from it.
 *
 * @module settings/single
 */
import { pluginCacheTag } from "@nextlyhq/plugin-sdk";
import {
  checkbox,
  defineSingle,
  json,
  number,
  select,
  text,
  textarea,
  upload,
  type SingleConfig,
} from "nextly/config";

import { SEO_PLUGIN_NAME, SEO_SETTINGS_SLUG, SETUP_STEPS } from "./contract";
import { SEPARATORS } from "./patterns";
import { productionAddressesProblem } from "./production-addresses";
import {
  hiddenTypesProblem,
  patternsProblem,
  socialProfilesProblem,
} from "./stored-values";
import { structuredDataSettingsProblem } from "./structured-data-choices";

/**
 * The cache tags every read of the SEO settings carries. Each write to the
 * Single expires them, so a page, the sitemap or any other output built from
 * the settings is rebuilt on its next request, with no redeploy.
 */
export function seoSettingsCacheTags(): string[] {
  return [pluginCacheTag(SEO_PLUGIN_NAME, "settings")];
}

/** A field `validate` over one of the problem functions above. */
const refusing =
  (problem: (value: unknown) => string | null) =>
  (value: unknown): string | true =>
    problem(value) ?? true;

/** The SEO settings Single, as the plugin contributes it. */
export function seoSettingsSingle(): SingleConfig {
  return defineSingle({
    slug: SEO_SETTINGS_SLUG,
    label: { singular: "SEO settings" },
    description: "Rules for the whole site. A page's own values always win.",
    // One value in every language. A plugin's entity kept per language in a
    // site that declares no languages has storage the runtime cannot write,
    // and a plugin cannot yet declare one kept per language only where the
    // site has languages.
    localized: false,
    // Edited on the plugin's own SEO settings screen, not the generic form.
    admin: { hidden: true },
    revalidate: { tags: seoSettingsCacheTags() },
    fields: [
      text({ name: "siteName", label: "Site name" }),
      json({
        name: "productionAddresses",
        label: "Production addresses",
        validate: refusing(productionAddressesProblem),
      }),
      select({
        name: "separator",
        label: "Between the title and the site name",
        options: SEPARATORS.map(value => ({ label: value, value })),
      }),
      textarea({ name: "description", label: "Default description" }),
      upload({
        name: "image",
        label: "Default share image",
        relationTo: "media",
      }),
      select({
        name: "siteKind",
        label: "Kind of site",
        options: [
          { label: "A company or product", value: "company" },
          { label: "A blog or publication", value: "blog" },
          { label: "An online shop", value: "shop" },
          { label: "A local business", value: "local" },
        ],
      }),
      select({
        name: "aiCrawlers",
        label: "AI tools",
        options: [
          { label: "Allow all AI tools", value: "all" },
          { label: "Allow AI search, not training", value: "search" },
          { label: "Block all AI tools", value: "block" },
        ],
      }),
      text({ name: "brandName", label: "Brand name" }),
      text({ name: "brandOtherNames", label: "Other names" }),
      upload({
        name: "logo",
        label: "Logo",
        relationTo: "media",
      }),
      json({
        name: "socialProfiles",
        label: "Social profiles",
        validate: refusing(socialProfilesProblem),
      }),
      json({
        name: "patterns",
        label: "Title patterns",
        validate: refusing(patternsProblem),
      }),
      json({
        name: "hiddenTypes",
        label: "Content types hidden from search",
        validate: refusing(hiddenTypesProblem),
      }),
      json({
        name: "structuredData",
        label: "Structured data",
        validate: refusing(structuredDataSettingsProblem),
      }),
      // The optional outputs for AI tools, each off until switched on.
      checkbox({ name: "llmsTxt", label: "llms.txt" }),
      checkbox({
        name: "plainTextCopies",
        label: "Plain-text copies of pages",
      }),
      number({
        name: "setupStep",
        label: "Setup steps done",
        min: 0,
        max: SETUP_STEPS,
      }),
      checkbox({
        name: "setupDismissed",
        label: "Setup closed for later",
      }),
    ],
  });
}
