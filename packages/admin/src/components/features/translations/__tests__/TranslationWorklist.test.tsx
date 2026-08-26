// The worklist is the ONE surface that can lie by omission: a collection the
// server did not consult contributes no rows, and a list with no rows reads as
// "nothing to do". So the tests that matter here are the ones about what the
// screen says when it does NOT have the whole answer.
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { TranslationWorklist } from "../TranslationWorklist";

const useBranding = vi.fn();
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
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
      onStateChange={vi.fn()}
      {...props}
    />
  );
}

describe("TranslationWorklist", () => {
  beforeEach(() => {
    navigateTo.mockReset();
    useBranding.mockReturnValue({ locales: LOCALES });
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
      screen.getByRole("button", { name: "Translate Ada Lovelace" })
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
      screen.getByRole("button", { name: "Translate Ada Lovelace" })
    ).toBeInTheDocument();
  });
});
