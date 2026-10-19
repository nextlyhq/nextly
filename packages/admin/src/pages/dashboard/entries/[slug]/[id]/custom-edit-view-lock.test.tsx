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
import {
  clearDocumentViews,
  registerDocumentViews,
} from "@admin/lib/plugins/document-view-registry";

import { renderWithProviders } from "../../../../../__tests__/utils";

const useDocumentLock = vi.fn();
/** What the page last handed the (replaced) default editor. */
let entryFormProps: Record<string, unknown> | undefined;
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
    return {
      ...actual,
      EntryForm: (props: Record<string, unknown>) => {
        entryFormProps = props;
        return <div>default entry form</div>;
      },
    };
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
let entryQuery: Record<string, unknown> = {};
vi.mock("@admin/hooks/queries/useEntry", () => ({
  useEntry: () => entryQuery,
}));
// The merge with the stored links is useStoredReferences.test.tsx's concern;
// here the page is handed the entry exactly as the populated read gives it.
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
let customViewProps: Record<string, unknown> | undefined;

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
  entryQuery = {
    data: { id: "42", title: "A post" },
    isLoading: false,
    error: null,
  };
  // Cleared, so a case reading these cannot pass on the previous case's render.
  customViewProps = undefined;
  entryFormProps = undefined;
});

/** Registers a custom view and points the collection at it. */
function withCustomView(body = "bespoke product editor") {
  registerComponent(CUSTOM_VIEW, (props: Record<string, unknown>) => {
    customViewProps = props;
    return <div>{body}</div>;
  });
  collectionSchema = {
    ...collectionSchema,
    admin: { components: { views: { Edit: { Component: CUSTOM_VIEW } } } },
  };
}

afterEach(() => {
  clearRegistry();
  clearDocumentViews();
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

  it("hands it what the claim withholds, so its own writes can honour it", () => {
    // 🔴 The banner this page renders says in words that unsaved changes cannot
    // be saved while a colleague holds the document. A view that writes anyway
    // makes that sentence false, so the same decision the banner was derived
    // from travels to the view through the props it already receives.
    withCustomView();
    useDocumentLock.mockReturnValue({
      state: {
        status: "held-by-other",
        holder: { ownerId: "u2", ownerLabel: "Ada", expiresInSeconds: 90 },
      },
      takeOver,
    });

    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);

    expect(customViewProps?.documentLock).toEqual({
      readOnly: true,
      actionsDisabled: true,
    });
  });

  it("withholds nothing while the claim is this editor's own", () => {
    withCustomView();

    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);

    expect(customViewProps?.documentLock).toEqual({
      readOnly: false,
      actionsDisabled: false,
    });
  });

  it("does not claim while the document is still loading", () => {
    // 🔴 A claim taken here heartbeats a document the editor is only seeing a
    // skeleton of, and colleagues are told this person is editing it.
    withCustomView();
    entryQuery = { data: undefined, isLoading: true, error: null };

    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);

    expect(claimRequest()).toMatchObject({ enabled: false });
  });

  it("does not claim when the document failed to load", () => {
    // The worse half of the same case: a persistent failure leaves colleagues
    // told this person is editing a page that never appeared, for as long as
    // they stay on the route.
    withCustomView();
    entryQuery = {
      data: undefined,
      isLoading: false,
      error: new Error("nope"),
    };

    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);

    expect(claimRequest()).toMatchObject({ enabled: false });
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

describe("a routed document view", () => {
  const VIEW = "@acme/pb/admin#Builder";

  it("is drawn by the form in place of the custom edit view, and leaves to the entry's edit address", () => {
    registerDocumentViews([
      { slug: "posts", path: "builder", component: VIEW },
    ]);
    withCustomView();

    renderWithProviders(
      <EditEntryPage params={{ slug: "posts", id: "42", view: "builder" }} />
    );

    // The form hosts the view, so the form's claim is the one taken.
    expect(screen.getByText("default entry form")).toBeInTheDocument();
    expect(screen.queryByText("bespoke product editor")).toBeNull();
    expect(claimRequest()).toMatchObject({ enabled: false });
    const documentView = entryFormProps?.documentView as
      | { component: string; onExit: () => void }
      | undefined;
    expect(documentView?.component).toBe(VIEW);

    documentView?.onExit();
    expect(window.location.pathname).toBe("/admin/collections/posts/42");
  });

  it("opens a field-type view on a collection with a top-level field of its type", () => {
    registerDocumentViews([
      { fieldType: "blocks", path: "builder", component: VIEW },
    ]);
    collectionSchema = {
      ...collectionSchema,
      fields: [
        { name: "title", type: "text" },
        { name: "body", type: "blocks" },
      ],
    };

    renderWithProviders(
      <EditEntryPage params={{ slug: "posts", id: "42", view: "builder" }} />
    );

    expect(screen.getByText("default entry form")).toBeInTheDocument();
    expect(
      (entryFormProps?.documentView as { component: string } | undefined)
        ?.component
    ).toBe(VIEW);
  });

  it("answers not found for a field-type view on a collection without the field", () => {
    registerDocumentViews([
      { fieldType: "blocks", path: "builder", component: VIEW },
    ]);
    // Only nested inside a group, which does not count.
    collectionSchema = {
      ...collectionSchema,
      fields: [
        { name: "title", type: "text" },
        {
          name: "extra",
          type: "group",
          fields: [{ name: "body", type: "blocks" }],
        },
      ],
    };

    renderWithProviders(
      <EditEntryPage params={{ slug: "posts", id: "42", view: "builder" }} />
    );

    expect(screen.queryByText("default entry form")).toBeNull();
    expect(screen.getByText(/This page doesn.t exist/)).toBeInTheDocument();
  });

  it("keeps the address's language when leaving the view, dropping only its field", () => {
    // The language is the document being edited: losing it on the way out
    // reloads another translation over unsaved edits.
    registerDocumentViews([
      { slug: "posts", path: "builder", component: VIEW },
    ]);
    window.history.pushState(
      null,
      "",
      "/admin/collections/posts/42/builder?locale=fr&field=body"
    );
    renderWithProviders(
      <EditEntryPage params={{ slug: "posts", id: "42", view: "builder" }} />
    );

    (entryFormProps?.documentView as { onExit: () => void }).onExit();

    expect(window.location.pathname).toBe("/admin/collections/posts/42");
    expect(window.location.search).toBe("?locale=fr");
  });

  it("hands the form no view on the plain edit address", () => {
    // The control: the same registry, the address without the segment.
    registerDocumentViews([
      { slug: "posts", path: "builder", component: VIEW },
    ]);

    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);

    expect(entryFormProps).toBeDefined();
    expect(entryFormProps?.documentView).toBeUndefined();
  });
});
