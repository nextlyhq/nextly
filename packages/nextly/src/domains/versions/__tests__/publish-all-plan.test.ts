// Each configured language's outcome in a publish of every language, as the
// planner judges it from the stored rows.
//
// The plausible broken implementations look a language up only by its own
// code, so a pending change kept under no language (the document's, which the
// default language shows) is lost from the preview while the publish still
// refuses or promotes it; or judge "already live" only from a translation's
// own row, so a default language with no row on a live document reads as going
// live for the first time.

import { describe, expect, it } from "vitest";

import { languageOutcomes } from "../publish-all-plan";

const base = {
  configured: ["en", "de"],
  defaultLocale: "en",
  pending: new Set<string | null>(),
  outOfDate: new Map(),
  prior: new Map<string, string | null>([
    ["en", "published"],
    ["de", "published"],
  ]),
  mainStatus: "published",
  hasOwnContent: () => true,
  fallbackChain: (locale: string) => [locale, "en"],
};

describe("languageOutcomes", () => {
  it("shows a pending change kept under no language on the default language", () => {
    expect(languageOutcomes({ ...base, pending: new Set([null]) })).toEqual([
      { locale: "en", outcome: "goes-live-with-pending-change" },
      { locale: "de", outcome: "stays-published" },
    ]);
  });

  it("shows an out-of-date change kept under no language on the default language", () => {
    expect(
      languageOutcomes({
        ...base,
        pending: new Set([null]),
        outOfDate: new Map([[null, { fields: ["tagline"] }]]),
      })
    ).toEqual([
      { locale: "en", outcome: "out-of-date", fields: ["tagline"] },
      { locale: "de", outcome: "stays-published" },
    ]);
  });

  it("keeps a live document's default language as published when it has no row of its own", () => {
    expect(
      languageOutcomes({
        ...base,
        prior: new Map([["de", "published"]]),
      })
    ).toEqual([
      { locale: "en", outcome: "stays-published" },
      { locale: "de", outcome: "stays-published" },
    ]);
  });

  it("names the first language a language without content falls back to", () => {
    expect(
      languageOutcomes({
        ...base,
        prior: new Map([["en", "published"]]),
        hasOwnContent: locale => locale === "en",
      })
    ).toEqual([
      { locale: "en", outcome: "stays-published" },
      { locale: "de", outcome: "shows-fallback", fallback: "en" },
    ]);
  });

  it("names no fallback where the read chain has none", () => {
    expect(
      languageOutcomes({
        ...base,
        prior: new Map([["en", "published"]]),
        hasOwnContent: locale => locale === "en",
        fallbackChain: locale => [locale],
      })
    ).toEqual([
      { locale: "en", outcome: "stays-published" },
      { locale: "de", outcome: "shows-fallback", fallback: null },
    ]);
  });
});
