/**
 * The list's language filter: "Missing in" and "Out of date in" each language but the default,
 * each option's `where` the server's top-level `_translated` key, and its value one a link can
 * carry in `?pf=` and be read back from.
 */
import { describe, expect, it } from "vitest";

import { LANGUAGE_FILTER, languageListFilters } from "../language-list-filters";
import { chosenPluginFilters, pluginFilterWheres } from "../plugin-filters";

const locale = (code: string, label: string) => ({ code, label });

const THREE = [
  locale("en", "English"),
  locale("es", "Spanish"),
  locale("pt-BR", "Portuguese (Brazil)"),
];

describe("languageListFilters", () => {
  it("offers missing and out of date in every language but the default", () => {
    const [filter] = languageListFilters(THREE, "en");
    expect(filter.name).toBe(LANGUAGE_FILTER);
    expect(filter.label).toBe("Language");
    expect(filter.options).toEqual([
      {
        value: "missing.es",
        label: "Missing in Spanish",
        where: { _translated: { locale: "es", state: "missing" } },
      },
      {
        value: "missing.pt-BR",
        label: "Missing in Portuguese (Brazil)",
        where: { _translated: { locale: "pt-BR", state: "missing" } },
      },
      {
        value: "out-of-date.es",
        label: "Out of date in Spanish",
        where: { _translated: { locale: "es", state: "stale" } },
      },
      {
        value: "out-of-date.pt-BR",
        label: "Out of date in Portuguese (Brazil)",
        where: { _translated: { locale: "pt-BR", state: "stale" } },
      },
    ]);
  });

  it("offers nothing on a site with one language", () => {
    expect(languageListFilters([locale("en", "English")], "en")).toEqual([]);
    expect(languageListFilters([], "")).toEqual([]);
  });

  it("is one filter, so only one language state is ever chosen", () => {
    // The server reads a single `_translated`. Two filters could both be chosen while only one
    // reached the request.
    expect(languageListFilters(THREE, "en")).toHaveLength(1);
  });

  it("reads a link's choice back, a language code with a hyphen included", () => {
    const offered = languageListFilters(THREE, "en");
    const chosen = chosenPluginFilters(offered, [
      `${LANGUAGE_FILTER}:out-of-date.pt-BR`,
    ]);
    expect(pluginFilterWheres(offered, chosen)).toEqual([
      { _translated: { locale: "pt-BR", state: "stale" } },
    ]);
  });

  it("ignores a link naming a language it does not offer", () => {
    const offered = languageListFilters(THREE, "en");
    // The default language is never missing, and a language not configured is not offered.
    for (const value of ["missing.en", "missing.ar", "translated.es"]) {
      const chosen = chosenPluginFilters(offered, [
        `${LANGUAGE_FILTER}:${value}`,
      ]);
      expect(pluginFilterWheres(offered, chosen), value).toEqual([]);
    }
  });
});
