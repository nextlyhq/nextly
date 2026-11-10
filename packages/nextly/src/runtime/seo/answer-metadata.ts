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

import type { PageMetadataAnswer } from "./page-metadata-contract";

export type OpenGraph = NonNullable<Metadata["openGraph"]>;
export type Twitter = NonNullable<Metadata["twitter"]>;

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

/**
 * Next.js `Metadata` for a page's answer: every value in its place in the head,
 * and nothing the answer does not state.
 *
 * The social card falls back to the page's own title and description, as a
 * crawler reading the card would otherwise see none. `buildMetadata` builds its
 * result through this too, so the two cannot place a value differently.
 */
export function metadataFromAnswer(answer: PageMetadataAnswer): Metadata {
  const metadata: Metadata = {};
  if (answer.title !== undefined) metadata.title = answer.title;
  if (answer.description !== undefined) {
    metadata.description = answer.description;
  }

  const languages = answer.languages;
  const hasLanguages =
    languages !== undefined && Object.keys(languages).length > 0;
  if (answer.canonical !== undefined || hasLanguages) {
    metadata.alternates = {
      ...(answer.canonical !== undefined
        ? { canonical: answer.canonical }
        : {}),
      ...(hasLanguages ? { languages } : {}),
    };
  }

  if (answer.robots !== undefined) {
    metadata.robots = {
      index: answer.robots.index,
      follow: answer.robots.follow,
    };
  }

  const social = answer.social ?? {};
  const cardTitle = social.title ?? answer.title;
  const cardDescription = social.description ?? answer.description;
  const image = social.image;

  const openGraph: OpenGraph = defined({
    title: cardTitle,
    description: cardDescription,
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
  if (Object.keys(openGraph).length > 0) metadata.openGraph = openGraph;

  // A large-image card whenever there is an image to show on it.
  const twitter: Twitter = defined({
    card: image === undefined ? undefined : "summary_large_image",
    title: cardTitle,
    description: cardDescription,
    images: image === undefined ? undefined : [image.url],
  });
  if (Object.keys(twitter).length > 0) metadata.twitter = twitter;

  return metadata;
}
