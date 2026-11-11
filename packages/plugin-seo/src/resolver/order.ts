/**
 * The published order of who wins: each of a page's SEO values, field by
 * field, from the first level that has one.
 *
 * 1. What a person typed for this page.
 * 2. What the route's code supplies: a title, a description and the social
 *    card's values, never visibility or the canonical.
 * 3. The rule of the Page Builder design drawing the page.
 * 4. The content type's pattern, such as `{Title} | {Site name}`.
 * 5. A value taken from the page's own content.
 * 6. The site's defaults.
 *
 * A level with nothing for a value, or only blank text, gives way to the next
 * rather than answering it empty. Every value is reported with the level
 * that supplied it, so the SEO tab can say where an automatic value comes
 * from. Pure: what each level holds is gathered elsewhere.
 *
 * @module resolver/order
 */
import type { PageMetadataImage } from "@nextlyhq/plugin-sdk";

/** A level of the order, as a value's source names it. */
export type SeoLevel =
  | "page"
  | "code"
  | "template"
  | "pattern"
  | "content"
  | "site"
  | "address";

/** A value with the level that supplied it. */
export interface Sourced<T> {
  value: T;
  from: SeoLevel;
  /** The pattern a value was made from, where it came from one. */
  pattern?: string;
  /** The page's own field a value was taken from, where it came from one. */
  field?: string;
}

/** The values a page, its route's code or its design can supply. */
export interface SeoValues {
  title?: string;
  description?: string;
  socialTitle?: string;
  socialDescription?: string;
  image?: PageMetadataImage;
}

/** A pattern's text, already filled in, and the pattern it was made from. */
interface FromPattern {
  value: string;
  pattern: string;
}

/** A value taken from the page's content, and the field it came from. */
interface FromField<T> {
  value: T;
  field: string;
}

/** What each level holds for one page. */
export interface Levels {
  /** What a person typed, with visibility and an Advanced canonical. */
  page: SeoValues & { canonical?: string; hidden?: boolean };
  code: SeoValues;
  template: SeoValues;
  pattern: { title?: FromPattern; description?: FromPattern };
  content: {
    title?: FromField<string>;
    description?: FromField<string>;
    image?: FromField<PageMetadataImage>;
  };
  site: { title?: string; description?: string; image?: PageMetadataImage };
  /** The page's own public address in its language, where it has one. */
  address?: string;
}

/** A page's answer: each value with its source. */
export interface SeoAnswer {
  title?: Sourced<string>;
  description?: Sourced<string>;
  socialTitle?: Sourced<string>;
  socialDescription?: Sourced<string>;
  image?: Sourced<PageMetadataImage>;
  canonical?: Sourced<string>;
  robots: Sourced<{ index: boolean; follow: boolean }>;
}

/** Text with something in it: blank text is no value. */
function text(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

/** An image with an address to load it from. */
function picture(
  value: PageMetadataImage | undefined
): PageMetadataImage | undefined {
  return value !== undefined && text(value.url) !== undefined
    ? value
    : undefined;
}

/** The first candidate with a value, as a sourced value. */
function first<T>(
  candidates: readonly (Sourced<T | undefined> | undefined)[]
): Sourced<T> | undefined {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate.value !== undefined) {
      return candidate as Sourced<T>;
    }
  }
  return undefined;
}

/** A text value at a level, with its pattern or field where it has one. */
function at(
  from: SeoLevel,
  value: string | FromPattern | FromField<string> | undefined
): Sourced<string | undefined> {
  if (value === undefined || typeof value === "string") {
    return { value: text(value), from };
  }
  const detail =
    "pattern" in value ? { pattern: value.pattern } : { field: value.field };
  return { value: text(value.value), from, ...detail };
}

/** Each level's text for one of the page's values, in the order. */
function textValue(
  levels: Levels,
  key: "title" | "description"
): Sourced<string> | undefined {
  return first([
    at("page", levels.page[key]),
    at("code", levels.code[key]),
    at("template", levels.template[key]),
    at("pattern", levels.pattern[key]),
    at("content", levels.content[key]),
    at("site", levels.site[key]),
  ]);
}

/**
 * The social card's own text: set at a level that speaks for the card (a
 * person, code or the design), or else the page's own, with its source.
 */
function socialValue(
  levels: Levels,
  key: "socialTitle" | "socialDescription",
  page: Sourced<string> | undefined
): Sourced<string> | undefined {
  return (
    first([
      at("page", levels.page[key]),
      at("code", levels.code[key]),
      at("template", levels.template[key]),
    ]) ?? page
  );
}

/** The order applied to every value of one page. */
export function resolveOrder(levels: Levels): SeoAnswer {
  const title = textValue(levels, "title");
  const description = textValue(levels, "description");
  const socialTitle = socialValue(levels, "socialTitle", title);
  const socialDescription = socialValue(
    levels,
    "socialDescription",
    description
  );
  const contentImage = levels.content.image;
  const image = first<PageMetadataImage>([
    { value: picture(levels.page.image), from: "page" },
    { value: picture(levels.code.image), from: "code" },
    { value: picture(levels.template.image), from: "template" },
    contentImage === undefined
      ? undefined
      : {
          value: picture(contentImage.value),
          from: "content",
          field: contentImage.field,
        },
    { value: picture(levels.site.image), from: "site" },
  ]);
  // Visibility and the canonical are never code's to decide: a person's
  // choice, else listed and the page's own declared address. A page with no
  // declared address has no canonical rather than a guessed one.
  const canonical = first<string>([
    { value: text(levels.page.canonical), from: "page" },
    { value: text(levels.address), from: "address" },
  ]);
  const robots: Sourced<{ index: boolean; follow: boolean }> =
    levels.page.hidden === true
      ? { value: { index: false, follow: true }, from: "page" }
      : { value: { index: true, follow: true }, from: "site" };
  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(socialTitle === undefined ? {} : { socialTitle }),
    ...(socialDescription === undefined ? {} : { socialDescription }),
    ...(image === undefined ? {} : { image }),
    ...(canonical === undefined ? {} : { canonical }),
    robots,
  };
}
