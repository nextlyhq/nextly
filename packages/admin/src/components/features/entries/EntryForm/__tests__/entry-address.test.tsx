// Whether an entry's slug is already a public address decides two things at once: whether the
// auto-slug generator keeps rewriting it, and whether the editor warns before an edit lands. Both
// break quietly — a URL moves and nothing says so — so the predicate is exercised directly.

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  anyLocalePublished,
  effectiveEntryStatus,
  useHasPublicAddress,
  type PublicAddressArgs,
} from "../entry-address";
import type { EntryData } from "../useEntryForm";

const entry = (over: Partial<EntryData> = {}): EntryData => ({
  id: "e1",
  ...over,
});

/** English live, German still being drafted — the shape both new cases turn on. */
const EN_LIVE_DE_DRAFT = {
  status: "published",
  _translations: {
    en: { translated: true, status: "published" },
    de: { translated: true, status: "draft" },
  },
};

describe("effectiveEntryStatus", () => {
  it("reads the active locale's status, not the main row's", () => {
    // The row is a draft, but the German translation is live. Reading `status` off the row calls a
    // published translation unpublished and lets its URL be rewritten.
    const result = effectiveEntryStatus(
      entry({
        status: "draft",
        _translations: { de: { status: "published" } },
      }),
      "de"
    );

    expect(result).toBe("published");
  });

  it("does not inherit the default language's published state", () => {
    // The mirror case. The row is published, this translation has no companion row at all, so it is
    // not live in this language and must not be treated as though it were.
    const result = effectiveEntryStatus(
      entry({
        status: "published",
        _translations: { en: { status: "published" } },
      }),
      "de"
    );

    expect(result).toBeUndefined();
  });

  it("falls back to the row status when there is no translation map", () => {
    // A non-localized collection has one lifecycle and it lives on the row.
    expect(
      effectiveEntryStatus(entry({ status: "published" }), undefined)
    ).toBe("published");
  });
});

describe("anyLocalePublished", () => {
  it("is true when a language other than the one in view is live", () => {
    expect(anyLocalePublished(entry(EN_LIVE_DE_DRAFT))).toBe(true);
  });

  it("is false when every language is still a draft", () => {
    expect(
      anyLocalePublished(
        entry({
          status: "draft",
          _translations: {
            en: { translated: true, status: "draft" },
            de: { translated: false },
          },
        })
      )
    ).toBe(false);
  });

  it("falls back to the row status with no translation map", () => {
    expect(anyLocalePublished(entry({ status: "published" }))).toBe(true);
  });
});

describe("useHasPublicAddress", () => {
  const render = (args: PublicAddressArgs) =>
    renderHook(props => useHasPublicAddress(props), { initialProps: args });

  /** The default injected slug: one field, shared by every language. */
  const shared = (
    over: Partial<PublicAddressArgs> = {}
  ): PublicAddressArgs => ({
    mode: "edit",
    hasStatus: true,
    entry: entry(),
    locale: undefined,
    slugLocalized: false,
    ...over,
  });

  /** A slug the author opted into localizing: one address per language. */
  const perLocale = (
    over: Partial<PublicAddressArgs> = {}
  ): PublicAddressArgs => shared({ slugLocalized: true, ...over });

  it("is false while creating", () => {
    const { result } = render(shared({ mode: "create", entry: null }));
    expect(result.current).toBe(false);
  });

  it("treats every persisted entry as live when the collection has no draft lifecycle", () => {
    // Without Draft/Published there is no unpublished state to be in: saving publishes. Asking
    // whether such an entry is "published" can only answer no, which would leave every entry in
    // these collections auto-rewriting a live URL.
    const { result } = render(shared({ hasStatus: false }));
    expect(result.current).toBe(true);
  });

  it("is false for a draft in a collection that has the lifecycle", () => {
    const { result } = render(shared({ entry: entry({ status: "draft" }) }));
    expect(result.current).toBe(false);
  });

  it("follows the active locale when the slug is localized", () => {
    const { result } = render(
      perLocale({
        entry: entry({
          status: "draft",
          _translations: { de: { status: "published" } },
        }),
        locale: "de",
      })
    );

    expect(result.current).toBe(true);
  });

  it("freezes a shared slug while editing a draft language, if another is live", () => {
    // The auto-injected slug is `localized: false`, so English and German resolve through the same
    // field. Judging it by the language in view lets a title edit on the German draft rewrite the
    // address English is already being served at.
    const { result } = render(
      shared({ entry: entry(EN_LIVE_DE_DRAFT), locale: "de" })
    );

    expect(result.current).toBe(true);
  });

  it("leaves a localized slug free while its own language is a draft", () => {
    // The mirror. A slug the author localized is genuinely per-language, so German's own address
    // has never been public and may still follow its title.
    const { result } = render(
      perLocale({ entry: entry(EN_LIVE_DE_DRAFT), locale: "de" })
    );

    expect(result.current).toBe(false);
  });

  it("stays true after the entry is unpublished", () => {
    // Unpublishing returns the row to draft, but the links and search results that accumulated
    // while it was live do not go away. Letting the slug track again here means republishing
    // silently lands at a different address.
    const { result, rerender } = render(
      shared({ entry: entry({ status: "published" }) })
    );
    expect(result.current).toBe(true);

    rerender(shared({ entry: entry({ status: "draft" }) }));

    expect(result.current).toBe(true);
  });

  it("keeps the latch for a language it left and came back to", () => {
    // The editor stays mounted across language switches. A single-slot latch is overwritten by
    // whichever address was looked at last, so unpublishing English, glancing at German and
    // returning would hand English's formerly public URL back to the generator.
    const draftEn = entry({
      status: "draft",
      _translations: {
        en: { translated: true, status: "draft" },
        de: { translated: true, status: "draft" },
      },
    });
    const { result, rerender } = render(
      perLocale({ entry: entry(EN_LIVE_DE_DRAFT), locale: "en" })
    );
    expect(result.current).toBe(true);

    // English is unpublished, then the author looks at German and comes back.
    rerender(perLocale({ entry: draftEn, locale: "en" }));
    rerender(perLocale({ entry: draftEn, locale: "de" }));
    expect(result.current).toBe(false);

    rerender(perLocale({ entry: draftEn, locale: "en" }));

    expect(result.current).toBe(true);
  });

  it("does not carry that history to a different entry", () => {
    // The editor stays mounted across documents, so an unkeyed latch would freeze the slug of the
    // next draft the author opened purely because the previous one was live.
    const { result, rerender } = render(
      shared({ entry: entry({ id: "published-one", status: "published" }) })
    );
    expect(result.current).toBe(true);

    rerender(shared({ entry: entry({ id: "draft-two", status: "draft" }) }));

    expect(result.current).toBe(false);
  });

  it("does not carry a localized slug's history to another language", () => {
    // Publishing is per locale, so switching to an untranslated language is a different address
    // with its own lifecycle.
    const { result, rerender } = render(
      perLocale({ entry: entry(EN_LIVE_DE_DRAFT), locale: "en" })
    );
    expect(result.current).toBe(true);

    rerender(perLocale({ entry: entry(EN_LIVE_DE_DRAFT), locale: "de" }));

    expect(result.current).toBe(false);
  });
});
