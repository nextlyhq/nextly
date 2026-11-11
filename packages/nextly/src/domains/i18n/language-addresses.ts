/**
 * How each language's public address is formed: under a prefix (`/de/about`)
 * or on a domain of its own (`https://example.de/about`).
 *
 * Addresses are kept per language as a path (`/about` in `de`); this is the
 * one place that turns a language and that path into the address a visitor
 * opens, so a canonical link, a language link and a sitemap entry agree.
 * Routing a domain to the right language stays with the site; the rule only
 * describes it.
 *
 * @module domains/i18n/language-addresses
 * @experimental
 */
import { z } from "zod";

import { container } from "../../di/container";
import type { NextlyServiceConfig } from "../../di/register";
import { NextlyError } from "../../errors/nextly-error";

import { normalizeLocalization } from "./config/normalize";
import type {
  LanguageAddressRule,
  LocalizationConfig,
  SanitizedLocalizationConfig,
} from "./config/types";
import { appLocalization, withCurrentLanguages } from "./configured-locales";

/**
 * @experimental A language's address for a path: the path a visitor opens,
 * on `origin` where the language has a domain of its own; unavailable where
 * the site has no such language, or a domain rule gives it none.
 */
export type LanguageAddress =
  | { status: "resolved"; path: string; origin?: string }
  | { status: "unavailable" };

export type { LanguageAddressRule };

const UNAVAILABLE: LanguageAddress = { status: "unavailable" };

/**
 * The address `path` has in `locale`, by `rule` over the site's languages.
 * Pure: the configuration is handed in.
 */
export function languageAddressFrom(
  rule: LanguageAddressRule | undefined,
  localization: SanitizedLocalizationConfig | undefined,
  path: string,
  locale: string
): LanguageAddress {
  // A site with no languages, or with one and no rule, serves each page at
  // its path: there is no other language to tell it apart from.
  if (localization === undefined) return { status: "resolved", path };
  if (!localization.locales.some(language => language.code === locale)) {
    return UNAVAILABLE;
  }
  if (rule === undefined && localization.locales.length === 1) {
    return { status: "resolved", path };
  }
  if (rule?.by === "domain") {
    const origin = rule.domains[locale];
    return origin === undefined
      ? UNAVAILABLE
      : { status: "resolved", origin, path };
  }
  if (
    rule?.defaultLanguage === "unprefixed" &&
    locale === localization.defaultLocale
  ) {
    return { status: "resolved", path };
  }
  return {
    status: "resolved",
    path: path === "/" ? `/${locale}` : `/${locale}${path}`,
  };
}

/** @experimental A public address in the form it is kept: a language and a path. */
export interface KeptAddress {
  locale: string;
  path: string;
}

/**
 * The languages an address is kept in, by the site's localization: its
 * languages, or the one it serves without localization, its default (`"en"`
 * where none is named). The one rule for which language an address record
 * keys a page's address by, and which a request is looked up in.
 */
export function addressLanguagesOf(
  localization: SanitizedLocalizationConfig | undefined
): string[] {
  const codes = localization?.locales.map(language => language.code) ?? [];
  if (codes.length > 0) return codes;
  const fallback = localization?.defaultLocale;
  return [fallback !== undefined && fallback !== "" ? fallback : "en"];
}

/**
 * The language and kept path the request for `url` asks for, by `rule` over
 * the site's languages, or undefined where no language serves that address.
 * Pure: the configuration is handed in.
 *
 * Derived from {@link languageAddressFrom} rather than stated beside it: each
 * language's root address is formed by that rule, the request is read under
 * the longest root it falls within, and the answer is kept only where the
 * rule forms the very address asked for from it. A request on a host no
 * domain rule names is read in the default language, as a staging host is.
 */
export function addressFromRequest(
  rule: LanguageAddressRule | undefined,
  localization: SanitizedLocalizationConfig | undefined,
  url: URL
): KeptAddress | undefined {
  const languages = addressLanguagesOf(localization);
  const roots = languages.flatMap(locale => {
    const root = languageAddressFrom(rule, localization, "/", locale);
    return root.status === "resolved" ? [{ locale, ...root }] : [];
  });
  const named = roots.some(root => root.origin === url.origin);
  const fallback = localization?.defaultLocale ?? languages[0];
  // A language on a domain of its own is read only on that domain, and on a
  // host no rule names, only the default language is.
  const onThisHost = (root: (typeof roots)[number]) => {
    if (root.origin === undefined) return true;
    return named ? root.origin === url.origin : root.locale === fallback;
  };
  const candidates = roots
    .filter(onThisHost)
    .filter(
      root =>
        root.path === "/" ||
        url.pathname === root.path ||
        url.pathname.startsWith(`${root.path}/`)
    )
    .sort((a, b) => b.path.length - a.path.length);
  for (const root of candidates) {
    const rest =
      root.path === "/" ? url.pathname : url.pathname.slice(root.path.length);
    const path = rest === "" ? "/" : rest;
    const formed = languageAddressFrom(rule, localization, path, root.locale);
    if (formed.status === "resolved" && formed.path === url.pathname) {
      return { locale: root.locale, path };
    }
  }
  return undefined;
}

/**
 * @experimental The language and kept path a request for `url` asks for, by
 * the site's rule, or undefined where no language serves it: the inverse of
 * {@link languageAddressOf}, for a Proxy or a route that has a request and
 * needs the address record's key.
 */
export async function addressOfRequest(
  url: string | URL
): Promise<KeptAddress | undefined> {
  return addressFromRequest(
    declaredRule(),
    await languagesNow(),
    typeof url === "string" ? new URL(url) : url
  );
}

/** The rule the running site declares, if any. */
function declaredRule(): LanguageAddressRule | undefined {
  if (!container.has("config")) return undefined;
  return container.get<NextlyServiceConfig>("config").languageAddresses;
}

/**
 * The site's languages as they are now, brought up to date where Settings
 * keeps them; undefined where localization is off or nothing is registered.
 */
async function languagesNow(): Promise<
  SanitizedLocalizationConfig | undefined
> {
  return withCurrentLanguages(() => Promise.resolve(appLocalization()));
}

/**
 * @experimental The address `path`, an address kept in `locale`, is opened
 * at, by the site's rule.
 */
export async function languageAddressOf(
  path: string,
  locale: string
): Promise<LanguageAddress> {
  return languageAddressFrom(
    declaredRule(),
    await languagesNow(),
    path,
    locale
  );
}

/**
 * @experimental The language a route segment names, spelled exactly as the
 * site configures it, or undefined where it names none of the site's
 * languages.
 */
export async function languageOfSegment(
  segment: string
): Promise<string | undefined> {
  const languages = await languagesNow();
  return languages?.locales.some(language => language.code === segment)
    ? segment
    : undefined;
}

/** A bare http(s) origin, as `URL.origin` spells it: no path, query or slash. */
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

const ruleSchema = z.discriminatedUnion("by", [
  z.strictObject({
    by: z.literal("prefix"),
    defaultLanguage: z.enum(["prefixed", "unprefixed"]).optional(),
  }),
  z.strictObject({
    by: z.literal("domain"),
    domains: z.record(z.string(), z.string()),
  }),
]);

function refuse(message: string, reason: string): NextlyError {
  return NextlyError.invalidInput({
    message: `languageAddresses: ${message}`,
    logContext: { reason },
  });
}

/**
 * Checks a declared rule when the site's configuration is checked: its shape,
 * each domain a bare http(s) origin, no domain shared by two languages, and,
 * where the configuration names the languages, one domain for each and none
 * for another. Languages kept in Settings are not known here, so a language
 * missing a domain there has no address until it is given one.
 *
 * @throws NextlyError `INVALID_INPUT` naming the problem
 */
export function validateLanguageAddressRule(
  rule: unknown,
  localization: LocalizationConfig | undefined
): void {
  const parsed = ruleSchema.safeParse(rule);
  if (!parsed.success) {
    throw refuse(
      'expected { by: "prefix", defaultLanguage?: "prefixed" | "unprefixed" } ' +
        'or { by: "domain", domains: { <language>: "https://…" } }.',
      "language-address-rule-shape"
    );
  }
  if (parsed.data.by !== "domain") return;
  const { domains } = parsed.data;
  const seen = new Map<string, string>();
  for (const [code, domain] of Object.entries(domains)) {
    if (!isOrigin(domain)) {
      throw refuse(
        `the domain for '${code}' must be a bare origin such as ` +
          `"https://example.de", with no path, query or trailing slash; got "${domain}".`,
        "language-address-domain-not-origin"
      );
    }
    const key = domain.toLowerCase();
    const other = seen.get(key);
    if (other !== undefined) {
      throw refuse(
        `'${other}' and '${code}' are on the same domain, ${domain}; ` +
          "give each language its own, or use prefixes.",
        "language-address-domain-shared"
      );
    }
    seen.set(key, code);
  }
  if (localization === undefined) return;
  const codes = normalizeLocalization(localization).locales.map(l => l.code);
  for (const code of codes) {
    if (domains[code] === undefined) {
      throw refuse(
        `'${code}' has no domain. Give every language one.`,
        "language-address-domain-missing"
      );
    }
  }
  for (const code of Object.keys(domains)) {
    if (!codes.includes(code)) {
      throw refuse(
        `'${code}' is not one of the site's languages (${codes.join(", ")}).`,
        "language-address-domain-unknown-language"
      );
    }
  }
}
