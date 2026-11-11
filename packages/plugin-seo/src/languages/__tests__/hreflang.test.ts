/**
 * The codes search engines accept in language links: a site's language is
 * named as it is spelled where it is one, mapped where it names one under
 * another spelling, and refused, with a problem, where it names none.
 */
import { describe, expect, it } from "vitest";

import {
  hreflangCodes,
  hreflangOf,
  ISO_3166_1_COUNT,
  ISO_639_1_COUNT,
} from "../hreflang";

describe("the code a language is named by", () => {
  it.each([
    ["en", "en"],
    ["de", "de"],
    ["pt-BR", "pt-BR"],
    // Case is not read, so either spelling stands as it is.
    ["EN-us", "en-US"],
    ["zh-Hant", "zh-Hant"],
    ["zh-Hant-TW", "zh-Hant-TW"],
  ])("accepts %s", (language, code) => {
    expect(hreflangOf(language)).toEqual({ status: "accepted", code });
  });

  it.each([
    ["pt_BR", "pt-BR"],
    ["deu", "de"],
    ["eng", "en"],
    ["iw", "he"],
    ["en-UK", "en-GB"],
  ])("maps %s to %s", (language, code) => {
    expect(hreflangOf(language)).toEqual({ status: "mapped", code });
  });

  it.each([
    // A UN M.49 region is not an ISO 3166-1 one.
    "es-419",
    // Regions reserved for something else.
    "en-EU",
    "en-UN",
    // A language of no two-letter code.
    "fil",
    "yue",
    // Not a language at all.
    "english",
    "x-default",
    "",
    "  ",
    // A variant or an extension is more than a language link names.
    "de-CH-1996",
    "en-US-u-ca-gregory",
  ])("refuses %j", language => {
    expect(hreflangOf(language)).toEqual({ status: "refused" });
  });

  it("checks each part against the whole of its standard", () => {
    expect(ISO_639_1_COUNT).toBe(183);
    expect(ISO_3166_1_COUNT).toBe(249);
  });
});

describe("the codes of a site's languages", () => {
  it("names each language, and lists one refused as a problem fixed in the settings", () => {
    const { codes, problems } = hreflangCodes(["en", "pt_BR", "es-419"]);
    expect([...codes]).toEqual([
      ["en", "en"],
      ["pt_BR", "pt-BR"],
    ]);
    expect(problems).toEqual([
      {
        language: "es-419",
        detail: "code",
        message: expect.stringContaining('"es-419"'),
        fix: "settings",
      },
    ]);
  });

  it("keeps a code for the first language named by it, listing the next as a problem", () => {
    const { codes, problems } = hreflangCodes(["de", "deu", "DE"]);
    expect([...codes]).toEqual([["de", "de"]]);
    expect(problems.map(problem => [problem.language, problem.sameAs])).toEqual(
      [
        ["deu", "de"],
        ["DE", "de"],
      ]
    );
    expect(problems.every(problem => problem.detail === "same-code")).toBe(
      true
    );
  });
});
