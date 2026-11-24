/**
 * What an editor's Languages button reads off its form.
 *
 * Catches a way back to the default language that the router skips, a translation open on its own
 * that can no longer be translated, and a hold that lets a language be opened over the one it is
 * for.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { translateAddress } from "@admin/components/features/entries/publish-parts/out-of-date";
import { navigateTo } from "@admin/lib/navigation";

import {
  currentLanguageOf,
  documentLanguagesOf,
  editAddress,
  languagesHeldReason,
  type LanguagesHold,
} from "../document-languages";

const EDITOR = "/admin/collections/posts/p1";

const FREE: LanguagesHold = {
  viewingPastVersion: false,
  recovering: false,
  changeAwaiting: false,
  documentHeld: false,
};

const here = () => `${window.location.pathname}${window.location.search}`;

describe("the languages' addresses", () => {
  beforeEach(() => window.history.replaceState(null, "", EDITOR));
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("are followed from the editor's own path, there and back", () => {
    navigateTo(translateAddress(EDITOR, "es", "en"));
    expect(here()).toBe(`${EDITOR}?locale=es&translate=en`);

    navigateTo(editAddress(EDITOR, "en"));
    expect(here()).toBe(`${EDITOR}?locale=en`);
  });

  it("name the default language, as the bare path is not followed", () => {
    navigateTo(translateAddress(EDITOR, "es", "en"));
    // What the named address is there for.
    navigateTo(EDITOR);
    expect(here()).toBe(`${EDITOR}?locale=es&translate=en`);
  });
});

describe("what a document says of its languages", () => {
  const translations = { en: { translated: true } };

  it("is its overview, and its status where it has that lifecycle", () => {
    const document = { _translations: translations, status: "published" };
    expect(documentLanguagesOf(document, true)).toEqual({
      translations,
      documentStatus: "published",
    });
    expect(documentLanguagesOf(document, false)).toEqual({
      translations,
      documentStatus: undefined,
    });
  });

  it("is nothing where nothing was read", () => {
    const nothing = { translations: undefined, documentStatus: undefined };
    expect(documentLanguagesOf(null, true)).toEqual(nothing);
    expect(documentLanguagesOf({}, true)).toEqual(nothing);
  });
});

describe("the language on screen", () => {
  it.each([
    { locale: undefined, translating: false, current: "en" },
    { locale: "en", translating: false, current: "en" },
    { locale: "es", translating: true, current: "es" },
    // Open on its own: still to be translated.
    { locale: "es", translating: false, current: undefined },
  ])(
    "is $current with $locale in the address, translating: $translating",
    ({ locale, translating, current }) => {
      expect(
        currentLanguageOf({ locale, defaultLanguage: "en", translating })
      ).toBe(current);
    }
  );
});

describe("what holds the languages", () => {
  it("is nothing while the document is free", () => {
    expect(languagesHeldReason(FREE)).toBeUndefined();
  });

  it.each<{ hold: keyof LanguagesHold; says: RegExp }>([
    { hold: "viewingPastVersion", says: /past version/ },
    { hold: "recovering", says: /live values/ },
    { hold: "changeAwaiting", says: /changed elsewhere/ },
    { hold: "documentHeld", says: /edited elsewhere/ },
  ])("says why, for $hold", ({ hold, says }) => {
    expect(languagesHeldReason({ ...FREE, [hold]: true })).toMatch(says);
  });

  it("says what the person can do something about first", () => {
    expect(
      languagesHeldReason({
        viewingPastVersion: true,
        recovering: true,
        changeAwaiting: true,
        documentHeld: true,
      })
    ).toMatch(/past version/);
  });
});
