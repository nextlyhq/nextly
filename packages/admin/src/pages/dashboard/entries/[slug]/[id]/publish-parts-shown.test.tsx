/**
 * The page's "Choose what to publish…" sends what the editor's copy started from, as the editor's
 * own Publish every language does: the copy the editor shows is handed to the action, so a publish
 * of chosen parts made over a newer change than the one on screen is refused as stale.
 *
 * The plausible broken page builds the action without the editor's copy, so the publish reads the
 * server's version just before it is sent and never compares it with what the editor shows. The
 * form is replaced by one that hands up a copy; the page's wiring is the code under test.
 *
 * @module pages/dashboard/entries/[slug]/[id]/publish-parts-shown.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ShownCopy, ShownCopyHandle } from "@admin/lib/document-version";

import { renderWithProviders } from "../../../../../__tests__/utils";

/** What the page handed the publish-parts action. */
const handed = vi.hoisted(() => ({
  shown: undefined as undefined | (() => ShownCopy | undefined),
}));

/** The copy the editor shows: older than the entry as stored. */
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
vi.mock(
  "@admin/components/features/entries/EntryForm",
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import("@admin/components/features/entries/EntryForm")
      >();
    return {
      ...actual,
      EntryForm: ({ shownCopy }: { shownCopy?: ShownCopyHandle }) => {
        if (shownCopy) shownCopy.current = () => ON_SCREEN;
        return <div>default entry form</div>;
      },
    };
  }
);
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
vi.mock("@admin/hooks/queries/useCollections", () => ({
  useCollectionSchema: () => ({
    data: { name: "posts", label: "Posts", slug: "posts", status: true },
    isLoading: false,
    error: null,
  }),
}));
// When the entry's reads start: entry-read-start's own concern, ready here.
vi.mock("@admin/hooks/queries/entry-read-start", () => ({
  useEntryReadStart: () => ({ ready: true, draft: false }),
}));
vi.mock("@admin/hooks/queries/useEntry", () => ({
  useEntry: () => ({
    data: { id: "42", title: "A post", _rev: "3" },
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@admin/hooks/queries/useStoredReferences", () => ({
  useStoredEntry: () => ({ data: undefined, isLoading: false, error: null }),
  useWithStoredReferences: ({
    populated,
  }: {
    populated: { data: unknown; isLoading: boolean; error: unknown };
  }) => ({
    document: populated.data,
    isLoading: populated.isLoading,
    error: populated.error,
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

import EditEntryPage from "./index";

beforeEach(() => {
  handed.shown = undefined;
});

describe("choosing what to publish on an entry's page", () => {
  it("hands the action the copy the editor shows", async () => {
    const { findByText } = renderWithProviders(
      <EditEntryPage params={{ slug: "posts", id: "42" }} />
    );
    await findByText("default entry form");

    expect(handed.shown?.()).toEqual(ON_SCREEN);
  });
});
