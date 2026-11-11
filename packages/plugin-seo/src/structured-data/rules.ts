/**
 * What structured data is worked out from beyond the page itself: the site's
 * address and brand facts, and each content type's choice of type and the
 * fields that hold each detail.
 *
 * Read through {@link ReadStructuredDataRules}, so the SEO settings can supply
 * them as they supply the resolver's rules, and the plugin's own options
 * supply them until then.
 *
 * @module structured-data/rules
 */
import {
  NextlyError,
  type PageMetadataImage,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import {
  DETAIL_LABELS,
  isStructuredDataTypeKey,
  type StructuredDataDetail,
  type StructuredDataTypeKey,
} from "./catalog";

/**
 * Where a detail is read from: the name of a field of the page (a dotted path
 * reaches into a group, `event.venue`), or a value that holds for every page
 * of the type, such as `{ value: "USD" }` for a currency.
 */
export type DetailSource = string | { value: string };

/** Which field holds each detail of one type. */
export type DetailMapping = Partial<Record<StructuredDataDetail, DetailSource>>;

/** One content type's choice, keyed like a pattern: slug or `single:<slug>`. */
export interface StructuredDataTypeRule {
  /** The type its pages are described as, unless a page chooses another. */
  type?: StructuredDataTypeKey;
  /** For each type its pages may be described as, where each detail is. */
  details?: Partial<Record<StructuredDataTypeKey, DetailMapping>>;
}

/** The facts about who owns the site that every page's data names. */
export interface StructuredDataBrand {
  name?: string;
  /** Other names people search for the brand by. */
  otherNames?: readonly string[];
  logo?: PageMetadataImage;
  /** The brand's official accounts elsewhere. */
  profiles?: readonly { url: string }[];
}

/** Everything structured data reads beyond the page and its answer. */
export interface StructuredDataRules {
  /**
   * The site's public origin, such as `https://example.com`: every address
   * in structured data is absolute, so none is written without it.
   */
  origin?: string;
  brand: StructuredDataBrand;
  /** Per content type: the collection slug, or `single:<slug>` for a Single. */
  types: Readonly<Record<string, StructuredDataTypeRule>>;
}

/** Where structured data reads its rules from, in a language. */
export type ReadStructuredDataRules = (
  ctx: PluginContext,
  locale: string | undefined
) => Promise<StructuredDataRules>;

/** The rules as the plugin's options state them. */
export interface StructuredDataOptions {
  /** The brand facts, until the SEO settings hold them. */
  brand?: StructuredDataBrand;
  /** Each content type's choice and mapping, until the SEO settings hold them. */
  types?: Record<string, StructuredDataTypeRule>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function refuse(message: string): never {
  throw NextlyError.invalidInput({ message: `seoPlugin: ${message}` });
}

/** A detail's source as given, or a refusal naming what is wrong with it. */
function checkedSource(where: string, source: unknown): void {
  if (typeof source === "string" && source.trim() !== "") return;
  if (isRecord(source) && typeof source.value === "string") return;
  refuse(`${where} must name a field, or give { value: "..." }.`);
}

/** One type's mapping as given, or a refusal naming what is wrong in it. */
function checkMapping(where: string, type: string, mapping: unknown): void {
  if (!isStructuredDataTypeKey(type)) refuse(`${where} is not a type offered.`);
  if (!isRecord(mapping)) refuse(`${where} must be an object.`);
  for (const [detail, source] of Object.entries(mapping)) {
    if (!Object.hasOwn(DETAIL_LABELS, detail)) {
      refuse(`${where}.${detail} is not a detail.`);
    }
    checkedSource(`${where}.${detail}`, source);
  }
}

/** One content type's rule as given, or a refusal naming what is wrong. */
function checkRule(where: string, rule: unknown): void {
  if (!isRecord(rule)) refuse(`${where} must be an object.`);
  if (rule.type !== undefined && !isStructuredDataTypeKey(rule.type)) {
    refuse(`${where}.type ${JSON.stringify(rule.type)} is not a type offered.`);
  }
  if (rule.details === undefined) return;
  if (!isRecord(rule.details)) refuse(`${where}.details must be an object.`);
  for (const [type, mapping] of Object.entries(rule.details)) {
    checkMapping(`${where}.details.${type}`, type, mapping);
  }
}

/**
 * The types the plugin's options give, checked when the plugin is created so
 * a misspelled type or detail fails at start rather than describing every
 * page as nothing.
 */
function checkedTypeRules(
  types: unknown
): Record<string, StructuredDataTypeRule> {
  if (types === undefined) return {};
  if (!isRecord(types)) refuse("structuredData.types must be an object.");
  for (const [contentType, rule] of Object.entries(types)) {
    checkRule(`structuredData.types.${contentType}`, rule);
  }
  return types as Record<string, StructuredDataTypeRule>;
}

/**
 * The rules the plugin's own options give: its `baseUrl` as the site's
 * origin, and the brand and content types its `structuredData` names.
 */
export function rulesFromOptions(
  baseUrl: string | undefined,
  options: StructuredDataOptions | undefined
): ReadStructuredDataRules {
  const types = checkedTypeRules(options?.types);
  const rules: StructuredDataRules = {
    ...(baseUrl === undefined ? {} : { origin: baseUrl }),
    brand: options?.brand ?? {},
    types,
  };
  return () => Promise.resolve(rules);
}
