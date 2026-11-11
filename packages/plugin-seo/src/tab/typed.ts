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
const TYPED_SEO_FIELDS = [
  "metaTitle",
  "metaDescription",
  "socialTitle",
  "socialDescription",
  "ogImage",
  "canonical",
  "canonicalElsewhere",
  "noindex",
] as const;

/** A group's values, or none where the group is not an object. */
function groupOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Each typed text field, and the value of the page level it sets. */
const TEXT_VALUES = [
  ["metaTitle", "title"],
  ["metaDescription", "description"],
  ["socialTitle", "socialTitle"],
  ["socialDescription", "socialDescription"],
  ["canonical", "canonical"],
] as const;

/**
 * The page level from the `seo` group's values. `image` is the chosen share
 * image, looked up by the caller, since a stored image is an id. Blank text
 * is nothing typed.
 */
export function typedPageLevel(
  seo: unknown,
  image?: PageMetadataImage
): Levels["page"] {
  const typed = groupOf(seo);
  const level: Levels["page"] = {};
  for (const [field, value] of TEXT_VALUES) {
    const text = typed[field];
    if (typeof text === "string" && text.trim() !== "") level[value] = text;
  }
  if (image !== undefined && image.url.trim() !== "") level.image = image;
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
  if (typeof seo !== "object" || seo === null || Array.isArray(seo)) {
    return { ...document };
  }
  const kept = Object.fromEntries(
    Object.entries(groupOf(seo)).filter(
      ([name]) => !(TYPED_SEO_FIELDS as readonly string[]).includes(name)
    )
  );
  return { ...document, [SEO_GROUP]: kept };
}
