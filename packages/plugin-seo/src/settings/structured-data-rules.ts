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
  return {
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
