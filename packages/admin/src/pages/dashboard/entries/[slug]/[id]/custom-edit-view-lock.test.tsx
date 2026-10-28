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

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateAnswer } from "@admin/hooks/useUpdateAnswer";
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

// A marker, so whether the page draws the banner itself or hands it to the
// form can be told apart.
vi.mock("@admin/components/features/releases/ScheduledReleaseBanner", () => ({
  ScheduledReleaseBanner: () => <p>scheduled release banner</p>,
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
// here the page is handed the entry as the populated read gives it, unless a
// case sets `mergedEntry` to stand for a merge that differs from it.
let mergedEntry: Record<string, unknown> | undefined;
vi.mock("@admin/hooks/queries/useStoredReferences", () => ({
  useStoredEntry: () => ({ data: undefined, isLoading: false, error: null }),
  useWithStoredReferences: ({
    populated,
  }: {
    populated: { data: unknown; isLoading: boolean; error: unknown };
  }) => ({
    document: mergedEntry ?? populated.data,
    isLoading: populated.isLoading,
    error: populated.error,
  }),
}));
/** What the server's answer says about the user changing this collection. */
let updateAnswer: UpdateAnswer = "allowed";
vi.mock("@admin/hooks/useUpdateAnswer", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useUpdateAnswer")>()),
  useUpdateAnswer: () => updateAnswer,
}));
// The requests judged in other languages: allowed, so these cases stay
// about the claim.
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
  updateAnswer = "allowed";
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
  mergedEntry = undefined;
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
  it("is handed the entry as the API populated it, not the default form's placeholders", () => {
    // A placeholder for a link the editor cannot see is the default form's
    // own representation; a custom view keeps receiving the API's shape.
    mergedEntry = {
      id: "42",
      title: "A post",
      tags: [{ id: "t1", __restrictedReference: true }],
    };
    withCustomView();
    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);
    expect(customViewProps?.initialData).toEqual({ id: "42", title: "A post" });
  });

  it("leaves the default form the merged entry", () => {
    mergedEntry = {
      id: "42",
      title: "A post",
      tags: [{ id: "t1", __restrictedReference: true }],
    };
    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);
    expect(entryFormProps?.entry).toBe(mergedEntry);
  });

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

  it("makes no claim for a user who may only read, and hands the view a read-only page with its writes withheld", () => {
    // The server refuses such a user's claim, and its refusal would read as
    // "could not check whether anyone else is editing" over editable fields.
    // A view gates its own save on `actionsDisabled`, so that is withheld as
    // well as the fields.
    withCustomView();
    updateAnswer = "refused";

    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);

    expect(claimRequest()).toMatchObject({ enabled: false });
    expect(customViewProps?.documentLock).toEqual({
      readOnly: true,
      actionsDisabled: true,
    });
    expect(screen.getByTestId("document-lock-banner")).toHaveTextContent(
      "Your access lets you view this, but not change it."
    );
  });

  it("holds the view's writes while a language switch's answer is on its way", () => {
    // The answer on screen is the language moved from, which grants nothing in
    // the new one: the view's save stays withheld until that one's answer
    // arrives, with no reader's banner on its word.
    withCustomView();
    updateAnswer = "switching";

    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);

    expect(customViewProps?.documentLock).toEqual({
      readOnly: true,
      actionsDisabled: true,
    });
    expect(screen.queryByTestId("document-lock-banner")).toBeNull();
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

  it("says an entry a reader may not read is not found, as the server answers it", () => {
    // The server answers an entry the caller may not read exactly as a
    // missing one, 404 "Not found.", so the page says so and claims nothing.
    updateAnswer = "refused";
    entryQuery = {
      data: undefined,
      isLoading: false,
      error: new Error("Not found."),
    };

    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);

    // The server's message as it is, with nothing put in front of it.
    expect(screen.getByRole("alert")).toHaveTextContent(/^Not found\.$/);
    expect(screen.queryByTestId("document-lock-banner")).toBeNull();
    expect(claimRequest()).toMatchObject({ enabled: false });
  });

  it("tells an edit injection a reader's page holds its writes", () => {
    // Before/AfterEdit open on read as the editor does, so one written to
    // change the entry is told to hold its writes, as a custom view is.
    let slotProps: Record<string, unknown> | undefined;
    registerComponent(
      "@acme/notes/admin#BeforeEdit",
      (props: Record<string, unknown>) => {
        slotProps = props;
        return <div>before the editor</div>;
      }
    );
    collectionSchema = {
      ...collectionSchema,
      admin: { components: { BeforeEdit: "@acme/notes/admin#BeforeEdit" } },
    };
    updateAnswer = "refused";

    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);

    expect(screen.getByText("before the editor")).toBeInTheDocument();
    expect(slotProps?.documentLock).toEqual({
      readOnly: true,
      actionsDisabled: true,
    });
  });

  it("tells an edit injection to hold its writes while a language switch's answer is on its way", () => {
    let slotProps: Record<string, unknown> | undefined;
    registerComponent(
      "@acme/notes/admin#AfterEdit",
      (props: Record<string, unknown>) => {
        slotProps = props;
        return <div>after the editor</div>;
      }
    );
    collectionSchema = {
      ...collectionSchema,
      admin: { components: { AfterEdit: "@acme/notes/admin#AfterEdit" } },
    };
    updateAnswer = "switching";

    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);

    expect(screen.getByText("after the editor")).toBeInTheDocument();
    expect(slotProps?.documentLock).toEqual({
      readOnly: true,
      actionsDisabled: true,
    });
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

describe("the scheduled-release banner on the default editor", () => {
  it("is handed to the form to draw under its header, not drawn above it", () => {
    renderWithProviders(<EditEntryPage params={{ slug: "posts", id: "42" }} />);

    // The replaced form draws only its marker, so a banner on screen here
    // would be one the page drew above the form, where the header covers it.
    expect(screen.getByText("default entry form")).toBeInTheDocument();
    expect(
      screen.queryByText("scheduled release banner")
    ).not.toBeInTheDocument();
    render(<>{entryFormProps?.documentBanner}</>);
    expect(screen.getByText("scheduled release banner")).toBeInTheDocument();
  });
});
