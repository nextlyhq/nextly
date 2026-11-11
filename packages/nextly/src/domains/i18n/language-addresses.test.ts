import { describe, expect, it } from "vitest";

import { normalizeLocalization } from "./config/normalize";
import {
  languageAddressFrom,
  validateLanguageAddressRule,
} from "./language-addresses";

const three = normalizeLocalization({
  locales: ["en", "de", "fr"],
  defaultLocale: "en",
});
const one = normalizeLocalization({ locales: ["en"], defaultLocale: "en" });

describe("a language's address, by prefix", () => {
  it("puts every language under its code when the site says nothing", () => {
    expect(languageAddressFrom(undefined, three, "/about", "de")).toEqual({
      status: "resolved",
      path: "/de/about",
    });
    expect(languageAddressFrom(undefined, three, "/about", "en")).toEqual({
      status: "resolved",
      path: "/en/about",
    });
    expect(languageAddressFrom(undefined, three, "/", "fr")).toEqual({
      status: "resolved",
      path: "/fr",
    });
  });

  it("leaves the default language at the root when the site asks", () => {
    const rule = { by: "prefix", defaultLanguage: "unprefixed" } as const;
    expect(languageAddressFrom(rule, three, "/about", "en")).toEqual({
      status: "resolved",
      path: "/about",
    });
    expect(languageAddressFrom(rule, three, "/", "en")).toEqual({
      status: "resolved",
      path: "/",
    });
    expect(languageAddressFrom(rule, three, "/about", "de")).toEqual({
      status: "resolved",
      path: "/de/about",
    });
  });

  it("changes nothing for a site with one language or none, unless it declares a rule", () => {
    expect(languageAddressFrom(undefined, one, "/about", "en")).toEqual({
      status: "resolved",
      path: "/about",
    });
    expect(languageAddressFrom(undefined, undefined, "/about", "en")).toEqual({
      status: "resolved",
      path: "/about",
    });
    expect(languageAddressFrom({ by: "prefix" }, one, "/about", "en")).toEqual({
      status: "resolved",
      path: "/en/about",
    });
  });

  it("has no address in a language the site does not have", () => {
    expect(languageAddressFrom(undefined, three, "/about", "es")).toEqual({
      status: "unavailable",
    });
  });
});

describe("a language's address, by domain", () => {
  const rule = {
    by: "domain",
    domains: { en: "https://example.com", de: "https://example.de" },
  } as const;

  it("serves each language at the same path on its own domain", () => {
    expect(languageAddressFrom(rule, three, "/about", "de")).toEqual({
      status: "resolved",
      origin: "https://example.de",
      path: "/about",
    });
    expect(languageAddressFrom(rule, three, "/", "en")).toEqual({
      status: "resolved",
      origin: "https://example.com",
      path: "/",
    });
  });

  it("has no address in a language given no domain", () => {
    expect(languageAddressFrom(rule, three, "/about", "fr")).toEqual({
      status: "unavailable",
    });
  });
});

describe("the declared rule is checked when the site's configuration is", () => {
  const languages = { locales: ["en", "de"], defaultLocale: "en" };

  it("accepts each strategy", () => {
    expect(() =>
      validateLanguageAddressRule({ by: "prefix" }, languages)
    ).not.toThrow();
    expect(() =>
      validateLanguageAddressRule(
        {
          by: "domain",
          domains: { en: "https://example.com", de: "https://example.de" },
        },
        languages
      )
    ).not.toThrow();
  });

  it("refuses an unknown strategy or default-language choice", () => {
    expect(() =>
      validateLanguageAddressRule({ by: "subdomain" }, languages)
    ).toThrow(/languageAddresses/);
    expect(() =>
      validateLanguageAddressRule(
        { by: "prefix", defaultLanguage: "hidden" },
        languages
      )
    ).toThrow(/languageAddresses/);
  });

  it("refuses a domain that is not a bare http(s) origin", () => {
    for (const domain of [
      "example.de",
      "https://example.de/",
      "https://example.de/de",
      "https://example.de?x=1",
      "ftp://example.de",
    ]) {
      expect(
        () =>
          validateLanguageAddressRule(
            {
              by: "domain",
              domains: { en: "https://example.com", de: domain },
            },
            languages
          ),
        domain
      ).toThrow(/origin/);
    }
  });

  it("refuses two languages on one domain", () => {
    expect(() =>
      validateLanguageAddressRule(
        {
          by: "domain",
          domains: { en: "https://example.com", de: "https://example.com" },
        },
        languages
      )
    ).toThrow(/same domain/);
  });

  it("names a configured language with no domain, and a domain for no language", () => {
    expect(() =>
      validateLanguageAddressRule(
        { by: "domain", domains: { en: "https://example.com" } },
        languages
      )
    ).toThrow(/'de' has no domain/);
    expect(() =>
      validateLanguageAddressRule(
        {
          by: "domain",
          domains: {
            en: "https://example.com",
            de: "https://example.de",
            fr: "https://example.fr",
          },
        },
        languages
      )
    ).toThrow(/'fr' is not one of the site's languages/);
  });

  it("checks only the shape where the languages are kept in Settings", () => {
    expect(() =>
      validateLanguageAddressRule(
        { by: "domain", domains: { fr: "https://example.fr" } },
        undefined
      )
    ).not.toThrow();
  });
});
