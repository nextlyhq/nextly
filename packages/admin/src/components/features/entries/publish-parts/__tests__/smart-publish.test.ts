/**
 * The editor's Publish: one click when nothing beyond the language on screen changes for any
 * reader, the choice of what goes live when the shared fields or another language hold changes.
 *
 * The plausible broken versions: one click whatever the shared fields hold (a shared change goes
 * live in every language unannounced), one click past another language's waiting change, the
 * choice on every publish (two clicks every time), counting the language on screen as "another",
 * counting a language with nothing of its own as holding changes, and one click while the server
 * has not described, or has refused, what publishing every language would do.
 */
import { describe, expect, it } from "vitest";

import type {
  PartsLanguageOutcome,
  PublishPartsResult,
} from "@admin/services/publishParts";

import {
  holdsChanges,
  smartPublishPath,
  type EveryLanguageDescription,
} from "../smart-publish";

const LANGUAGES = ["en", "es", "fr"];

/** The server's description of publishing every language, with these outcomes. */
function described(
  languages: PartsLanguageOutcome[]
): EveryLanguageDescription {
  const answer: PublishPartsResult = {
    id: "post-1",
    languages,
    shared: { changes: false, added: false },
  };
  return { state: "described", answer };
}

const englishOnly = described([
  { locale: "en", outcome: "goes-live-with-pending-change" },
  { locale: "es", outcome: "stays-published" },
  { locale: "fr", outcome: "shows-fallback", fallback: "en" },
]);

describe("the editor's Publish", () => {
  it("publishes in one click when only the language on screen holds changes", () => {
    expect(
      smartPublishPath({
        languages: LANGUAGES,
        currentLocale: "en",
        sharedPending: false,
        everyLanguage: englishOnly,
      })
    ).toEqual({ kind: "one-click" });
  });

  it("opens the choice when the shared fields hold unpublished changes", () => {
    expect(
      smartPublishPath({
        languages: LANGUAGES,
        currentLocale: "en",
        sharedPending: true,
        everyLanguage: englishOnly,
      })
    ).toEqual({
      kind: "choose",
      sharedPending: true,
      languages: [],
      undescribed: false,
    });
  });

  it("opens the choice when another language holds unpublished changes, naming it", () => {
    expect(
      smartPublishPath({
        languages: LANGUAGES,
        currentLocale: "en",
        sharedPending: false,
        everyLanguage: described([
          { locale: "en", outcome: "goes-live-with-pending-change" },
          { locale: "es", outcome: "goes-live-with-pending-change" },
          { locale: "fr", outcome: "goes-live" },
        ]),
      })
    ).toEqual({
      kind: "choose",
      sharedPending: false,
      languages: ["es", "fr"],
      undescribed: false,
    });
  });

  it("opens the choice when another language's change is behind the live shared values", () => {
    expect(
      smartPublishPath({
        languages: LANGUAGES,
        currentLocale: "en",
        sharedPending: false,
        everyLanguage: described([
          { locale: "en", outcome: "stays-published" },
          { locale: "es", outcome: "out-of-date", fields: ["tagline"] },
          { locale: "fr", outcome: "shows-fallback", fallback: null },
        ]),
      })
    ).toMatchObject({ kind: "choose", languages: ["es"] });
  });

  it("never counts the language on screen as another language", () => {
    // Spanish on screen, with its own change: nothing beyond it changes.
    expect(
      smartPublishPath({
        languages: LANGUAGES,
        currentLocale: "es",
        sharedPending: false,
        everyLanguage: described([
          { locale: "en", outcome: "stays-published" },
          { locale: "es", outcome: "goes-live-with-pending-change" },
          { locale: "fr", outcome: "shows-fallback", fallback: "en" },
        ]),
      })
    ).toEqual({ kind: "one-click" });
  });

  it("opens the choice while publishing every language is not yet described", () => {
    expect(
      smartPublishPath({
        languages: LANGUAGES,
        currentLocale: "en",
        sharedPending: false,
        everyLanguage: { state: "unknown" },
      })
    ).toEqual({
      kind: "choose",
      sharedPending: false,
      languages: [],
      undescribed: true,
    });
  });

  it("opens the choice when the server refuses to describe publishing every language", () => {
    expect(
      smartPublishPath({
        languages: LANGUAGES,
        currentLocale: "en",
        sharedPending: false,
        everyLanguage: { state: "refused" },
      })
    ).toMatchObject({ kind: "choose", undescribed: true });
  });

  it("publishes in one click on a site with one language, whatever the shared fields hold", () => {
    expect(
      smartPublishPath({
        languages: ["en"],
        currentLocale: "en",
        sharedPending: true,
        everyLanguage: { state: "unknown" },
      })
    ).toEqual({ kind: "one-click" });
  });

  it("publishes in one click a document that is not translated", () => {
    expect(
      smartPublishPath({
        languages: [],
        currentLocale: "en",
        sharedPending: true,
        everyLanguage: { state: "refused" },
      })
    ).toEqual({ kind: "one-click" });
  });
});

describe("what holds changes for a language's readers", () => {
  it("is a waiting change, a first publish of its own content, or a change behind the shared values", () => {
    const outcomes: PartsLanguageOutcome[] = [
      { locale: "es", outcome: "goes-live-with-pending-change" },
      { locale: "es", outcome: "goes-live" },
      { locale: "es", outcome: "out-of-date", fields: [] },
      { locale: "es", outcome: "stays-published" },
      { locale: "es", outcome: "shows-fallback", fallback: "en" },
      { locale: "es", outcome: "taken-down" },
      { locale: "es", outcome: "stays-unpublished" },
    ];
    expect(outcomes.map(holdsChanges)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});
