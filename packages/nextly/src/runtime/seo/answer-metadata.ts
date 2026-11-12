/**
 * A page's answer as Next.js `Metadata`: the one mapping from the values the
 * head is built from to where Next.js places each of them.
 *
 * A leaf: `buildMetadata` and the page-metadata provider's answer both build
 * through it, so a value lands in the same place in the head either way, and
 * neither drags the other's imports along. The `next` import is type-only.
 *
 * @module runtime/seo/answer-metadata
 */
import type { Metadata } from "next";

import type {
  PageMetadataAnswer,
  PageMetadataImage,
} from "./page-metadata-contract";

type OpenGraph = NonNullable<Metadata["openGraph"]>;
type Twitter = NonNullable<Metadata["twitter"]>;

/** True for a plain, indexable object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** `value` without the keys whose value is `undefined`. */
export function defined<T extends Record<string, unknown>>(
  value: T
): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, inner]) => inner !== undefined)
  ) as Partial<T>;
}

/** The canonical and the language addresses, or undefined for neither. */
function alternatesOf(
  answer: PageMetadataAnswer
): Metadata["alternates"] | undefined {
  const languages = answer.languages;
  const hasLanguages =
    languages !== undefined && Object.keys(languages).length > 0;
  if (answer.canonical === undefined && !hasLanguages) return undefined;
  return {
    ...(answer.canonical === undefined ? {} : { canonical: answer.canonical }),
    ...(hasLanguages ? { languages } : {}),
  };
}

/**
 * The social card's title and description: its own where the answer gives
 * them, else the page's, since a crawler reading the card would otherwise see
 * none.
 */
function cardTextOf(answer: PageMetadataAnswer): {
  title?: string;
  description?: string;
} {
  return {
    title: answer.social?.title ?? answer.title,
    description: answer.social?.description ?? answer.description,
  };
}

/** The Open Graph card, or undefined when the answer states none of it. */
function openGraphOf(answer: PageMetadataAnswer): OpenGraph | undefined {
  const social = answer.social ?? {};
  const image = social.image;
  const openGraph: OpenGraph = defined({
    ...cardTextOf(answer),
    url: answer.canonical,
    images:
      image === undefined
        ? undefined
        : [
            defined({
              url: image.url,
              width: image.width,
              height: image.height,
              alt: image.alt,
            }) as { url: string },
          ],
    siteName: social.siteName,
    locale: social.locale,
    type: social.type,
  });
  return Object.keys(openGraph).length > 0 ? openGraph : undefined;
}

/** A card image as the Twitter card names it: with its alt text, if any. */
function twitterImageOf(
  image: PageMetadataImage
): string | { url: string; alt: string } {
  return image.alt === undefined
    ? image.url
    : { url: image.url, alt: image.alt };
}

/**
 * The Twitter card, or undefined when the answer states none of it: a
 * large-image card whenever there is an image to show on it, with the
 * image's alt text where it has one, since that card reads its own.
 */
function twitterOf(answer: PageMetadataAnswer): Twitter | undefined {
  const image = answer.social?.image;
  const twitter: Twitter = defined({
    card: image === undefined ? undefined : "summary_large_image",
    ...cardTextOf(answer),
    images: image === undefined ? undefined : [twitterImageOf(image)],
  });
  return Object.keys(twitter).length > 0 ? twitter : undefined;
}

/**
 * Next.js `Metadata` for a page's answer: every value in its place in the head,
 * and nothing the answer does not state.
 *
 * `buildMetadata` builds its result through this too, so the two cannot place
 * a value differently.
 */
export function metadataFromAnswer(answer: PageMetadataAnswer): Metadata {
  return defined({
    title: answer.title,
    description: answer.description,
    alternates: alternatesOf(answer),
    robots:
      answer.robots === undefined
        ? undefined
        : { index: answer.robots.index, follow: answer.robots.follow },
    openGraph: openGraphOf(answer),
    twitter: twitterOf(answer),
  });
}
