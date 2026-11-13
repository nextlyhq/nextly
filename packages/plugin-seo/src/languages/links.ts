/**
 * A page's language links: the address of each language version that
 * stands for itself, under the code search engines read it by, and
 * `x-default` at the default language's.
 *
 * The page's head and the sitemap both build them here, from the same
 * versions, so every version names every other, itself included, and each
 * link points where that version's own canonical does: the links are
 * reciprocal by construction. Pure.
 *
 * @module languages/links
 */
import { hreflangCodes, type LanguageCodeProblem } from "./hreflang";

/** A language version of a page that stands for itself, and where. */
export interface LanguageVersion {
  /** The site's language, as the site spells it. */
  language: string;
  /** The version's canonical, as its answer gives it. */
  href: string;
}

/** One language link: `<link rel="alternate" hreflang href>`. */
export interface LanguageLink {
  /** The code search engines read, or `x-default`. */
  hreflang: string;
  href: string;
}

/**
 * The links of a page whose versions standing for themselves are
 * `versions`: one for each version whose language has a code search engines
 * accept, and `x-default` at the default language's, where that version is
 * among them. None where fewer than two versions are linked, since a page
 * with no other language has nothing to link to. The problems name each
 * language left out for its code.
 */
export function languageLinks(
  versions: readonly LanguageVersion[],
  defaultLanguage: string
): { links: LanguageLink[]; problems: LanguageCodeProblem[] } {
  // The default language first, so it keeps a code another shares with it.
  const ordered = [
    ...versions.filter(version => version.language === defaultLanguage),
    ...versions.filter(version => version.language !== defaultLanguage),
  ];
  const { codes, problems } = hreflangCodes(
    ordered.map(version => version.language)
  );
  const links = ordered.flatMap(version => {
    const hreflang = codes.get(version.language);
    return hreflang === undefined ? [] : [{ hreflang, href: version.href }];
  });
  if (links.length < 2) return { links: [], problems };
  const fallback = ordered.find(
    version =>
      version.language === defaultLanguage && codes.has(version.language)
  );
  return {
    links:
      fallback === undefined
        ? links
        : [...links, { hreflang: "x-default", href: fallback.href }],
    problems,
  };
}
