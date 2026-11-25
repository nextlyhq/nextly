/**
 * The page's "Choose what to publish…" sends what the editor's copy started from: the copy the
 * editor shows is handed to the action, so a publish of chosen parts made over a newer change
 * than the one on screen is refused as stale. And on a document in several languages, what
 * Publish runs is handed to the editor.
 *
 * The plausible broken page builds the action without the editor's copy, so the publish reads the
 * server's version just before it is sent and never compares it with what the editor shows; or
 * leaves the editor's Publish as it is, publishing past another language's waiting change. The
 * form is replaced by one that hands up a copy; the page's wiring is the code under test.
 *
 * @module pages/dashboard/singles/[slug]/publish-parts-shown.test
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ShownCopy, ShownCopyHandle } from "@admin/lib/document-version";

import { renderWithProviders } from "../../../../__tests__/utils";

type Query = { data: unknown; isLoading: boolean; error: Error | null };

let schemaQuery: Query;
let documentQuery: {
  document: unknown;
  isLoading: boolean;
  error: Error | null;
  sourceDoc: unknown;
  isNonDefaultLocale: boolean;
};

/** What the page handed the publish-parts action, and its editor. */
const handed = vi.hoisted(() => ({
  shown: undefined as undefined | (() => ShownCopy | undefined),
  smartPublish: undefined as unknown,
}));

/** The site's languages: none, until a test gives it some. */
const site = vi.hoisted(() => ({
  defaultLocale: undefined as string | undefined,
  enabled: false,
  locales: [] as { code: string; label: string }[],
}));

/** The copy the editor shows: older than the Single as stored. */
const ON_SCREEN: ShownCopy = { version: "2", locale: "es", draft: true };

vi.mock(
  "@admin/components/features/entries/publish-parts/usePublishPartsAction",
  () => ({
    usePublishPartsAction: (props: { shown?: () => ShownCopy | undefined }) => {
      handed.shown = props.shown;
      return { dialog: null, contributed: null };
    },
  })
);
vi.mock("@admin/components/features/singles", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/components/features/singles")>();
  return {
    ...actual,
    SingleForm: ({
      shownCopy,
      smartPublish,
    }: {
      shownCopy?: ShownCopyHandle;
      smartPublish?: unknown;
    }) => {
      handed.smartPublish = smartPublish;
      if (shownCopy) shownCopy.current = () => ON_SCREEN;
      return null;
    },
  };
});
vi.mock("@admin/hooks/queries/useSingles", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/hooks/queries/useSingles")>();
  return {
    ...actual,
    useSingleSchema: () => schemaQuery,
    useUpdateSingleDocument: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
  };
});
vi.mock("@admin/hooks/queries/useSingleEditorDocument", () => ({
  useSingleEditorDocument: () => documentQuery,
}));
vi.mock("@admin/components/features/releases/ScheduledReleaseBanner", () => ({
  ScheduledReleaseBanner: () => null,
}));
vi.mock("@admin/components/features/releases/ScheduleDocumentAction", () => ({
  useScheduleDocumentAction: () => ({ dialog: null, contributed: null }),
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => site,
}));
vi.mock("@admin/hooks/useEditorLocale", () => ({
  useEditorLocale: () => ({
    locale: undefined,
    changeLocale: vi.fn(),
    resetLocale: vi.fn(),
    seedFromLocale: vi.fn(),
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

/** A site in English and Spanish, whose Single is translated. */
function inTwoLanguages(): void {
  site.defaultLocale = "en";
  site.enabled = true;
  site.locales = [
    { code: "en", label: "English" },
    { code: "es", label: "Spanish" },
  ];
  schemaQuery = {
    ...schemaQuery,
    data: {
      slug: "home",
      label: "Home",
      fields: [],
      status: true,
      localized: true,
    },
  };
}

beforeEach(() => {
  handed.shown = undefined;
  handed.smartPublish = undefined;
  site.defaultLocale = undefined;
  site.enabled = false;
  site.locales = [];
  schemaQuery = {
    data: {
      slug: "home",
      label: "Home",
      fields: [],
      status: true,
      localized: false,
    },
    isLoading: false,
    error: null,
  };
  documentQuery = {
    document: { id: "home-row", _rev: "3" },
    isLoading: false,
    error: null,
    sourceDoc: undefined,
    isNonDefaultLocale: false,
  };
});

describe("choosing what to publish on a Single's page", () => {
  it("hands the action the copy the editor shows", () => {
    renderWithProviders(<SingleEditPage params={{ slug: "home" }} />);

    expect(handed.shown?.()).toEqual(ON_SCREEN);
  });
});

describe("what the Single's Publish runs", () => {
  it("is handed to the editor of a Single in several languages", () => {
    inTwoLanguages();
    renderWithProviders(<SingleEditPage params={{ slug: "home" }} />);

    expect(handed.smartPublish).toBeTypeOf("function");
  });

  it("stays the editor's own on a site in one language", () => {
    renderWithProviders(<SingleEditPage params={{ slug: "home" }} />);

    expect(handed.smartPublish).toBeUndefined();
  });
});
