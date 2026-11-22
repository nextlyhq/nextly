/**
 * The page's "Choose what to publish…" sends what the editor's copy started from, as the editor's
 * own Publish every language does: the copy the editor shows is handed to the action, so a publish
 * of chosen parts made over a newer change than the one on screen is refused as stale.
 *
 * The plausible broken page builds the action without the editor's copy, so the publish reads the
 * server's version just before it is sent and never compares it with what the editor shows. The
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

/** What the page handed the publish-parts action. */
const handed = vi.hoisted(() => ({
  shown: undefined as undefined | (() => ShownCopy | undefined),
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
    SingleForm: ({ shownCopy }: { shownCopy?: ShownCopyHandle }) => {
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
  useLocalization: () => ({ defaultLocale: undefined, enabled: false }),
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

beforeEach(() => {
  handed.shown = undefined;
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
