// The worklist is the ONE surface that can lie by omission: a collection the
// server did not consult contributes no rows, and a list with no rows reads as
// "nothing to do". So the tests that matter here are the ones about what the
// screen says when it does NOT have the whole answer.
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { TranslationWorklist, metadataVerdict } from "../TranslationWorklist";

const useBranding = vi.fn();
const brandingStatus = vi.fn();
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
  useBrandingStatus: () => brandingStatus(),
}));

const worklistQuery = vi.fn();
vi.mock("@admin/hooks/queries/useTranslationWorklist", () => ({
  useTranslationWorklist: (...args: unknown[]) => worklistQuery(...args),
}));

const navigateTo = vi.fn();
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (path: string) => navigateTo(path),
}));

const LOCALES = {
  defaultLocale: "en",
  fallback: true,
  locales: [
    { code: "en", label: "English", rtl: false, fallbackLocale: [] },
    { code: "es", label: "Spanish", rtl: false, fallbackLocale: [] },
    { code: "ar", label: "Arabic", rtl: true, fallbackLocale: [] },
  ],
};

const ROW = {
  collection: "posts",
  collectionLabel: "Posts",
  id: "p1",
  title: "Ada Lovelace",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const META = {
  total: 1,
  page: 1,
  limit: 50,
  totalPages: 1,
  hasNext: false,
  hasPrev: false,
};

function settled(over: Record<string, unknown> = {}) {
  return {
    isPending: false,
    isError: false,
    error: null,
    data: { items: [ROW], meta: META },
    ...over,
  };
}

function renderWorklist(props: Record<string, unknown> = {}) {
  return render(
    <TranslationWorklist
      locale="es"
      state="missing"
      onLocaleChange={vi.fn()}
      onLocaleCorrected={vi.fn()}
      onStateChange={vi.fn()}
      {...props}
    />
  );
}

describe("TranslationWorklist", () => {
  beforeEach(() => {
    navigateTo.mockReset();
    useBranding.mockReturnValue({ locales: LOCALES });
    // Settled by default. Every case that is not ABOUT loading needs the
    // metadata to have arrived, or it renders skeletons and asserts nothing.
    brandingStatus.mockReturnValue({ isPending: false, isUnavailable: false });
    worklistQuery.mockReturnValue(settled());
  });

  it("says so when the app has no languages, rather than showing an empty list", () => {
    // A worklist on a single-language site is a list that can never have a row.
    // An empty table there is indistinguishable from a failed load.
    useBranding.mockReturnValue({ locales: undefined });
    renderWorklist();
    expect(screen.getByText(/no languages configured/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Documents needing translation" })
    ).toBeNull();
  });

  it("offers the translatable languages, never the source", () => {
    // The default language is what the others are translations OF. Offering it
    // as a target invites a worklist of documents translated into themselves.
    renderWorklist();
    expect(screen.getByRole("button", { name: "Spanish" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arabic" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "English" })).toBeNull();
  });

  it("asks for the first target language when the URL names none", () => {
    // Arriving from the sidebar there is no `?locale=`. Asking with `undefined`
    // leaves the query DISABLED, and a disabled query is pending forever — so
    // the page sat on skeletons until someone clicked the language it had
    // already highlighted.
    worklistQuery.mockClear();
    renderWorklist({ locale: undefined });
    expect(worklistQuery).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "es" })
    );
  });

  it("NAMES the collections the server could not consult", () => {
    // The defect this page exists to avoid. A collection left out contributes
    // no rows, and no rows reads as "nothing to do there" — which is
    // indistinguishable from the truth at a glance.
    worklistQuery.mockReturnValue(
      settled({
        data: {
          items: [ROW],
          meta: { ...META, hasNext: true, notConsulted: ["pages", "tags"] },
        },
      })
    );
    renderWorklist();
    expect(screen.getByText(/not everything was checked/i)).toBeInTheDocument();
    expect(screen.getByText(/pages, tags/)).toBeInTheDocument();
  });

  it("says nothing about omissions when everything was consulted", () => {
    // The separating case: a permanent caveat trains people to ignore it, so it
    // must appear only when it is true.
    renderWorklist();
    expect(screen.queryByText(/not everything was checked/i)).toBeNull();
  });

  it("says when it is showing only part of what was found", () => {
    // A collection with fifty-one outstanding documents returns fifty rows.
    // Reporting "50 documents" there presents a truncated backlog as a complete
    // one — the same lie as an unconsulted collection, one level down.
    worklistQuery.mockReturnValue(
      settled({ data: { items: [ROW], meta: { ...META, total: 51 } } })
    );
    renderWorklist();
    expect(screen.getByText(/of 51 documents/)).toBeInTheDocument();
  });

  it("does not qualify the count when it is showing everything", () => {
    // Asserted on the qualifier itself rather than on the word "Showing",
    // which is also the state filter's own label a few lines above.
    renderWorklist();
    expect(screen.queryByText(/of \d+ documents/)).toBeNull();
  });

  it("distinguishes an empty result from a failure", () => {
    worklistQuery.mockReturnValue(
      settled({ data: { items: [], meta: { ...META, total: 0 } } })
    );
    renderWorklist();
    expect(screen.getByText(/nothing not translated/i)).toBeInTheDocument();
  });

  it("hands a row to the editor in the target language, translating from the source", async () => {
    // BOTH params. With only the locale the editor opens in that language with
    // no source beside it — the ordinary editor, not the screen the row
    // promised.
    renderWorklist();
    await userEvent.click(
      screen.getByRole("button", { name: "Translate Ada Lovelace in Posts" })
    );
    expect(navigateTo).toHaveBeenCalledTimes(1);
    const path = navigateTo.mock.calls[0]?.[0] as string;
    expect(path).toContain("/admin/collections/posts/p1");
    expect(path).toContain("locale=es");
    expect(path).toContain("translate=en");
  });

  it("names each row's action for its own document", () => {
    // Read out of context — a screen reader stepping through the list — fifty
    // buttons all saying "Translate" name nothing at all.
    renderWorklist();
    expect(
      screen.getByRole("button", { name: "Translate Ada Lovelace in Posts" })
    ).toBeInTheDocument();
  });

  it("does not answer for the SOURCE language when a stale URL asks for it", () => {
    // `en` is a configured locale, so the server accepts it and answers
    // confidently: nothing is ever missing in the language everything is
    // written in. A link saved before the default locale changed is enough to
    // produce that, and nothing on screen would blame the language.
    worklistQuery.mockClear();
    renderWorklist({ locale: "en" });
    expect(worklistQuery).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "es" })
    );
  });

  it("puts the URL back in step with the language it actually answered for", () => {
    // Otherwise the address bar keeps naming a language the screen is not
    // showing, and a copied link reproduces the wrong view rather than this one.
    const onLocaleCorrected = vi.fn();
    const onLocaleChange = vi.fn();
    renderWorklist({ locale: "en", onLocaleCorrected, onLocaleChange });
    expect(onLocaleCorrected).toHaveBeenCalledWith("es");
    // And NOT through the reader's own callback, which pushes a history entry.
    // Pushing here keeps the impossible locale in history: Back restores it,
    // the correction fires again, and the reader cannot leave the page.
    expect(onLocaleChange).not.toHaveBeenCalled();
  });

  it("does not write a language into a URL that deliberately named none", () => {
    // Arriving from the sidebar with no `?locale=` is the ordinary path, not a
    // mistake to correct. Rewriting it there would push a history entry on
    // every visit to the page.
    const onLocaleCorrected = vi.fn();
    renderWorklist({ locale: undefined, onLocaleCorrected });
    expect(onLocaleCorrected).not.toHaveBeenCalled();
  });

  it("leaves a URL that names a real target exactly as it found it", () => {
    // The control: normalising must be triggered by an INVALID target, not by
    // every render, or the page rewrites its own URL in a loop.
    const onLocaleCorrected = vi.fn();
    renderWorklist({ locale: "ar", onLocaleCorrected });
    expect(onLocaleCorrected).not.toHaveBeenCalled();
  });

  it("explains an unconsulted collection without naming a cause it cannot know", () => {
    // The server reports two causes through one field: the fan-out cap, and a
    // collection whose read FAILED. Wording it as capacity tells someone with a
    // broken query that their site is too big — pointing away from the fault.
    worklistQuery.mockReturnValue(
      settled({
        data: {
          items: [ROW],
          meta: { ...META, notConsulted: ["orders"] },
        },
      })
    );
    renderWorklist();
    expect(screen.getByText(/orders/)).toBeInTheDocument();
    expect(
      screen.queryByText(/more collections than one request covers, so/i)
    ).toBeNull();
    expect(screen.getByText(/can.t be read just now/i)).toBeInTheDocument();
  });

  it("names the action by collection too, because titles repeat across them", () => {
    // This list deliberately spans collections, so two rows reading "Translate
    // Untitled" is the ordinary case. A button reached by keyboard is read
    // without its row, so the visible collection label does not reach the
    // person who most needs it.
    worklistQuery.mockReturnValue(
      settled({
        data: {
          items: [
            ROW,
            { ...ROW, collection: "pages", collectionLabel: "Pages", id: "p2" },
          ],
          meta: META,
        },
      })
    );
    renderWorklist();
    expect(
      screen.getByRole("button", { name: "Translate Ada Lovelace in Posts" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Translate Ada Lovelace in Pages" })
    ).toBeInTheDocument();
  });

  it("does not call an incomplete empty answer 'nothing'", () => {
    // "Nothing" is a claim about EVERYTHING, and may only be made when
    // everything was looked at. With no rows AND collections left unconsulted,
    // this is the one result indistinguishable from work nobody checked for.
    worklistQuery.mockReturnValue(
      settled({
        data: { items: [], meta: { ...META, notConsulted: ["orders"] } },
      })
    );
    renderWorklist();
    expect(
      screen.getByText(/in the collections that could be checked/i)
    ).toBeInTheDocument();
  });

  it("does say 'nothing in this language' when the answer WAS complete", () => {
    // The control. Hedging every empty result would make the honest one
    // unreadable, and "nothing to translate" is the answer a translator wants
    // to be able to trust.
    worklistQuery.mockReturnValue(settled({ data: { items: [], meta: META } }));
    renderWorklist();
    expect(
      screen.getByText(/nothing .* in this language/i)
    ).toBeInTheDocument();
  });

  it("🔴 never claims nothing needs review, even on a complete answer", () => {
    // Staleness compares two timestamps. A language written before its collection began recording
    // them has none to compare, so the comparison returns no match — exactly as it does for a
    // language that is genuinely current. Every collection can therefore be checked and the answer
    // still not cover every row, which makes the unqualified claim one this tab can never make.
    //
    // The other four states CAN make it, which is why this is not a blanket hedge: "nothing to
    // translate" is the answer a translator needs to be able to trust, and the control below keeps
    // it readable.
    worklistQuery.mockReturnValue(settled({ data: { items: [], meta: META } }));
    renderWorklist({ state: "stale" });
    expect(screen.getByText(/known to need review/i)).toBeInTheDocument();
  });

  it("names the migration remedy the server chose, not a hardcoded one", () => {
    // 🔴 `nextly migrate` applies migration FILES. A development database kept in step by the sync
    // and reload loop has no migration history carrying this column, so that advice leaves the
    // notice unchanged after a developer follows it. The server knows which case it is in; this
    // screen does not, so it renders what it was told.
    worklistQuery.mockReturnValue(
      settled({
        data: {
          items: [],
          meta: {
            ...META,
            unanswerable: ["legacy"],
            unanswerableRemedy: "sync" as const,
          },
        },
      })
    );
    renderWorklist({ state: "stale" });
    expect(screen.getByText(/db:sync/i)).toBeInTheDocument();
    expect(screen.queryByText(/nextly migrate/i)).not.toBeInTheDocument();
  });

  it("waits for the workspace metadata before declaring the app single-language", () => {
    // The locale config arrives with the workspace query, and `useLocalization`
    // reports `enabled: false` while it is in flight — the same value a real
    // single-language install produces. Announcing "no languages" here tells a
    // translator on a cold load that their configuration is gone.
    brandingStatus.mockReturnValue({ isPending: true, isUnavailable: false });
    useBranding.mockReturnValue({ locales: undefined });
    renderWorklist();
    expect(screen.queryByText(/no languages configured/i)).toBeNull();
  });

  it("says the metadata failed rather than that the app has one language", () => {
    // Different situations, opposite reactions: one is an operator's problem
    // with the workspace request, the other is a configuration choice. The
    // worklist endpoint may be perfectly healthy in the first.
    brandingStatus.mockReturnValue({ isPending: false, isUnavailable: true });
    useBranding.mockReturnValue({ locales: undefined });
    renderWorklist();
    expect(
      screen.getByText(/couldn.t load this app.s languages/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/no languages configured/i)).toBeNull();
  });

  it("still says so when the app really does have one language", () => {
    // The control for both cases above: once the metadata has SETTLED and says
    // there is one language, that is a fact and the page should state it.
    brandingStatus.mockReturnValue({ isPending: false, isUnavailable: false });
    useBranding.mockReturnValue({ locales: undefined });
    renderWorklist();
    expect(screen.getByText(/no languages configured/i)).toBeInTheDocument();
  });

  it("names the list for the filter in force, not for the page's purpose", () => {
    // Under Translated or Published every row is FINISHED work. Announcing
    // them as "documents needing translation" tells a screen-reader user the
    // opposite of what the list holds, and the visible tabs cannot correct it
    // for someone who lands on the list directly.
    renderWorklist({ state: "translated" });
    expect(
      screen.getByRole("list", { name: "Translated documents" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: /needing translation/i })
    ).toBeNull();
  });
});

describe("metadataVerdict", () => {
  it("reports loading before anything else, because nothing else is known yet", () => {
    // Order matters, and BOTH flags are set here on purpose: a retry in flight
    // after an earlier failure is pending AND unavailable at once. Reporting
    // the failure then would show an error over a request that may be about to
    // succeed. With only one flag set, either precedence passes and the case
    // proves nothing.
    expect(
      metadataVerdict({ pending: true, unavailable: true, enabled: false })
    ).toBe("pending");
  });

  it("distinguishes a failed request from a configuration choice", () => {
    expect(
      metadataVerdict({ pending: false, unavailable: true, enabled: false })
    ).toBe("unavailable");
  });

  it("calls it single-language only once the app has answered", () => {
    expect(
      metadataVerdict({ pending: false, unavailable: false, enabled: false })
    ).toBe("single-language");
  });

  it("is ready when the languages are known", () => {
    // The control: a verdict that never returns "ready" would render a notice
    // over a perfectly good worklist.
    expect(
      metadataVerdict({ pending: false, unavailable: false, enabled: true })
    ).toBe("ready");
  });
});
