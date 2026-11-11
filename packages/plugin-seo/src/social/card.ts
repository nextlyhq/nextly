/**
 * A page's social card, complete: the site's name, the page's language, and
 * its image at an absolute address with its size and alt text.
 *
 * The answer carries the image as the media library stores it, which is
 * often a path from the site's root (`/uploads/cover.jpg`). A network reading
 * the card has no page to resolve that path against, so it is stated on the
 * site's own origin here, before the head is built.
 *
 * @module social/card
 */
import {
  NextlyError,
  type PageMetadataAnswer,
  type PageMetadataImage,
  type PageMetadataInput,
  type PageMetadataResolver,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { originOf } from "../origin";

/** What a social card reads beyond the page and its answer. */
export interface SocialCardRules {
  /**
   * The site's public origin, such as `https://example.com`: a share image
   * stored with a path from the root is stated on it.
   */
  origin?: string;
  /** The site's name, where the answer names none. */
  siteName?: string;
  /**
   * The language of a page read in no particular language, as a language
   * tag such as `en-US`. A page the route read in a language states that one.
   */
  language?: string;
}

/** Where a social card reads its rules from, in a language. */
export type ReadSocialCardRules = (
  ctx: PluginContext,
  locale: string | undefined
) => Promise<SocialCardRules>;

/** No rules: no origin, name or language beyond what the answer has. */
export const noSocialCardRules: ReadSocialCardRules = () => Promise.resolve({});

/** Whether `address` is an absolute http(s) address. */
export function isAbsolute(address: string): boolean {
  return originOf(address) !== undefined;
}

/**
 * `address` stated on `origin` where it is not already absolute; unchanged
 * where it cannot be.
 */
function onOrigin(address: string, origin: string | undefined): string {
  if (isAbsolute(address) || origin === undefined) return address;
  try {
    const url = new URL(address, `${origin}/`);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : address;
  } catch {
    return address;
  }
}

/**
 * A language tag as Open Graph states a page's language: `en-US` as
 * `en_US`, a bare language as itself. Nothing for text that is no language.
 */
export function cardLocale(language: string | undefined): string | undefined {
  if (language === undefined || language.trim() === "") return undefined;
  try {
    const { language: lang, region } = new Intl.Locale(language.trim());
    return region === undefined ? lang : `${lang}_${region}`;
  } catch {
    return undefined;
  }
}

/**
 * The origin a page's card states its image on: the site's, or else the
 * one its canonical names.
 */
export function cardOrigin(
  answer: { canonical?: string },
  rules: Pick<SocialCardRules, "origin">
): string | undefined {
  return originOf(rules.origin) ?? originOf(answer.canonical);
}

const textOf = (value: string | undefined): string | undefined =>
  value !== undefined && value.trim() !== "" ? value.trim() : undefined;

/** `value` without its absent keys. */
function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, inner]) => inner !== undefined)
  ) as T;
}

/**
 * `answer` with its social card complete: the image on the site's origin,
 * the site's name where the answer has none, and the page's language, the
 * one it was read in or else the site's.
 */
export function completeSocialCard(
  answer: PageMetadataAnswer,
  input: Pick<PageMetadataInput, "locale">,
  rules: SocialCardRules
): PageMetadataAnswer {
  const social = answer.social ?? {};
  const image: PageMetadataImage | undefined =
    social.image === undefined
      ? undefined
      : {
          ...social.image,
          url: onOrigin(social.image.url, cardOrigin(answer, rules)),
        };
  const card = defined({
    ...social,
    image,
    siteName: social.siteName ?? textOf(rules.siteName),
    locale:
      social.locale ?? cardLocale(input.locale) ?? cardLocale(rules.language),
  });
  return Object.keys(card).length === 0 ? answer : { ...answer, social: card };
}

/** `resolver` with every page's social card completed. */
export function withSocialCard(
  ctx: PluginContext,
  resolver: PageMetadataResolver,
  readRules: ReadSocialCardRules = noSocialCardRules
): PageMetadataResolver {
  const resolve = async (input: PageMetadataInput) =>
    completeSocialCard(
      await resolver.resolve(input),
      input,
      await readRules(ctx, input.locale)
    );
  // The card reads nothing beyond what the answer read, so its cache tags
  // are the answer's own.
  const tags = resolver.tags;
  return tags === undefined
    ? { resolve }
    : { resolve, tags: input => tags.call(resolver, input) };
}

/** The card's rules the plugin's options name, until the SEO settings do. */
export interface SocialCardOptions {
  /** The site's name, stated on every shared page's card. */
  siteName?: string;
  /**
   * The language of the site's pages, as a language tag such as `en-US`,
   * for a page the route read in no particular language.
   */
  language?: string;
}

/**
 * The card's rules as the plugin's options give them: its `baseUrl` as the
 * site's origin, and the name and language its `socialCard` names. A
 * language that is no language tag is refused when the plugin is created.
 */
export function socialCardRulesFromOptions(
  baseUrl: string | undefined,
  options: SocialCardOptions | undefined
): ReadSocialCardRules {
  const language = options?.language;
  if (language !== undefined && cardLocale(language) === undefined) {
    throw NextlyError.invalidInput({
      message: `seoPlugin: socialCard.language ${JSON.stringify(language)} is not a language tag, such as "en-US".`,
    });
  }
  const rules: SocialCardRules = defined({
    origin: baseUrl,
    siteName: options?.siteName,
    language,
  });
  return () => Promise.resolve(rules);
}
