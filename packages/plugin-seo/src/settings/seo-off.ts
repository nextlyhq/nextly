/**
 * Which content types have their SEO switched off in the settings: the one
 * reading of `typesWithSeoOff` every output, the problem list and the admin
 * switch use, so none of them disagrees about a type.
 *
 * Off changes no schema and no stored value. A type stays off only while the
 * plugin adds SEO to it: a key naming any other type is ignored, with one
 * warning, since a type left out in the configuration or removed has nothing
 * to switch.
 *
 * @module settings/seo-off
 */
import type { ExtendedType } from "@nextlyhq/plugin-sdk";

import { pageTypeOf } from "../problems/page-types";
import type { SeoTypes } from "../seo-types";

/** The keys already warned about, so each is said once per process. */
const warned = new Set<string>();

/**
 * The keys `rules` switches SEO off for, among the types with SEO, each once:
 * the one filtering every reading of the switch goes through, so a stale key
 * (a type left out since, or removed) switches nothing off anywhere.
 */
export function seoOffKeys(
  rules: { readonly typesWithSeoOff?: readonly string[] },
  types: Pick<SeoTypes, "keys">,
  warn: (message: string) => void = message => console.warn(message)
): string[] {
  const keys = new Set(types.keys);
  const off: string[] = [];
  for (const key of new Set(rules.typesWithSeoOff ?? [])) {
    if (keys.has(key)) {
      off.push(key);
    } else if (!warned.has(key)) {
      warned.add(key);
      warn(
        `[seo] The SEO settings switch SEO off for "${key}", which has no SEO, so the setting is ignored.`
      );
    }
  }
  return off;
}

/** The types `rules` switches SEO off for, among those with SEO. */
export function seoOffTypes(
  rules: { readonly typesWithSeoOff?: readonly string[] },
  types: Pick<SeoTypes, "keys">,
  warn?: (message: string) => void
): ExtendedType[] {
  return seoOffKeys(rules, types, warn).map(pageTypeOf);
}

/** Whether `rules` switches SEO off for the type kept under `key`. */
export function isSeoOff(
  rules: { readonly typesWithSeoOff?: readonly string[] },
  key: string
): boolean {
  return rules.typesWithSeoOff?.includes(key) === true;
}
