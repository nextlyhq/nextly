/**
 * The site's SEO rules and brand facts, read from the SEO settings Single:
 * what the resolver fills a page's head from where the page and its type set
 * nothing, and what every output describing the site reads.
 *
 * Each reader makes one read of the Single, plus a lookup of each image it
 * names, and carries {@link seoSettingsCacheTags}, which every write to the
 * Single expires.
 *
 * @module settings/rules
 */
import {
  getCachedNextly,
  type PageMetadataImage,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { imageOf } from "../resolver/page-levels";

import {
  AI_CRAWLER_CHOICES,
  SEO_SETTINGS_SLUG,
  SITE_KINDS,
  type AiCrawlerChoice,
  type SiteKind,
} from "./contract";
import { defaultTitlePattern, SEPARATORS, type Separator } from "./patterns";
import { productionAddressesProblem } from "./production-addresses";
import { patternsProblem, socialProfilesProblem } from "./stored-values";

/** A content type's patterns: the title's, and the description's. */
export interface TypePatterns {
  title?: string;
  description?: string;
}

/** The site-wide rules the resolver reads. */
export interface SeoRules {
  siteName?: string;
  /** The site's default description. */
  description?: string;
  /** The site's default share image, resolved to a URL. */
  image?: PageMetadataImage;
  /**
   * The origins the site is served from in production, one or several where
   * a language has its own domain. Empty while none is known.
   */
  productionAddresses: string[];
  /**
   * The patterns a content type uses where it has none of its own: the title
   * and the site's name, with the separator the site chose.
   */
  defaultPatterns: TypePatterns;
  /** Per content type: the collection slug, or `single:<slug>` for a Single. */
  patterns: Record<string, TypePatterns>;
}

/** One of the brand's official accounts. */
export interface SocialProfile {
  network: string;
  url: string;
}

/** The one record of facts about the site's owner, for every output. */
export interface BrandFacts {
  name?: string;
  /** Other names people search for the brand by. */
  otherNames: string[];
  logo?: PageMetadataImage;
  profiles: SocialProfile[];
  /** What kind of site it is, which decides what Google is told about it. */
  siteKind?: SiteKind;
}

/** The SEO settings as stored, as far as the readers below take them. */
export type SeoSettingsDocument = Readonly<Record<string, unknown>>;

const textOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const oneOf = <T extends string>(
  values: readonly T[],
  value: unknown
): T | undefined =>
  (values as readonly unknown[]).includes(value) ? (value as T) : undefined;

/** The separator the site chose, or the default. */
export function separatorOf(document: SeoSettingsDocument): Separator {
  return oneOf(SEPARATORS, document.separator) ?? "|";
}

/** What AI tools are asked to do: all are allowed until the site says otherwise. */
export function aiCrawlersOf(document: SeoSettingsDocument): AiCrawlerChoice {
  return oneOf(AI_CRAWLER_CHOICES, document.aiCrawlers) ?? "all";
}

/**
 * A stored value read only where it passes the rule it was saved under. A
 * value written before a rule existed, or past the Single's validation, is
 * read as absent rather than half-trusted.
 */
function checked<T>(
  value: unknown,
  problem: (value: unknown) => string | null
): T | undefined {
  return value !== null && value !== undefined && problem(value) === null
    ? (value as T)
    : undefined;
}

/** Each content type's patterns, without blank ones. */
function patternsOf(
  document: SeoSettingsDocument
): Record<string, TypePatterns> {
  const stored =
    checked<Record<string, Record<string, string>>>(
      document.patterns,
      patternsProblem
    ) ?? {};
  const patterns: Record<string, TypePatterns> = {};
  for (const [type, parts] of Object.entries(stored)) {
    const title = textOf(parts.title);
    const description = textOf(parts.description);
    if (title === undefined && description === undefined) continue;
    patterns[type] = {
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
    };
  }
  return patterns;
}

/** Finds the share image a stored media value names. */
export type ImageOf = (
  value: unknown
) => Promise<PageMetadataImage | undefined>;

/** The rules a stored settings document gives. */
export async function rulesOf(
  document: SeoSettingsDocument,
  imageOf: ImageOf
): Promise<SeoRules> {
  const siteName = textOf(document.siteName);
  const description = textOf(document.description);
  const image = await imageOf(document.image);
  return {
    ...(siteName === undefined ? {} : { siteName }),
    ...(description === undefined ? {} : { description }),
    ...(image === undefined ? {} : { image }),
    productionAddresses:
      checked<string[]>(
        document.productionAddresses,
        productionAddressesProblem
      ) ?? [],
    defaultPatterns: { title: defaultTitlePattern(separatorOf(document)) },
    patterns: patternsOf(document),
  };
}

/** The brand facts a stored settings document gives. */
export async function brandOf(
  document: SeoSettingsDocument,
  imageOf: ImageOf
): Promise<BrandFacts> {
  const name = textOf(document.brandName);
  const logo = await imageOf(document.logo);
  const siteKind = oneOf(SITE_KINDS, document.siteKind);
  const otherNames = (textOf(document.brandOtherNames) ?? "")
    .split(",")
    .map(other => other.trim())
    .filter(other => other !== "");
  return {
    ...(name === undefined ? {} : { name }),
    otherNames,
    ...(logo === undefined ? {} : { logo }),
    profiles:
      checked<SocialProfile[]>(
        document.socialProfiles,
        socialProfilesProblem
      )?.filter(profile => profile.url.trim() !== "") ?? [],
    ...(siteKind === undefined ? {} : { siteKind }),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Images read as the resolver reads a page's: from the media library. */
const mediaImages =
  (ctx: PluginContext): ImageOf =>
  value =>
    imageOf(ctx, value);

/**
 * The stored SEO settings in `locale`, as the system: the published values,
 * since they decide what the live site serves. Empty before anyone saves.
 */
export async function readSeoSettingsDocument(
  ctx: Pick<PluginContext, "self">,
  locale?: string
): Promise<SeoSettingsDocument> {
  const nextly = await getCachedNextly();
  const document: unknown = await nextly.findSingle({
    // The Single as the host named it, where it renamed it.
    slug: ctx.self.singles[SEO_SETTINGS_SLUG] ?? SEO_SETTINGS_SLUG,
    overrideAccess: true,
    depth: 0,
    ...(locale === undefined ? {} : { locale }),
  });
  return isRecord(document) ? document : {};
}

/**
 * The site's SEO rules in `locale`: its name, default description and share
 * image, production addresses, and each content type's patterns.
 */
export async function readSeoRules(
  ctx: PluginContext,
  locale?: string
): Promise<SeoRules> {
  return rulesOf(await readSeoSettingsDocument(ctx, locale), mediaImages(ctx));
}

/** The site's brand facts in `locale`, for structured data and the like. */
export async function readBrandFacts(
  ctx: PluginContext,
  locale?: string
): Promise<BrandFacts> {
  return brandOf(await readSeoSettingsDocument(ctx, locale), mediaImages(ctx));
}
