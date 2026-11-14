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
import { z } from "zod";

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

/** A way to reach the brand, such as its support desk. */
export interface StructuredDataContactPoint {
  /** What it is for, such as `customer support` or `sales`. */
  contactType: string;
  email?: string;
  telephone?: string;
  url?: string;
  /** Languages it answers in, as language tags or names. */
  availableLanguage?: readonly string[];
}

/** A person the brand names, such as its founder. */
export interface StructuredDataPerson {
  name: string;
  /** Their own page, on the site or elsewhere. */
  url?: string;
  jobTitle?: string;
  description?: string;
  /** A picture of them, from the site's root or absolute. */
  image?: string;
  /** Their official profiles elsewhere. */
  sameAs?: readonly string[];
  /** What they are known for, such as `TypeScript`. */
  knowsAbout?: readonly string[];
}

/** The organisation that owns the brand, where it is another one. */
export interface StructuredDataParentOrganization {
  name: string;
  url?: string;
  description?: string;
  /** When it was founded, as ISO 8601 (`2020`, `2020-03-01`). */
  foundingDate?: string;
  sameAs?: readonly string[];
}

/** The facts about who owns the site that every page's data names. */
export interface StructuredDataBrand {
  name?: string;
  /** Other names people search for the brand by. */
  otherNames?: readonly string[];
  logo?: PageMetadataImage;
  /** The brand's official accounts elsewhere. */
  profiles?: readonly { url: string }[];
  /**
   * What the brand is, in a sentence or two. The site's default
   * description, from the SEO settings, where this is not given.
   */
  description?: string;
  email?: string;
  telephone?: string;
  contactPoints?: readonly StructuredDataContactPoint[];
  /** When it was founded, as ISO 8601 (`2020`, `2020-03-01`). */
  foundingDate?: string;
  parentOrganization?: StructuredDataParentOrganization;
  /** Who founded it: described on the site's About page. */
  founders?: readonly StructuredDataPerson[];
}

/**
 * Who an article is credited to where its page names nobody: the brand
 * itself (`"organization"`), or a person, such as `{ name: "Editorial team" }`.
 */
export type StructuredDataDefaultAuthor =
  | "organization"
  | Pick<StructuredDataPerson, "name" | "url" | "jobTitle">;

/** How a page's breadcrumb trail names its steps. */
export interface StructuredDataBreadcrumbs {
  /** The first step, the site's home page: `"Home"` unless given. */
  home?: string;
  /**
   * A name for the step at an address, from the site's root, such as
   * `{ "/blog": "Blog" }`, over the title of the page that holds it.
   */
  names?: Readonly<Record<string, string>>;
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
  /** Who an article is credited to where its page names nobody. */
  defaultAuthor?: StructuredDataDefaultAuthor;
  /** How breadcrumb trails name their steps. */
  breadcrumbs?: StructuredDataBreadcrumbs;
}

/** Where structured data reads its rules from, in a language. */
export type ReadStructuredDataRules = (
  ctx: PluginContext,
  locale: string | undefined
) => Promise<StructuredDataRules>;

/** The rules as the plugin's options state them. */
export interface StructuredDataOptions {
  /**
   * The brand facts. Each fact saved in the SEO settings (Organization) wins
   * over the same fact here, one fact at a time: a list, such as the
   * profiles or the contact points, is one fact. Every fact the settings
   * leave empty, and the founders, which only these options give, are read
   * from here.
   */
  brand?: StructuredDataBrand;
  /** Each content type's choice and mapping, until the SEO settings hold them. */
  types?: Record<string, StructuredDataTypeRule>;
  /**
   * Who an article is credited to where its page names nobody: the brand
   * (`"organization"`) or a person. Without it such an article is left out,
   * and the page lists the missing author.
   */
  defaultAuthor?: StructuredDataDefaultAuthor;
  /** How breadcrumb trails name their steps. */
  breadcrumbs?: StructuredDataBreadcrumbs;
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
export function checkedTypeRules(
  types: unknown
): Record<string, StructuredDataTypeRule> {
  if (types === undefined) return {};
  if (!isRecord(types)) refuse("structuredData.types must be an object.");
  for (const [contentType, rule] of Object.entries(types)) {
    checkRule(`structuredData.types.${contentType}`, rule);
  }
  return types as Record<string, StructuredDataTypeRule>;
}

/** Text with something in it. */
const filled = z.string().trim().min(1);
/** An absolute http(s) address. */
const webAddress = z.url({ protocol: /^https?$/ });
/** A date as ISO 8601: a year, a month or a day, with or without a time. */
const isoDate = z
  .string()
  .regex(/^\d{4}(-\d{2}(-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?)?)?$/, {
    message: "must be a date such as 2020 or 2020-03-01",
  });
/** An address from the site's root, or an absolute one. */
const pageAddress = z.union([webAddress, z.string().regex(/^\/(?!\/)/)]);

const personSchema = z.strictObject({
  name: filled,
  url: pageAddress.optional(),
  jobTitle: filled.optional(),
  description: filled.optional(),
  image: pageAddress.optional(),
  sameAs: z.array(webAddress).optional(),
  knowsAbout: z.array(filled).optional(),
});

/**
 * The facts this module adds to the brand, checked when the plugin is
 * created. The name, other names, logo and profiles are the SEO settings'
 * facts too, and read as they always were.
 */
const brandExtrasSchema = z.object({
  description: filled.optional(),
  email: z.email().optional(),
  telephone: filled.optional(),
  contactPoints: z
    .array(
      z.strictObject({
        contactType: filled,
        email: z.email().optional(),
        telephone: filled.optional(),
        url: webAddress.optional(),
        availableLanguage: z.array(filled).optional(),
      })
    )
    .optional(),
  foundingDate: isoDate.optional(),
  parentOrganization: z
    .strictObject({
      name: filled,
      url: webAddress.optional(),
      description: filled.optional(),
      foundingDate: isoDate.optional(),
      sameAs: z.array(webAddress).optional(),
    })
    .optional(),
  founders: z.array(personSchema).optional(),
});

const defaultAuthorSchema = z.union([
  z.literal("organization"),
  personSchema.pick({ name: true, url: true, jobTitle: true }),
]);

const breadcrumbsSchema = z.strictObject({
  home: filled.optional(),
  names: z.record(z.string().regex(/^\/(?!\/)/), filled).optional(),
});

/** `value` as `schema` reads it, or a refusal naming where it is wrong. */
function checkedWith<T>(
  where: string,
  schema: z.ZodType<T>,
  value: unknown
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const [issue] = result.error.issues;
  const at = issue?.path.map(String).join(".") ?? "";
  refuse(
    `${where}${at === "" ? "" : `.${at}`} ${issue?.message ?? "is not valid"}.`
  );
}

/**
 * The structured data options as given, checked when the plugin is created
 * so a mistyped fact fails at start rather than writing markup Google
 * rejects.
 */
function checkedOptions(
  options: StructuredDataOptions | undefined
): Omit<StructuredDataRules, "origin"> {
  const brand = options?.brand ?? {};
  checkedWith("structuredData.brand", brandExtrasSchema, brand);
  return {
    brand,
    types: checkedTypeRules(options?.types),
    ...(options?.defaultAuthor === undefined
      ? {}
      : {
          defaultAuthor: checkedWith(
            "structuredData.defaultAuthor",
            defaultAuthorSchema,
            options.defaultAuthor
          ),
        }),
    ...(options?.breadcrumbs === undefined
      ? {}
      : {
          breadcrumbs: checkedWith(
            "structuredData.breadcrumbs",
            breadcrumbsSchema,
            options.breadcrumbs
          ),
        }),
  };
}

/**
 * The rules the plugin's own options give: its `baseUrl` as the site's
 * origin, and the brand, content types, default author and breadcrumb
 * names its `structuredData` names.
 */
export function rulesFromOptions(
  baseUrl: string | undefined,
  options: StructuredDataOptions | undefined
): ReadStructuredDataRules {
  const rules: StructuredDataRules = {
    ...(baseUrl === undefined ? {} : { origin: baseUrl }),
    ...checkedOptions(options),
  };
  return () => Promise.resolve(rules);
}
