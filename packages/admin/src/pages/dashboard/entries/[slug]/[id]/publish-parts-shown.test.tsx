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
 * @module pages/dashboard/entries/[slug]/[id]/publish-parts-shown.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ShownCopy, ShownCopyHandle } from "@admin/lib/document-version";

import { renderWithProviders } from "../../../../../__tests__/utils";

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
      EntryForm: ({
        shownCopy,
        smartPublish,
      }: {
        shownCopy?: ShownCopyHandle;
        smartPublish?: unknown;
      }) => {
        handed.smartPublish = smartPublish;
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
    data: {
      name: "posts",
      label: "Posts",
      slug: "posts",
      status: true,
      localized: true,
    },
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

import EditEntryPage from "./index";

/** A site in English and Spanish. */
function inTwoLanguages(): void {
  site.defaultLocale = "en";
  site.enabled = true;
  site.locales = [
    { code: "en", label: "English" },
    { code: "es", label: "Spanish" },
  ];
}

beforeEach(() => {
  handed.shown = undefined;
  handed.smartPublish = undefined;
  site.defaultLocale = undefined;
  site.enabled = false;
  site.locales = [];
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

describe("what the entry's Publish runs", () => {
  it("is handed to the editor of an entry in several languages", async () => {
    inTwoLanguages();
    const { findByText } = renderWithProviders(
      <EditEntryPage params={{ slug: "posts", id: "42" }} />
    );
    await findByText("default entry form");

    expect(handed.smartPublish).toBeTypeOf("function");
  });

  it("stays the editor's own on a site in one language", async () => {
    const { findByText } = renderWithProviders(
      <EditEntryPage params={{ slug: "posts", id: "42" }} />
    );
    await findByText("default entry form");

    expect(handed.smartPublish).toBeUndefined();
  });
});
