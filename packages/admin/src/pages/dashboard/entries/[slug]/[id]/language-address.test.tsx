/**
 * The entry editor's page moves an address naming a language on, telling the
 * move what it needs of the page: which document it opens, whether that
 * document keeps text per language, the document view on screen and a copy
 * under way. Each is wired here; what the move does with them is its own test.
 *
 * @module pages/dashboard/entries/[slug]/[id]/language-address.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../../../../__tests__/utils";

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
vi.mock("@admin/hooks/queries/useDocumentLock", () => ({
  useDocumentLock: () => ({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
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
vi.mock("@admin/hooks/queries/useCollections", () => ({
  useCollectionSchema: () => ({
    data: {
      name: "posts",
      label: "Posts",
      slug: "posts",
      status: true,
      fields: [],
      localized: page.localized,
    },
    isLoading: true,
    error: null,
  }),
}));
// When the entry's reads start: entry-read-start's own concern, ready here.
vi.mock("@admin/hooks/queries/entry-read-start", () => ({
  useEntryReadStart: () => ({ ready: true, draft: false }),
}));
vi.mock("@admin/hooks/queries/useEntry", () => ({
  useEntry: () => ({ data: undefined, isLoading: true, error: null }),
}));
vi.mock("@admin/hooks/queries/useStoredReferences", () => ({
  useStoredEntry: () => ({ data: undefined, isLoading: true, error: null }),
  useWithStoredReferences: () => ({
    document: undefined,
    isLoading: true,
    error: null,
    latest: undefined,
  }),
}));
vi.mock("@admin/hooks/useUpdateAnswer", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useUpdateAnswer")>()),
  useUpdateAnswer: () => "allowed",
}));
vi.mock("@admin/hooks/useCanRequest", () => ({
  useCanRequest: () => true,
  useAsksTranslationStatus: () => false,
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ defaultLocale: "en", enabled: true, locales: [] }),
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

import EditEntryPage from "./index";

beforeEach(() => {
  redirect.mockReset();
  page.localized = true;
  page.seedFromLocale = undefined;
});

describe("an entry's address naming a language", () => {
  it("is moved on for the entry on screen", () => {
    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);
    expect(redirect).toHaveBeenLastCalledWith({
      document: { kind: "collection", slug: "posts", id: "42" },
      localized: true,
      view: undefined,
      copyingFrom: undefined,
    });
  });

  it("is told of a view, a copy under way and an entry with one text", () => {
    page.localized = false;
    page.seedFromLocale = "es";
    renderWithProviders(
      <EditEntryPage params={{ slug: "posts", id: "42", view: "builder" }} />
    );
    expect(redirect).toHaveBeenLastCalledWith({
      document: { kind: "collection", slug: "posts", id: "42" },
      localized: false,
      view: "builder",
      copyingFrom: "es",
    });
  });
});
