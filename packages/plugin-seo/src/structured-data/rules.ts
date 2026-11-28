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

import type { TitleFields } from "../resolver/own-name";
import { peopleProblem, storedPeopleOf } from "../settings/people-stored";

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
  /**
   * Whether the questions and answers its pages show are an FAQ section of
   * each page, described as a part of it whatever the page's own type. The
   * questions are read as a Questions and answers page reads them, by the
   * mapping under `details.faqPage` where there is one.
   */
  faqSection?: boolean;
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

/** The organisation a person works for, as their entry names it. */
export interface StructuredDataEmployer {
  name: string;
  /** Its home page, absolute. */
  url?: string;
}

/**
 * A person the site names, such as its founder or one of its authors: one
 * entry of the site's People, described as one node wherever the site names
 * them. A team account, such as "Editorial team", is an entry of type
 * `"organization"`.
 */
export interface StructuredDataPerson {
  name: string;
  /**
   * Other names they go by, such as a short form of their name: an author
   * named by one of them is the same person.
   */
  otherNames?: readonly string[];
  /** Their own page, on the site or elsewhere. */
  url?: string;
  /**
   * The identifier their node goes by, an absolute address such as
   * `https://example.com/#person`: the same on every site the person
   * appears on, so each names one person. `<url>#person` (or
   * `#organization`) by default, else one made from their name on this site.
   */
  id?: string;
  /** A person (the default), or a team or company credited as one. */
  type?: "person" | "organization";
  jobTitle?: string;
  description?: string;
  /** A picture of them, from the site's root or absolute. */
  image?: string;
  /** Their official profiles elsewhere. */
  sameAs?: readonly string[];
  /** What they are known for, such as `TypeScript`. */
  knowsAbout?: readonly string[];
  /** The organisation they work for, where it is not the site's own. */
  worksFor?: StructuredDataEmployer;
  /** Whether they founded the organisation that owns the site. */
  founder?: boolean;
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
  /**
   * Who founded it, named as its founders on every page. A founder named
   * like an entry of the site's People is that entry.
   */
  founders?: readonly StructuredDataPerson[];
  /**
   * Who runs the site: an organisation (the default), or a person, whose
   * personal site it is. A person's site is published by that person, named
   * by the brand's name and described by its facts, with no organisation.
   */
  kind?: StructuredDataOwnerKind;
}

/** Who runs a site: an organisation, or one person. */
export type StructuredDataOwnerKind = "organization" | "person";

/**
 * Who an article is credited to where its page names nobody: whoever runs
 * the site (`"organization"`, the person on a person's site), or a person,
 * such as `{ name: "Editorial team" }`, who is the entry of the site's
 * People of that name where there is one.
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
  /**
   * The people (and teams) the site names, each described as one node with
   * one `@id` wherever the site names them: as a founder, the default
   * author, the author or subject of a page matched by their page's address
   * or by name.
   */
  people?: readonly StructuredDataPerson[];
  /** Per content type: the collection slug, or `single:<slug>` for a Single. */
  types: Readonly<Record<string, StructuredDataTypeRule>>;
  /** Who an article is credited to where its page names nobody. */
  defaultAuthor?: StructuredDataDefaultAuthor;
  /** How breadcrumb trails name their steps. */
  breadcrumbs?: StructuredDataBreadcrumbs;
  /**
   * The field each content type's pages are named from, where the site's
   * options choose one (`titleFields`), as the page's head reads it.
   */
  titleFields?: TitleFields;
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
  /**
   * The people (and teams) the site names, each one node with one `@id`
   * on every page that names them. The SEO settings' People, once they hold
   * any, are read instead: the list is one fact.
   */
  people?: readonly StructuredDataPerson[];
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
  if (rule.faqSection !== undefined && typeof rule.faqSection !== "boolean") {
    refuse(`${where}.faqSection must be true or false.`);
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

/** Who an article is credited to, as the options name a person. */
const authorPersonSchema = z.strictObject({
  name: filled,
  url: pageAddress.optional(),
  jobTitle: filled.optional(),
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
  // Checked as People are, by `peopleProblem`, below.
  founders: z.array(z.unknown()).optional(),
  kind: z.enum(["organization", "person"]).optional(),
});

const defaultAuthorSchema = z.union([
  z.literal("organization"),
  authorPersonSchema,
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
 * A list of people the options give, checked by the rule the SEO settings
 * keep theirs to, or a refusal naming the person and the fact.
 */
function checkedPeople(
  where: string,
  people: unknown
): StructuredDataPerson[] | undefined {
  if (people === undefined) return undefined;
  const problem = peopleProblem(people);
  if (problem !== null) refuse(`${where}: ${problem}`);
  return storedPeopleOf(people);
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
  checkedPeople("structuredData.brand.founders", brand.founders);
  const people = checkedPeople("structuredData.people", options?.people);
  return {
    brand,
    ...(people === undefined ? {} : { people }),
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
  options: StructuredDataOptions | undefined,
  titleFields?: TitleFields
): ReadStructuredDataRules {
  const rules: StructuredDataRules = {
    ...(baseUrl === undefined ? {} : { origin: baseUrl }),
    ...checkedOptions(options),
    ...(titleFields === undefined ? {} : { titleFields }),
  };
  return () => Promise.resolve(rules);
}
