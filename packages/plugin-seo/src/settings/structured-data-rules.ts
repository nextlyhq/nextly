/**
 * Structured data's rules from the SEO settings: the site's production
 * address as its origin, the brand facts, and each content type's choice of
 * type and the fields that hold each detail. Each fact the settings hold
 * wins over the plugin's options, which stay the answer for every fact the
 * settings leave empty.
 *
 * @module settings/structured-data-rules
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import type {
  ReadStructuredDataRules,
  StructuredDataBrand,
  StructuredDataRules,
} from "../structured-data/rules";

import {
  readStructuredDataSettings,
  type StructuredDataSettings,
} from "./rules";

/** The brand as structured data names it: the settings' facts over the options'. */
function brandOf(
  base: StructuredDataBrand,
  settings: StructuredDataSettings
): StructuredDataBrand {
  const { brand } = settings;
  const name = brand.name ?? settings.siteName ?? base.name;
  const logo = brand.logo ?? base.logo;
  const otherNames =
    brand.otherNames.length > 0 ? brand.otherNames : base.otherNames;
  const profiles =
    brand.profiles.length > 0
      ? brand.profiles.map(profile => ({ url: profile.url }))
      : base.profiles;
  // The brand's own description where the options give one, else the site's
  // default description, which says what the site is.
  const description = base.description ?? settings.description;
  return {
    // The facts the settings do not hold, such as contact points, are the
    // options' alone.
    ...base,
    ...(description === undefined ? {} : { description }),
    ...(name === undefined ? {} : { name }),
    ...(otherNames === undefined ? {} : { otherNames }),
    ...(logo === undefined ? {} : { logo }),
    ...(profiles === undefined ? {} : { profiles }),
  };
}

/** `base`, the plugin's options, with every fact the settings hold taking over. */
export function structuredDataRulesOf(
  base: StructuredDataRules,
  settings: StructuredDataSettings
): StructuredDataRules {
  const origin = settings.origin ?? base.origin;
  return {
    ...base,
    ...(origin === undefined ? {} : { origin }),
    brand: brandOf(base.brand, settings),
    types: { ...base.types, ...settings.types },
  };
}

/** Structured data's reader: the SEO settings, then the plugin's options. */
export function structuredDataFromSettings(
  fromOptions: ReadStructuredDataRules
): ReadStructuredDataRules {
  return async (ctx: PluginContext, locale: string | undefined) => {
    const [base, settings] = await Promise.all([
      fromOptions(ctx, locale),
      readStructuredDataSettings(ctx, locale),
    ]);
    return structuredDataRulesOf(base, settings);
  };
}
