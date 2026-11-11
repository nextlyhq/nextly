/**
 * What a person typed in a page's `seo` group, as the order of who wins reads
 * it: the page level.
 *
 * The SEO tab asks the server for every other level once, then works out the
 * page's answer itself with the same `resolveOrder` the page's head uses,
 * with this level on top, so its preview follows each keystroke without
 * waiting for a request and can never show a value the page would not serve.
 * The server's own reading of the group is `pageLevel` in
 * `resolver/page-levels`; an integration test holds the two to one answer.
 *
 * Pure and free of Node, so the admin bundle can import it.
 *
 * @module tab/typed
 */
import type { PageMetadataImage } from "@nextlyhq/plugin-sdk";

import type { Levels } from "../resolver/order";

/** The group the plugin adds to each content type. */
export const SEO_GROUP = "seo";

/** The `seo` group's values a person types, which make the page level. */
export const TYPED_SEO_FIELDS = [
  "metaTitle",
  "metaDescription",
  "socialTitle",
  "socialDescription",
  "ogImage",
  "canonical",
  "noindex",
] as const;

/** One of the values a person types in the `seo` group. */
export type TypedSeoField = (typeof TYPED_SEO_FIELDS)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Text with something in it: blank text is nothing typed. */
const textOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/**
 * The page level from the `seo` group's values. `image` is the chosen share
 * image, looked up by the caller, since a stored image is an id.
 */
export function typedPageLevel(
  seo: unknown,
  image?: PageMetadataImage
): Levels["page"] {
  const typed = isRecord(seo) ? seo : {};
  const level: Levels["page"] = {};
  const title = textOf(typed.metaTitle);
  const description = textOf(typed.metaDescription);
  const socialTitle = textOf(typed.socialTitle);
  const socialDescription = textOf(typed.socialDescription);
  const canonical = textOf(typed.canonical);
  if (title !== undefined) level.title = title;
  if (description !== undefined) level.description = description;
  if (socialTitle !== undefined) level.socialTitle = socialTitle;
  if (socialDescription !== undefined) {
    level.socialDescription = socialDescription;
  }
  if (image !== undefined && textOf(image.url) !== undefined) {
    level.image = image;
  }
  if (canonical !== undefined) level.canonical = canonical;
  if (typed.noindex === true) level.hidden = true;
  return level;
}

/**
 * The document with the person's typed values taken out of its `seo` group,
 * so it resolves to what would be used automatically. Every other value,
 * the group's own extra fields included, is kept.
 */
export function withoutTyped(
  document: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const seo = document[SEO_GROUP];
  if (!isRecord(seo)) return { ...document };
  const kept = Object.fromEntries(
    Object.entries(seo).filter(
      ([name]) => !(TYPED_SEO_FIELDS as readonly string[]).includes(name)
    )
  );
  return { ...document, [SEO_GROUP]: kept };
}
