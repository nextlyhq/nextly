/**
 * The Single editor's page moves an address naming a language on, telling the
 * move what it needs of the page: which document it opens, whether that
 * document keeps text per language, the document view on screen and a copy
 * under way. Each is wired here; what the move does with them is its own test.
 *
 * @module pages/dashboard/singles/[slug]/language-address.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../../../__tests__/utils";

const redirect = vi.hoisted(() => vi.fn());
vi.mock(
  "@admin/components/features/translations/page/useLanguageAddressRedirect",
  () => ({ useLanguageAddressRedirect: redirect })
);

const page = vi.hoisted(() => ({
  localized: true,
  seedFromLocale: undefined as string | undefined,
}));

// The page stays on its loading outline: the move is asked for above it.
vi.mock("@admin/hooks/queries/useSingles", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries/useSingles")>()),
  useSingleSchema: () => ({
    data: {
      slug: "home",
      label: "Home",
      fields: [],
      localized: page.localized,
    },
    isLoading: true,
    error: null,
  }),
  useUpdateSingleDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useSingleEditorDocument", () => ({
  useSingleEditorDocument: () => ({
    document: undefined,
    isLoading: true,
    error: null,
    sourceDoc: undefined,
    isNonDefaultLocale: false,
  }),
}));
vi.mock("@admin/components/features/releases/ScheduledReleaseBanner", () => ({
  ScheduledReleaseBanner: () => null,
}));
vi.mock("@admin/components/features/releases/ScheduleDocumentAction", () => ({
  useScheduleDocumentAction: () => ({ dialog: null, contributed: null }),
}));
vi.mock(
  "@admin/components/features/entries/publish-parts/usePublishPartsAction",
  () => ({ usePublishPartsAction: () => ({ dialog: null, contributed: null }) })
);
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    defaultLocale: "en",
    enabled: true,
    locales: [],
    getLocale: () => undefined,
  }),
}));
vi.mock("@admin/hooks/useEditorLocale", () => ({
  useEditorLocale: () => ({
    locale: undefined,
    changeLocale: vi.fn(),
    resetLocale: vi.fn(),
    seedFromLocale: page.seedFromLocale,
    clearSeed: vi.fn(),
  }),
}));
vi.mock("@admin/hooks/useTranslationMode", () => ({
  useTranslationMode: () => ({
    translateFrom: undefined,
    enterTranslationMode: vi.fn(),
    exitTranslationMode: vi.fn(),
  }),
}));

import SingleEditPage from "./index";

beforeEach(() => {
  redirect.mockReset();
  page.localized = true;
  page.seedFromLocale = undefined;
});

describe("a Single's address naming a language", () => {
  it("is moved on for the Single on screen", () => {
    renderWithProviders(<SingleEditPage params={{ slug: "home" }} />);
    expect(redirect).toHaveBeenLastCalledWith({
      document: { kind: "single", slug: "home" },
      localized: true,
      view: undefined,
      copyingFrom: undefined,
    });
  });

  it("is told of a view, a copy under way and a Single with one text", () => {
    page.localized = false;
    page.seedFromLocale = "es";
    renderWithProviders(
      <SingleEditPage params={{ slug: "home", view: "builder" }} />
    );
    expect(redirect).toHaveBeenLastCalledWith({
      document: { kind: "single", slug: "home" },
      localized: false,
      view: "builder",
      copyingFrom: "es",
    });
  });
});
