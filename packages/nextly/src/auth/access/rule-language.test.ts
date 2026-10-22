/**
 * Which languages a rule is told an operation involves.
 *
 * Each block names the property that separates the answer from a plausible
 * broken one: an unknown language passed through instead of the one actually
 * read, a read of every translation told only the default, an operation with
 * no language of its own told it involves none (so a rule limited to one
 * language would pass a delete of every language), and a frame that leaks
 * into, or is lost by, the operation it surrounds.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SanitizedLocalizationConfig } from "../../domains/i18n/config/types";

const { container } = vi.hoisted(() => ({
  container: { config: undefined as unknown },
}));

vi.mock("../../di/container", () => ({
  container: {
    has: (name: string) => name === "config" && container.config !== undefined,
    get: () => container.config,
  },
}));

import { buildRuleContext, type RuleCaller } from "./rule-context";
import {
  currentRuleLanguage,
  everyLanguage,
  languagesOfContent,
  readLanguagesFor,
  withRuleLanguage,
  writeAsNamedLanguagesFor,
  writeLanguagesFor,
} from "./rule-language";

const LOCALISED: SanitizedLocalizationConfig = {
  locales: ["en", "fr", "de"].map(code => ({
    code,
    label: code,
    rtl: false,
    fallbackLocale: [],
  })),
  defaultLocale: "en",
  // No fallback, so each read below is of its one language; the fallback
  // case has a configuration of its own.
  fallback: false,
};

const caller: RuleCaller = {
  user: { id: "u1" },
  roles: [],
  permissions: [],
  principal: null,
};
const readPosts = {
  operation: "read",
  target: { kind: "collection", slug: "posts" },
} as const;
const contextNow = () => buildRuleContext(() => true, caller, readPosts);

afterEach(() => {
  container.config = undefined;
});

describe("readLanguagesFor and writeLanguagesFor", () => {
  it("are the language asked for, where it is configured", () => {
    for (const languagesFor of [readLanguagesFor, writeLanguagesFor]) {
      expect(languagesFor(LOCALISED, "fr")).toEqual({
        locale: "fr",
        locales: ["fr"],
      });
    }
  });

  it("are the default where the language asked for is unknown or absent, as a read or a write resolves it", () => {
    for (const languagesFor of [readLanguagesFor, writeLanguagesFor]) {
      for (const requested of ["xx", undefined]) {
        expect(languagesFor(LOCALISED, requested)).toEqual({
          locale: "en",
          locales: ["en"],
        });
      }
    }
  });

  it("are every language for a read of every translation, and a write to every language, each its own selector", () => {
    expect(readLanguagesFor(LOCALISED, "all")).toEqual({
      locales: ["en", "fr", "de"],
    });
    expect(writeLanguagesFor(LOCALISED, "*")).toEqual({
      locales: ["en", "fr", "de"],
    });
  });

  it("are the default for the other one's selector, which each resolves so", () => {
    // A read asked for `*` returns the default language's content, and is
    // judged in it; a write does not take `all`.
    expect(readLanguagesFor(LOCALISED, "*")).toEqual({
      locale: "en",
      locales: ["en"],
    });
    expect(writeLanguagesFor(LOCALISED, "all")).toEqual({
      locale: "en",
      locales: ["en"],
    });
  });

  it("tell a read each language it falls back to, in the order it tries them, and a write none", () => {
    // German falls back to French, then the default.
    const withFallback: SanitizedLocalizationConfig = {
      ...LOCALISED,
      fallback: true,
      locales: LOCALISED.locales.map(locale =>
        locale.code === "de" ? { ...locale, fallbackLocale: ["fr"] } : locale
      ),
    };
    expect(readLanguagesFor(withFallback, "de")).toEqual({
      locale: "de",
      locales: ["de", "fr", "en"],
    });
    // A read asked for no fallback reads its one language.
    expect(readLanguagesFor(withFallback, "de", "none")).toEqual({
      locale: "de",
      locales: ["de"],
    });
    expect(readLanguagesFor(withFallback, "de", false)).toEqual({
      locale: "de",
      locales: ["de"],
    });
    // A named fallback reads that language's chain after the one asked for.
    expect(readLanguagesFor(withFallback, "en", "fr")).toEqual({
      locale: "en",
      locales: ["en", "fr"],
    });
    // A write writes its one language; nothing falls back.
    expect(writeLanguagesFor(withFallback, "de")).toEqual({
      locale: "de",
      locales: ["de"],
    });
  });

  it("tell a read of translation states every language, still showing its own", () => {
    const every = { locale: "fr", locales: ["en", "fr", "de"] };
    expect(
      readLanguagesFor(LOCALISED, "fr", undefined, { translationStatus: true })
    ).toEqual(every);
    expect(
      readLanguagesFor(LOCALISED, "fr", undefined, {
        where: { _translated: { locale: "de", state: "missing" } },
      })
    ).toEqual(every);
    // Neither asked for, the read is of its own language.
    expect(
      readLanguagesFor(LOCALISED, "fr", undefined, {
        translationStatus: false,
        where: { title: { equals: "x" } },
      })
    ).toEqual({ locale: "fr", locales: ["fr"] });
  });

  it("tell a write that keeps the language as named every language where the site does not configure it", () => {
    expect(writeAsNamedLanguagesFor(LOCALISED, "xx")).toEqual({
      locales: ["en", "fr", "de"],
    });
    // A configured language, none, and every language are a write's own.
    for (const requested of ["fr", undefined, "*"]) {
      expect(writeAsNamedLanguagesFor(LOCALISED, requested)).toEqual(
        writeLanguagesFor(LOCALISED, requested)
      );
    }
    expect(writeAsNamedLanguagesFor(undefined, "xx")).toEqual({ locales: [] });
  });

  it("are no language where the site has none", () => {
    expect(readLanguagesFor(undefined, "fr")).toEqual({ locales: [] });
    expect(writeLanguagesFor(undefined, "*")).toEqual({ locales: [] });
  });
});

describe("the languages a rule is told", () => {
  it("are those of the operation the rule runs inside", () => {
    container.config = { localization: LOCALISED };
    const ctx = withRuleLanguage(readLanguagesFor(LOCALISED, "fr"), contextNow);
    expect(ctx.locale).toBe("fr");
    expect(ctx.locales).toEqual(["fr"]);
  });

  it("are those of the innermost operation, and the outer's again after it", () => {
    container.config = { localization: LOCALISED };
    withRuleLanguage(readLanguagesFor(LOCALISED, "fr"), () => {
      const inner = withRuleLanguage(everyLanguage(), contextNow);
      expect(inner.locale).toBeUndefined();
      expect(inner.locales).toEqual(["en", "fr", "de"]);
      expect(contextNow().locale).toBe("fr");
    });
  });

  it("are every configured language where no operation names its own", () => {
    container.config = { localization: LOCALISED };
    const ctx = contextNow();
    expect(ctx.locale).toBeUndefined();
    expect(ctx.locales).toEqual(["en", "fr", "de"]);
  });

  it("are none where the site has no languages", () => {
    container.config = { localization: undefined };
    expect(contextNow().locales).toEqual([]);
    container.config = undefined;
    expect(contextNow().locales).toEqual([]);
  });

  it("are the question's own where it names them, over the operation's", () => {
    container.config = { localization: LOCALISED };
    const ctx = withRuleLanguage(readLanguagesFor(LOCALISED, "fr"), () =>
      buildRuleContext(() => true, caller, { ...readPosts, locale: "de" })
    );
    expect(ctx.locale).toBe("de");
    expect(ctx.locales).toEqual(["de"]);
  });

  it("limit a rule to one language out of an operation on every language", () => {
    // A rule letting a caller act only in French refuses an operation on the
    // whole entry, such as a delete, which removes every language. Written as
    // a rule would be, with no guard for an empty list, which it would pass.
    container.config = { localization: LOCALISED };
    const frenchOnly = ({ locales }: { locales: string[] }) =>
      locales.every(code => code === "fr");
    const ctx = withRuleLanguage(everyLanguage(), () =>
      buildRuleContext(frenchOnly, caller, {
        operation: "delete",
        target: { kind: "collection", slug: "posts" },
      })
    );
    expect(frenchOnly(ctx)).toBe(false);
  });
});

describe("languagesOfContent", () => {
  const french = { locale: "fr", locales: ["fr"] };
  const every = { locales: ["en", "fr", "de"] };
  const pages = { kind: "collection", slug: "pages" } as const;
  const banner = { kind: "single", slug: "banner" } as const;

  /** A site whose `pages` and `banner` are declared as given. */
  function declare(declared: object, single: object = { slug: "banner" }) {
    container.config = {
      localization: LOCALISED,
      collections: [{ slug: "pages", ...declared }],
      singles: [single],
      fieldGroups: [
        { slug: "seo", localized: true },
        { slug: "hero", localized: false },
      ],
    };
  }

  it("tells an operation on content the same in every language every language, with none judged alone", () => {
    declare({ localized: false, fields: [{ type: "text", name: "title" }] });
    expect(languagesOfContent(pages, french)).toEqual(every);
    expect(languagesOfContent(banner, french)).toEqual(every);
  });

  it("keeps the language asked for on content stored per language", () => {
    declare({ localized: true }, { slug: "banner", localized: true });
    expect(languagesOfContent(pages, french)).toEqual(french);
    expect(languagesOfContent(banner, french)).toEqual(french);
  });

  it("counts a localized field group as content stored per language, and only a localized one", () => {
    declare({
      fields: [{ type: "component", name: "meta", component: "seo" }],
    });
    expect(languagesOfContent(pages, french)).toEqual(french);
    declare({
      fields: [{ type: "component", name: "top", fieldGroups: ["hero"] }],
    });
    expect(languagesOfContent(pages, french)).toEqual(every);
  });

  it("judges a field group by its own declaration", () => {
    declare({ localized: true });
    expect(
      languagesOfContent({ kind: "component", slug: "seo" }, french)
    ).toEqual(french);
    expect(
      languagesOfContent({ kind: "component", slug: "hero" }, french)
    ).toEqual(every);
  });

  it("keeps the language asked for where the configuration does not declare it", () => {
    declare({ localized: false });
    // Built in the admin: it holds no rule that could read a language.
    expect(
      languagesOfContent({ kind: "collection", slug: "unknown" }, french)
    ).toEqual(french);
  });

  it("judges each rule by the content of its own target, whatever the operation it is asked inside", () => {
    // A localized entry read in French, expanding a related row that is the
    // same in every language: the related row's rule is told every language.
    declare({ localized: false });
    const related = withRuleLanguage(french, () =>
      buildRuleContext(() => true, caller, { operation: "read", target: pages })
    );
    expect(related.locale).toBeUndefined();
    expect(related.locales).toEqual(every.locales);
  });
});
