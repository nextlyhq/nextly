/**
 * A custom edit view takes the same claim the default editor takes.
 *
 * The page returns its custom-view branch before `EntryForm` mounts, and
 * `EntryForm` is where the default editor claims. Everything here is about
 * which branch does the claiming, so `EntryForm` is replaced by a marker and
 * the lock hook is the real one, observed through the request it makes.
 *
 * @module pages/dashboard/entries/[slug]/[id]/custom-edit-view-lock.test
 */

import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearRegistry,
  registerComponent,
} from "@admin/lib/plugins/component-registry";

import { renderWithProviders } from "../../../../../__tests__/utils";

const useDocumentLock = vi.fn();
vi.mock("@admin/hooks/queries/useDocumentLock", () => ({
  useDocumentLock: (options: unknown) => useDocumentLock(options) as unknown,
}));

// Replaced, not mocked away: the barrel also exports the banner and the surface
// hook this page now uses, and those are the code under test.
vi.mock(
  "@admin/components/features/entries/EntryForm",
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import("@admin/components/features/entries/EntryForm")
      >();
    return { ...actual, EntryForm: () => <div>default entry form</div> };
  }
);

vi.mock("@admin/components/features/releases/ScheduledReleaseBanner", () => ({
  ScheduledReleaseBanner: () => null,
}));
vi.mock("@admin/components/features/releases/AddToReleaseAction", () => ({
  useAddToReleaseAction: () => ({ dialog: null, contributed: null }),
}));

let collectionSchema: Record<string, unknown> = {};
vi.mock("@admin/hooks/queries/useCollections", () => ({
  useCollectionSchema: () => ({
    data: collectionSchema,
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@admin/hooks/queries/useEntry", () => ({
  useEntry: () => ({
    data: { id: "42", title: "A post" },
    isLoading: false,
    error: null,
  }),
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
vi.mock("@admin/hooks/usePluginAutoRegistration", () => ({
  usePluginAutoRegistration: () => undefined,
}));

import EditEntryPage from "./index";

const CUSTOM_VIEW = "@acme/shop/admin#ProductEditor";
const takeOver = vi.fn();

/** The claim the page asked for, whichever branch asked. */
function claimRequest(): Record<string, unknown> {
  const last = useDocumentLock.mock.calls.at(-1);
  if (last === undefined) throw new Error("the lock hook was never called");
  return last[0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentLock.mockReturnValue({
    state: { status: "held-by-me" },
    takeOver,
  });
  collectionSchema = { name: "posts", label: "Posts", slug: "posts" };
});

afterEach(() => {
  clearRegistry();
});

describe("a custom collection edit view", () => {
  it("claims the document it is editing", () => {
    registerComponent(CUSTOM_VIEW, () => <div>bespoke product editor</div>);
    collectionSchema = {
      ...collectionSchema,
      admin: { components: { views: { Edit: { Component: CUSTOM_VIEW } } } },
    };

    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);

    expect(screen.getByText("bespoke product editor")).toBeInTheDocument();
    expect(claimRequest()).toMatchObject({
      scopeKind: "collection",
      slug: "posts",
      entryId: "42",
      enabled: true,
    });
  });

  it("names the colleague who has it, and offers to take it over", () => {
    registerComponent(CUSTOM_VIEW, () => <div>bespoke product editor</div>);
    collectionSchema = {
      ...collectionSchema,
      admin: { components: { views: { Edit: { Component: CUSTOM_VIEW } } } },
    };
    useDocumentLock.mockReturnValue({
      state: {
        status: "held-by-other",
        holder: { ownerId: "u2", ownerLabel: "Ada", expiresInSeconds: 90 },
      },
      takeOver,
    });

    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);

    const banner = screen.getByTestId("document-lock-banner");
    expect(banner).toHaveTextContent("Ada");
  });

  it("leaves the claim to the form when there is no custom view", () => {
    // 🔴 The page must not claim on this branch. `EntryForm` claims for the
    // default editor, and a second claim here would put two on one document
    // under one author, which the repository keys and releases separately.
    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);

    expect(screen.getByText("default entry form")).toBeInTheDocument();
    expect(claimRequest()).toMatchObject({ enabled: false });
  });

  it("leaves it to the form when a registered view resolves to nothing", () => {
    // The path is declared but the component never registered, so the page
    // falls through to `EntryForm` - and the claim has to follow the branch
    // that actually renders, not the one the schema advertises.
    collectionSchema = {
      ...collectionSchema,
      admin: { components: { views: { Edit: { Component: CUSTOM_VIEW } } } },
    };

    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);

    expect(screen.getByText("default entry form")).toBeInTheDocument();
    expect(claimRequest()).toMatchObject({ enabled: false });
  });
});
