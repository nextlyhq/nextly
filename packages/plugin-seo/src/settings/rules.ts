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
  languageAddressOf,
  type PageMetadataImage,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { productionAddressesOf } from "../canonical";
import { isRecord, textOf } from "../plain-values";
import { imageOf } from "../resolver/page-levels";
import type { StructuredDataTypeRule } from "../structured-data/rules";

import {
  AI_CRAWLER_CHOICES,
  SEO_PLUGIN_NAME,
  SEO_SETTINGS_SLUG,
  SITE_KINDS,
  type AiCrawlerChoice,
  type SiteKind,
} from "./contract";
import { defaultTitlePattern, SEPARATORS, type Separator } from "./patterns";
import { productionAddressesProblem } from "./production-addresses";
import {
  hiddenTypesProblem,
  patternsProblem,
  socialProfilesProblem,
} from "./stored-values";
import { structuredDataSettingsProblem } from "./structured-data-choices";

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
  /** What AI tools are asked to do with the site's pages, once chosen. */
  aiCrawlers?: AiCrawlerChoice;
  /**
   * The content types hidden from search as a whole, keyed as `patterns`
   * are, once the settings name any.
   */
  hiddenTypes?: string[];
  /** Whether IndexNow is told of changed pages: only once switched on. */
  indexNow?: boolean;
  /** Whether `/llms.txt` is served: only once switched on. */
  llmsTxt?: boolean;
  /** Whether each listed page has a plain-text copy: only once switched on. */
  plainTextCopies?: boolean;
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
type SeoSettingsDocument = Readonly<Record<string, unknown>>;

/** `{ [key]: value }` where the value is set, and nothing where it is not. */
const withDefined = <K extends string, V>(
  key: K,
  value: V | undefined
): Partial<Record<K, V>> =>
  value === undefined ? {} : ({ [key]: value } as Partial<Record<K, V>>);

/** A stored text value, trimmed, where it is not blank. */
const trimmed = (value: unknown): string | undefined => textOf(value)?.trim();

const oneOf = <T extends string>(
  values: readonly T[],
  value: unknown
): T | undefined =>
  (values as readonly unknown[]).includes(value) ? (value as T) : undefined;

/** The separator the site chose, or the default. */
function separatorOf(document: SeoSettingsDocument): Separator {
  return oneOf(SEPARATORS, document.separator) ?? "|";
}

/** What AI tools are asked to do, where the site has chosen. */
function aiCrawlersOf(
  document: SeoSettingsDocument
): AiCrawlerChoice | undefined {
  return oneOf(AI_CRAWLER_CHOICES, document.aiCrawlers);
}

/** The content types hidden from search as a whole, where the settings name any. */
function hiddenTypesOf(document: SeoSettingsDocument): string[] | undefined {
  return checked<string[]>(document.hiddenTypes, hiddenTypesProblem);
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
    const title = trimmed(parts.title);
    const description = trimmed(parts.description);
    if (title === undefined && description === undefined) continue;
    patterns[type] = {
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
    };
  }
  return patterns;
}

/** Finds the share image a stored media value names. */
type ImageOf = (value: unknown) => Promise<PageMetadataImage | undefined>;

/** The rules a stored settings document gives. */
async function rulesOf(
  document: SeoSettingsDocument,
  imageOf: ImageOf
): Promise<SeoRules> {
  const siteName = trimmed(document.siteName);
  const description = trimmed(document.description);
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
    ...withDefined("aiCrawlers", aiCrawlersOf(document)),
    ...withDefined("hiddenTypes", hiddenTypesOf(document)),
    // Off unless stored as switched on: a value that is not `true` is off.
    ...withDefined("indexNow", document.indexNow === true ? true : undefined),
    ...withDefined("llmsTxt", document.llmsTxt === true ? true : undefined),
    ...withDefined(
      "plainTextCopies",
      document.plainTextCopies === true ? true : undefined
    ),
    patterns: patternsOf(document),
  };
}

/** The brand facts a stored settings document gives. */
async function brandOf(
  document: SeoSettingsDocument,
  imageOf: ImageOf
): Promise<BrandFacts> {
  const name = trimmed(document.brandName);
  const logo = await imageOf(document.logo);
  const siteKind = oneOf(SITE_KINDS, document.siteKind);
  const otherNames = (trimmed(document.brandOtherNames) ?? "")
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

/** Images read as the resolver reads a page's: from the media library. */
const mediaImages =
  (ctx: PluginContext): ImageOf =>
  value =>
    imageOf(ctx, value);

/**
 * The settings Single's name as the host registered it, recorded when the
 * SEO plugin starts. Another plugin's context lists only its own Singles, so
 * a reader called from one could not resolve a host's rename by itself.
 */
let registeredSettingsSingle: string | undefined;

/** Records the settings Single's registered name from the SEO plugin's context. */
export function rememberSettingsSingle(ctx: Pick<PluginContext, "self">): void {
  registeredSettingsSingle =
    ctx.self.singles[SEO_SETTINGS_SLUG] ?? SEO_SETTINGS_SLUG;
}

/** The settings Single's registered name, for a read from any plugin's context. */
function settingsSingleFor(ctx: Pick<PluginContext, "self">): string {
  if (ctx.self.name === SEO_PLUGIN_NAME) {
    return ctx.self.singles[SEO_SETTINGS_SLUG] ?? SEO_SETTINGS_SLUG;
  }
  return registeredSettingsSingle ?? SEO_SETTINGS_SLUG;
}

/**
 * The stored SEO settings in `locale`, as the system: the published values,
 * since they decide what the live site serves. Empty before anyone saves.
 */
async function readSeoSettingsDocument(
  ctx: Pick<PluginContext, "self">,
  locale?: string
): Promise<SeoSettingsDocument> {
  const nextly = await getCachedNextly();
  const document: unknown = await nextly.findSingle({
    slug: settingsSingleFor(ctx),
    overrideAccess: true,
    depth: 0,
    ...(locale === undefined ? {} : { locale }),
  });
  return isRecord(document) ? document : {};
}

/**
 * The site's SEO rules in `locale`: its name, default description and share
 * image, production addresses, and each content type's patterns.
 *
 * Read while handling a request or a job, never awaited in a plugin's `init`
 * or `onReady`: the read waits for the site's start to finish.
 */
export async function readSeoRules(
  ctx: PluginContext,
  locale?: string
): Promise<SeoRules> {
  return rulesOf(await readSeoSettingsDocument(ctx, locale), mediaImages(ctx));
}

/**
 * The site's brand facts in `locale`, for structured data and the like. Like
 * {@link readSeoRules}, never awaited while the site starts.
 */
export async function readBrandFacts(
  ctx: PluginContext,
  locale?: string
): Promise<BrandFacts> {
  return brandOf(await readSeoSettingsDocument(ctx, locale), mediaImages(ctx));
}

/** What the SEO settings hold for structured data. */
export interface StructuredDataSettings {
  /** The production address the language is served from. */
  origin?: string;
  siteName?: string;
  /** The site's default description, which says what the site is. */
  description?: string;
  brand: Omit<BrandFacts, "siteKind">;
  /** Per content type: the collection slug, or `single:<slug>` for a Single. */
  types: Readonly<Record<string, StructuredDataTypeRule>>;
}

/**
 * The production address `locale` is served from: where the site gives a
 * language its own domain and that domain is one of the addresses, that one;
 * else the first, the site's main address.
 */
async function originIn(
  addresses: readonly string[],
  locale: string | undefined
): Promise<string | undefined> {
  if (addresses.length > 1 && locale !== undefined) {
    const home = await languageAddressOf("/", locale);
    if (
      home.status === "resolved" &&
      home.origin !== undefined &&
      addresses.includes(home.origin)
    ) {
      return home.origin;
    }
  }
  return addresses[0];
}

/** The site's own name and address, as every output names the site. */
export interface SiteIdentity {
  /** The production address the language is served from. */
  origin?: string;
  siteName?: string;
}

/** The site's name and the production address `locale` is served from. */
async function identityOf(
  document: SeoSettingsDocument,
  locale: string | undefined
): Promise<SiteIdentity> {
  const origin = await originIn(
    productionAddressesOf(
      checked<string[]>(
        document.productionAddresses,
        productionAddressesProblem
      )
    ),
    locale
  );
  const siteName = trimmed(document.siteName);
  return {
    ...(origin === undefined ? {} : { origin }),
    ...(siteName === undefined ? {} : { siteName }),
  };
}

/**
 * The site's name and the production address `locale` is served from (the
 * environment's addresses winning, as for every output), with no media read:
 * what a page's social card names the site by. Never awaited while the site
 * starts.
 */
export async function readSiteIdentity(
  ctx: PluginContext,
  locale?: string
): Promise<SiteIdentity> {
  return identityOf(await readSeoSettingsDocument(ctx, locale), locale);
}

/**
 * What the SEO settings hold for structured data in `locale`, from one read:
 * the production address the language is served from (the environment's
 * addresses winning, as for every output), the site's name, the brand facts with the
 * logo read from the media library, and each content type's choices.
 */
export async function readStructuredDataSettings(
  ctx: PluginContext,
  locale?: string
): Promise<StructuredDataSettings> {
  const document = await readSeoSettingsDocument(ctx, locale);
  const { siteKind: _kind, ...brand } = await brandOf(
    document,
    mediaImages(ctx)
  );
  const description = trimmed(document.description);
  return {
    ...(await identityOf(document, locale)),
    ...(description === undefined ? {} : { description }),
    brand,
    types:
      checked<Record<string, StructuredDataTypeRule>>(
        document.structuredData,
        structuredDataSettingsProblem
      ) ?? {},
  };
}
