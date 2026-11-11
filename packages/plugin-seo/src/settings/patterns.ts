/**
 * Title patterns: how a content type's page titles are made when a page has
 * none typed, such as "{Title} | {Site name}".
 *
 * A pattern is stored as the text a person typed. Each variable in braces is
 * `{Title}`, `{Site name}` or one of the type's own fields, matched to the
 * page's field by its name with case, spaces and punctuation ignored, so
 * `{Reading time}` reads `readingTime`. The resolver fills them in; this
 * module says which variables a type offers and which a pattern cannot fill.
 *
 * @module settings/patterns
 */
import type { PatternField } from "./contract";

/** The page's own title. */
export const TITLE_TOKEN = "Title";
/** The site's name, from the SEO settings. */
export const SITE_NAME_TOKEN = "Site name";

/** The separators offered between a title and the site's name. */
export const SEPARATORS = ["|", "—", "·", "-"] as const;
export type Separator = (typeof SEPARATORS)[number];

/**
 * The fields a page's title is read from, in the order they are looked at, as
 * the resolver reads a page's own content: `{Title}` stands for the first
 * that has a value.
 */
export const TITLE_FIELDS = ["title", "name", "heading"] as const;

/** The pattern a type uses until it is given its own. */
export function defaultTitlePattern(separator: string = "|"): string {
  return `{${TITLE_TOKEN}} ${separator} {${SITE_NAME_TOKEN}}`;
}

/** The default pattern with the default separator. */
export const DEFAULT_TITLE_PATTERN: string = defaultTitlePattern();

/** A variable's name as matched: letters and digits only, any case. */
export function tokenKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Every variable in `pattern`, as written, in order. */
export function patternTokens(pattern: string): string[] {
  return [...pattern.matchAll(/\{([^{}]+)\}/g)].map(match => match[1].trim());
}

/**
 * The variables in `pattern` that neither the page's title, the site's name
 * nor one of `fields` fills, each once, as written.
 */
export function unknownTokens(
  pattern: string,
  fields: readonly PatternField[]
): string[] {
  const known = new Set([
    tokenKey(TITLE_TOKEN),
    tokenKey(SITE_NAME_TOKEN),
    ...fields.map(field => tokenKey(field.name)),
  ]);
  const unknown: string[] = [];
  for (const token of patternTokens(pattern)) {
    if (known.has(tokenKey(token))) continue;
    if (!unknown.includes(token)) unknown.push(token);
  }
  return unknown;
}

/** A value as text a title can use: non-blank text, else nothing. */
const textOfValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/** Whether `title` already ends with the brand `siteName`, as a whole name. */
function endsWithBrand(title: string, siteName: string): boolean {
  const brand = siteName.trim().toLowerCase();
  const text = title.trim().toLowerCase();
  if (brand === "" || !text.endsWith(brand)) return false;
  // A whole name: "Nextlyish" does not end with the brand "Nextly".
  const before = text.slice(0, text.length - brand.length);
  return before === "" || /[^a-z0-9]$/.test(before);
}

/**
 * The separator and site name a pattern adds after the title, each found as
 * `{Site name}` with the spaces and the one separator character before it.
 */
const SITE_NAME_AFTER_TITLE = /\s*[|\u2014\u2013\u00b7:,-]?\s*\{\s*site\s*name\s*\}/gi;

/**
 * `pattern` without the site name it would add after a title that already
 * ends with it, so "{Title} | {Site name}" never gives "Pricing | Acme |
 * Acme". A site name the pattern puts before the title stays.
 */
function withoutRepeatedBrand(
  pattern: string,
  values: { title?: string; siteName?: string }
): string {
  const { title, siteName } = values;
  if (title === undefined || siteName === undefined) return pattern;
  if (!endsWithBrand(title, siteName)) return pattern;
  const titleAt = pattern.search(/\{\s*title\s*\}/i);
  if (titleAt === -1) return pattern;
  const head = pattern.slice(0, titleAt);
  return head + pattern.slice(titleAt).replace(SITE_NAME_AFTER_TITLE, "");
}

/**
 * `pattern` filled in from the page: `{Title}` and `{Site name}`, and any of
 * the page's own text fields by name. Nothing where a token has no value, so
 * the next level supplies the value rather than a pattern with a hole in it.
 * The site's name is never added after a title that already ends with it.
 *
 * The one place a pattern becomes a title: the resolver's answer and the
 * settings screen's preview both call it, so the two cannot disagree.
 */
export function fillPattern(
  pattern: string,
  values: { title?: string; siteName?: string },
  document: Readonly<Record<string, unknown>>
): string | undefined {
  const fields = new Map(
    Object.entries(document).map(([name, value]) => [tokenKey(name), value])
  );
  let missing = false;
  const filled = withoutRepeatedBrand(pattern, values).replace(
    /\{([^{}]+)\}/g,
    (_, name: string) => {
      const key = tokenKey(name);
      const value =
        key === "title"
          ? values.title
          : key === "sitename"
            ? values.siteName
            : (textOfValue(fields.get(key)) ??
              (typeof fields.get(key) === "number"
                ? String(fields.get(key))
                : undefined));
      if (value === undefined) missing = true;
      return value ?? "";
    }
  );
  return missing ? undefined : textOfValue(filled.trim());
}
