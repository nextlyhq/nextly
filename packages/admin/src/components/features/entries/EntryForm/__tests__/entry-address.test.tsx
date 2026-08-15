// Whether an entry's slug is already a public address decides two things at once: whether the
// auto-slug generator keeps rewriting it, and whether the editor warns before an edit lands. Both
// break quietly — a URL moves and nothing says so — so the predicate is exercised directly.

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  anyLocalePublished,
  effectiveEntryStatus,
  everPublishedOnRecord,
  previewLinkLocale,
  previewLinkSiteUrl,
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

  it("reads the default locale's companion status when editing it implicitly", () => {
    // The editor shows the default language as `locale === undefined`. After a
    // reconcile the default locale's `_status` can live on the companion and be
    // published while the main row is a draft; reading the row would call the
    // live default a draft and let its already-live slug be rewritten.
    const result = effectiveEntryStatus(
      entry({
        status: "draft",
        _translations: { en: { status: "published" } },
      }),
      undefined,
      "en"
    );

    expect(result).toBe("published");
  });

  it("prefers the default companion status over the row in both directions", () => {
    // The mirror: a drafted default over a published-shaped row reports draft.
    const result = effectiveEntryStatus(
      entry({
        status: "published",
        _translations: { en: { status: "draft" } },
      }),
      undefined,
      "en"
    );

    expect(result).toBe("draft");
  });

  it("falls back to the row status for the default locale with no companion row", () => {
    // The default language's own content lives on the main row, so when the map
    // carries only other languages the row status still governs it.
    const result = effectiveEntryStatus(
      entry({
        status: "published",
        _translations: { de: { status: "draft" } },
      }),
      undefined,
      "en"
    );

    expect(result).toBe("published");
  });
});

describe("anyLocalePublished", () => {
  it("is true when a language other than the one in view is live", () => {
    expect(anyLocalePublished(entry(EN_LIVE_DE_DRAFT), true)).toBe(true);
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
        }),
        true
      )
    ).toBe(false);
  });

  it("falls back to the row status with no translation map", () => {
    expect(anyLocalePublished(entry({ status: "published" }), false)).toBe(
      true
    );
  });

  it("assumes public when a LOCALIZED entry arrives without the overview", () => {
    // The map's absence is a property of the caller's query, not of the entry — quick-edit from a
    // relationship field does not ask for it. The row status describes the default language alone,
    // so trusting it would call an entry unpublished while another language is live and hand its
    // shared slug back to the generator. Losing auto-slug convenience is the cheaper mistake.
    expect(anyLocalePublished(entry({ status: "draft" }), true)).toBe(true);
  });
});

describe("everPublishedOnRecord", () => {
  it("reads the serialized timestamp an API response carries", () => {
    expect(
      everPublishedOnRecord(entry({ firstPublishedAt: "2026-02-01T10:00:00Z" }))
    ).toBe(true);
  });

  it("reads the Date a hook-shaped document carries", () => {
    expect(
      everPublishedOnRecord(entry({ firstPublishedAt: new Date("2026-02-01") }))
    ).toBe(true);
  });

  it("is false for a row that predates the column", () => {
    // The column is nullable and null for every entry written before it existed, so an absent
    // marker means "not known to have been published" and must not assert anything.
    expect(everPublishedOnRecord(entry({ firstPublishedAt: null }))).toBe(
      false
    );
    expect(everPublishedOnRecord(entry())).toBe(false);
    expect(everPublishedOnRecord(null)).toBe(false);
  });

  it("does not treat an unparseable value as a publication", () => {
    // Freezing is permanent for the session, so a value that does not describe a moment in time
    // must not buy it. A serialized marker goes through the same parse as a decoded one: taking a
    // string on trust for being non-empty would let a malformed value a custom `afterRead` hook
    // substituted freeze the slug of an entry that may never have been published.
    expect(everPublishedOnRecord(entry({ firstPublishedAt: "" }))).toBe(false);
    expect(
      everPublishedOnRecord(entry({ firstPublishedAt: "not a date" }))
    ).toBe(false);
    expect(
      everPublishedOnRecord(entry({ firstPublishedAt: new Date("nonsense") }))
    ).toBe(false);
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
    // Most collections are not localized; the cases that turn this on say so.
    collectionLocalized: false,
    defaultLocale: "en",
    mutationPending: false,
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

  it("treats the default language the same whether it is implicit or named", () => {
    // The editor represents the default language as `undefined` until the switcher is touched and
    // as its explicit code afterwards. They are one address, so a latch written under one must be
    // found under the other — otherwise leaving the default language and returning unfreezes a
    // slug that was public.
    const draftEverywhere = entry({
      status: "draft",
      _translations: {
        en: { translated: true, status: "draft" },
        de: { translated: true, status: "draft" },
      },
    });
    const { result, rerender } = render(
      perLocale({ entry: entry(EN_LIVE_DE_DRAFT), locale: undefined })
    );
    expect(result.current).toBe(true);

    // Unpublished, then the author visits German and comes back — this time picking "en" from the
    // switcher, which reports the explicit code rather than undefined.
    rerender(perLocale({ entry: draftEverywhere, locale: undefined }));
    rerender(perLocale({ entry: draftEverywhere, locale: "de" }));
    rerender(perLocale({ entry: draftEverywhere, locale: "en" }));

    expect(result.current).toBe(true);
  });

  it("does not remember a publish that is still in flight", () => {
    // The update hook writes the pending status into the query cache optimistically and restores
    // the previous entry if the request fails. A latch cannot roll back with it, so recording an
    // unconfirmed publish would freeze a draft's slug permanently — and make its editor warn about
    // a public URL that does not exist — until the editor is remounted.
    const { result, rerender } = render(
      shared({
        entry: entry({ status: "published" }),
        mutationPending: true,
      })
    );
    // Frozen while the write is in flight, which is right if it succeeds.
    expect(result.current).toBe(true);

    // The server refuses it and the cache rolls back to the draft.
    rerender(shared({ entry: entry({ status: "draft" }) }));

    expect(result.current).toBe(false);
  });

  it("remembers a publish once the write has settled", () => {
    // The mirror, so the guard above cannot be satisfied by never latching at all.
    const { result, rerender } = render(
      shared({ entry: entry({ status: "published" }), mutationPending: false })
    );
    expect(result.current).toBe(true);

    rerender(shared({ entry: entry({ status: "draft" }) }));

    expect(result.current).toBe(true);
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

  it("freezes a shared slug on a fresh mount when the row records a publication", () => {
    // The sequence the session latch cannot see: publish, unpublish, RELOAD, retitle. The reload
    // discards the latch, so before the row recorded anything this remounted editor believed it was
    // looking at an entry that had never been public and handed its URL back to the generator.
    const { result } = render(
      shared({
        entry: entry({
          status: "draft",
          firstPublishedAt: "2026-02-01T10:00:00Z",
        }),
      })
    );

    expect(result.current).toBe(true);
  });

  it("leaves a localized slug free even when the entry has been public elsewhere", () => {
    // The marker lives on the main row, so it answers "public in SOME language". A slug the author
    // opted into localizing is genuinely per-language: German's own address has never been served,
    // and freezing it because English once was would take away auto-slug for no reason.
    const { result } = render(
      perLocale({
        entry: entry({
          ...EN_LIVE_DE_DRAFT,
          firstPublishedAt: "2026-02-01T10:00:00Z",
        }),
        locale: "de",
      })
    );

    expect(result.current).toBe(false);
  });

  it("is unchanged for a draft whose row records no publication", () => {
    // The marker may only ever ADD freezing. An entry that has genuinely never been published, and
    // every row written before the column existed, must behave exactly as they did before.
    const { result } = render(
      shared({ entry: entry({ status: "draft", firstPublishedAt: null }) })
    );

    expect(result.current).toBe(false);
  });

  it("keeps the freeze when a later response omits the marker", () => {
    // Not every response shape carries every system column, and one that drops the key must not be
    // read as a row that was never published — that would unfreeze a live URL mid-edit. The marker
    // is a committed server value rather than an optimistic one, so it is latched on sight.
    const { result, rerender } = render(
      shared({
        entry: entry({
          status: "draft",
          firstPublishedAt: "2026-02-01T10:00:00Z",
        }),
      })
    );
    expect(result.current).toBe(true);

    rerender(shared({ entry: entry({ status: "draft" }) }));

    expect(result.current).toBe(true);
  });
});

describe("previewLinkLocale", () => {
  it("scopes a default-language link to the default locale", () => {
    // The editor spells the default language as `undefined`, and an absent
    // locale claim authorizes every locale — so passing the sentinel through
    // would hand a reviewer of the English draft every other translation too.
    expect(
      previewLinkLocale({
        localized: true,
        locale: undefined,
        defaultLocale: "en",
      })
    ).toEqual({ kind: "scoped", locale: "en" });
  });

  it("scopes a translation link to the language being edited", () => {
    expect(
      previewLinkLocale({ localized: true, locale: "de", defaultLocale: "en" })
    ).toEqual({ kind: "scoped", locale: "de" });
  });

  it("leaves a non-localized collection unscoped", () => {
    // No locale to name and no translations to leak.
    expect(
      previewLinkLocale({
        localized: false,
        locale: undefined,
        defaultLocale: "en",
      })
    ).toEqual({ kind: "unscoped" });
  });

  it("reports a blank default locale as unresolved, not as unscoped", () => {
    // `useLocalization` reports `""` before the config loads. Treating that as
    // unscoped would mint the all-locales token; sending it as a claim is a
    // 400. It is a third outcome and the caller has to see it as one.
    expect(
      previewLinkLocale({
        localized: true,
        locale: undefined,
        defaultLocale: "",
      })
    ).toEqual({ kind: "unresolved" });
    expect(
      previewLinkLocale({
        localized: true,
        locale: undefined,
        defaultLocale: "   ",
      })
    ).toEqual({ kind: "unresolved" });
    expect(
      previewLinkLocale({
        localized: true,
        locale: undefined,
        defaultLocale: undefined,
      })
    ).toEqual({ kind: "unresolved" });
  });

  it("never reports unscoped for a localized collection", () => {
    // The property the leak turned on: `unscoped` means "no locale claim", and
    // a localized entry must never produce one whatever the inputs are.
    for (const args of [
      { localized: true, locale: undefined, defaultLocale: "en" },
      { localized: true, locale: "de", defaultLocale: "en" },
      { localized: true, locale: undefined, defaultLocale: "" },
      { localized: true, locale: undefined, defaultLocale: undefined },
    ]) {
      expect(previewLinkLocale(args).kind, JSON.stringify(args)).not.toBe(
        "unscoped"
      );
    }
  });

  it("agrees on the two spellings of the default language", () => {
    expect(
      previewLinkLocale({
        localized: true,
        locale: undefined,
        defaultLocale: "en",
      })
    ).toEqual(
      previewLinkLocale({ localized: true, locale: "en", defaultLocale: "en" })
    );
  });
});

describe("previewLinkSiteUrl", () => {
  it("prefers the configured site over the browser origin", () => {
    // An admin panel mounted on a different host from the site would otherwise
    // hand out links pointing at itself.
    expect(
      previewLinkSiteUrl({
        configured: "https://site.example",
        origin: "https://admin.example",
      })
    ).toBe("https://site.example");
  });

  it("falls back to the browser origin when nothing is configured", () => {
    // Usually right, since the common deployment serves both together, and
    // always better than a relative path that identifies no host at all.
    expect(
      previewLinkSiteUrl({ configured: null, origin: "https://admin.example" })
    ).toBe("https://admin.example");
  });

  it("treats a cleared setting as absent, not as an empty base", () => {
    // The settings form stores "" for a field the user cleared; using it as a
    // base would rebuild the relative path this exists to prevent.
    expect(
      previewLinkSiteUrl({ configured: "   ", origin: "https://admin.example" })
    ).toBe("https://admin.example");
  });

  it("returns nothing rather than inventing a host", () => {
    // With no configured site and no origin there is no honest absolute URL,
    // so the existing relative behaviour stands.
    expect(
      previewLinkSiteUrl({ configured: null, origin: undefined })
    ).toBeUndefined();
  });

  it("never yields a relative value when either source is present", () => {
    // The property the control depends on: "Copy shareable link" must not put
    // a path on the clipboard whenever anything can name a host.
    for (const args of [
      { configured: "https://a.example", origin: undefined },
      { configured: null, origin: "https://b.example" },
      { configured: "https://a.example", origin: "https://b.example" },
    ]) {
      const result = previewLinkSiteUrl(args);
      expect(result, JSON.stringify(args)).toMatch(/^https?:\/\//);
    }
  });
});
