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
