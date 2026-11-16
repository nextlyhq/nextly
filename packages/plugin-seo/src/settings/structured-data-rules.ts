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

/** `{ [key]: value }` where the value is set, and nothing where it is not. */
const defined = <K extends string, V>(
  key: K,
  value: V | undefined
): Partial<Record<K, V>> =>
  value === undefined ? {} : ({ [key]: value } as Partial<Record<K, V>>);

/** A list the settings hold, where they hold one with anything in it. */
const heldList = <T>(
  list: readonly T[] | undefined
): readonly T[] | undefined =>
  list !== undefined && list.length > 0 ? list : undefined;

/**
 * The owner as structured data names it: each of its facts the settings
 * hold over the options' same fact, and none where neither side names it.
 */
function parentOf(
  base: StructuredDataBrand["parentOrganization"],
  settings: StructuredDataSettings["brand"]["parentOrganization"]
): StructuredDataBrand["parentOrganization"] {
  const name = settings?.name ?? base?.name;
  if (name === undefined) return undefined;
  return {
    ...base,
    ...settings,
    name,
  };
}

/**
 * The brand as structured data names it: fact by fact, the settings' over
 * the options', so a site moves each fact from its code to the admin on its
 * own, and a fact only the code gives (its founders, say) stays. A list (the
 * other names, profiles, contact points) is one fact, taken whole from the
 * side that holds it.
 */
function brandOf(
  base: StructuredDataBrand,
  settings: StructuredDataSettings
): StructuredDataBrand {
  const { brand } = settings;
  // The brand's own name before the site's, which names the site.
  const name = brand.name ?? base.name ?? settings.siteName;
  const otherNames = heldList(brand.otherNames) ?? base.otherNames;
  const profiles =
    heldList(brand.profiles)?.map(profile => ({ url: profile.url })) ??
    base.profiles;
  const contactPoints = heldList(brand.contactPoints) ?? base.contactPoints;
  // The brand's own description where either side gives one, else the
  // site's default description, which says what the site is.
  const description =
    brand.description ?? base.description ?? settings.description;
  return {
    ...base,
    ...defined("name", name),
    ...defined("otherNames", otherNames),
    ...defined("logo", brand.logo ?? base.logo),
    ...defined("profiles", profiles),
    ...defined("description", description),
    ...defined("email", brand.email ?? base.email),
    ...defined("telephone", brand.telephone ?? base.telephone),
    ...defined("foundingDate", brand.foundingDate ?? base.foundingDate),
    ...defined("contactPoints", contactPoints),
    ...defined(
      "parentOrganization",
      parentOf(base.parentOrganization, brand.parentOrganization)
    ),
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
