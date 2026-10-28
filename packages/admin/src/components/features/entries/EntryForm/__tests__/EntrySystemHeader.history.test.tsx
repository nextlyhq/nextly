/**
 * The history control is offered only when there is history to look at and a
 * schema to render it with. Offering it otherwise leads to a panel that can
 * only report emptiness or fail.
 */
import userEvent from "@testing-library/user-event";
import type { FieldConfig } from "nextly/config";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

const { sheetMock, history } = vi.hoisted(() => ({
  sheetMock: vi.fn(),
  /** Whether the server answers that the user may read the whole history. */
  history: { readable: true },
}));

vi.mock("@admin/hooks/useCanRequest", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useCanRequest")>()),
  useCanRequest: (_slug: string, request: string) =>
    request !== "readHistory" || history.readable,
}));

vi.mock("@admin/components/features/versions/VersionHistorySheet", () => ({
  VersionHistorySheet: (props: Record<string, unknown>) => {
    sheetMock(props);
    return null;
  },
}));

import { HeaderUnderTest as EntrySystemHeader } from "./header-under-test";

/**
 * The header reads form state through context, so it is given a real form
 * rather than a stubbed one — a partial stub misses the ref plumbing that
 * `register` returns and fails for reasons unrelated to what is under test.
 */
function WithForm({ children }: { children: ReactNode }) {
  const form = useForm();
  return <FormProvider {...form}>{children}</FormProvider>;
}

const fields = [{ name: "title", type: "text" }] as FieldConfig[];

function renderHeader(overrides: Record<string, unknown> = {}) {
  return render(
    <WithForm>
      <EntrySystemHeader
        mode="edit"
        hasStatus={false}
        collectionSlug="posts"
        entry={{ id: "e1" } as never}
        historyFields={fields}
        isSubmitting={false}
        isDirty={false}
        {...overrides}
      />
    </WithForm>
  );
}

describe("EntrySystemHeader version history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    history.readable = true;
  });

  it("offers history for a saved document", () => {
    renderHeader();

    expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument();
  });

  it("does not offer history to a user who may not read it in every language", () => {
    // The history is read in every language, as the server judges it; a user
    // who may read only some languages would be refused it.
    history.readable = false;
    renderHeader();

    expect(
      screen.queryByRole("button", { name: "History" })
    ).not.toBeInTheDocument();
  });

  it("does not offer history for a document that was never saved", () => {
    // A create form has no entry id, so there is nothing to have history of.
    renderHeader({ mode: "create", entry: null });

    expect(
      screen.queryByRole("button", { name: "History" })
    ).not.toBeInTheDocument();
  });

  it("does not offer history without a schema to render it with", () => {
    renderHeader({ historyFields: undefined });

    expect(
      screen.queryByRole("button", { name: "History" })
    ).not.toBeInTheDocument();
  });

  it("does not offer history for an entity that records no versions", () => {
    // Writes only capture a snapshot when versioning is enabled, so offering
    // history elsewhere leads to a panel that can never fill.
    renderHeader({ historyEnabled: false });

    expect(
      screen.queryByRole("button", { name: "History" })
    ).not.toBeInTheDocument();
  });

  it("still offers history when the setting could not be determined", () => {
    // Hiding on an absent flag would silently remove the feature wherever the
    // schema payload omits it.
    renderHeader({ historyEnabled: undefined });

    expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument();
  });

  it("addresses a collection entry by its id", () => {
    renderHeader();

    expect(sheetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "collection", slug: "posts", entryId: "e1" },
      })
    );
  });

  it("tells the restore confirmation whether the editor holds unsaved work", () => {
    // The confirmation discloses unsaved work; the header forwards whatever
    // the editor reported rather than re-deriving it.
    renderHeader({ isDirty: true, hasUnsavedWork: true });

    expect(sheetMock).toHaveBeenCalledWith(
      expect.objectContaining({ liveDirty: true })
    );
  });

  it("does not count plain form dirtiness as the forwarded unsaved-work state", () => {
    // hasUnsavedWork is the richer flag — form dirtiness plus state a field
    // holds outside the form. isDirty alone must not satisfy the restore
    // confirmation's disclosure.
    renderHeader({ isDirty: true });

    expect(sheetMock).toHaveBeenCalledWith(
      expect.objectContaining({ liveDirty: false })
    );
  });
  it("addresses a Single by slug alone", () => {
    // A Single has one document and the server resolves its id, so no entry id
    // is sent even though the header has one.
    renderHeader({ scope: "single", collectionSlug: "settings" });

    // The document id travels for cache identity only, so a recreated Single
    // cannot be served its predecessor's cached history.
    expect(sheetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "single", slug: "settings", documentId: "e1" },
      })
    );
  });
});

const { actionBarProps } = vi.hoisted(() => ({
  actionBarProps: {
    current: null as { actions: { id: string }[] } | null,
  },
}));

// The action bar is where the withheld-write decision LANDS for the page's
// contributed actions: a prop passed to the wrong component type-checks
// perfectly, so the stand-in records what the header actually handed it.
// The module's other exports (the merge the header calls) stay real.
vi.mock(
  "@admin/components/features/entries/EntryForm/DocumentActionBar",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("@admin/components/features/entries/EntryForm/DocumentActionBar")
    >()),
    DocumentActionBar: (props: { actions: { id: string }[] }) => {
      actionBarProps.current = props;
      return null;
    },
  })
);

import {
  DocumentHistoryContext,
  type RestoreAffordance,
  type ViewedVersion,
} from "@admin/components/features/versions/document-history-context";
import type { ContributedAction } from "@admin/components/features/entries/EntryForm/DocumentActionBar";

const contributed: ContributedAction[] = [
  {
    action: {
      id: "add-to-release",
      label: "Add to release",
      placement: "menu",
    },
    binding: { onSelect: () => {} },
  },
];

describe("EntrySystemHeader — contributed actions while reading history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionBarProps.current = null;
  });

  function renderWithHistory(
    viewing: ViewedVersion | null,
    options: { restore?: RestoreAffordance; documentLocked?: boolean } = {}
  ) {
    return render(
      <WithForm>
        <DocumentHistoryContext.Provider
          value={{
            viewing,
            setViewing: () => {},
            restore: options.restore ?? null,
            setRestore: () => {},
          }}
        >
          <EntrySystemHeader
            mode="edit"
            hasStatus={false}
            collectionSlug="posts"
            entry={{ id: "e1" } as never}
            historyFields={fields}
            contributedActions={contributed}
            documentLocked={options.documentLocked ?? false}
          />
        </DocumentHistoryContext.Provider>
      </WithForm>
    );
  }

  it("offers the page's contributed actions while the live document is on screen", () => {
    renderWithHistory(null);

    expect(
      actionBarProps.current?.actions.some(a => a.id === "add-to-release")
    ).toBe(true);
  });

  it("draws the version's own actions in place of the document's while a version is being read", () => {
    // The document's verbs, a feature's contributions among them, act on the
    // LIVE document, which is not what is on screen. A contribution cannot be
    // expected to know about history, so the header replaces the whole bar
    // with the version's own actions rather than greying each control.
    renderWithHistory({
      versionNo: 3,
      snapshot: { title: "as it was" },
      locale: null,
      withheld: [],
      isLoading: false,
      error: null,
      scope: { kind: "collection", slug: "posts", entryId: "e1" },
      comparedWith: { kind: "first" },
      about: null,
    });

    expect(actionBarProps.current).toBeNull();
    expect(
      screen.getByRole("button", { name: "Back to current" })
    ).toBeInTheDocument();
  });

  describe("the version's own actions", () => {
    const shown: ViewedVersion = {
      versionNo: 3,
      snapshot: { title: "as it was" },
      locale: null,
      withheld: [],
      isLoading: false,
      error: null,
      scope: { kind: "collection", slug: "posts", entryId: "e1" },
      comparedWith: { kind: "first" },
      about: null,
    };
    const restore = (): RestoreAffordance => ({
      canRestore: true,
      request: vi.fn(),
      returnToCurrent: vi.fn(),
    });

    it("offers Back to current and Restore… where Save and Publish sat", async () => {
      const affordance = restore();
      renderWithHistory(shown, { restore: affordance });

      await userEvent.click(screen.getByRole("button", { name: "Restore…" }));
      expect(affordance.request).toHaveBeenCalledTimes(1);
      await userEvent.click(
        screen.getByRole("button", { name: "Back to current" })
      );
      expect(affordance.returnToCurrent).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByRole("button", { name: /save draft|publish/i })
      ).not.toBeInTheDocument();
    });

    it("withholds Restore… while a colleague holds the document", () => {
      renderWithHistory(shown, { restore: restore(), documentLocked: true });

      expect(
        screen.queryByRole("button", { name: "Restore…" })
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Back to current" })
      ).toBeInTheDocument();
    });

    it("holds Restore… until the version is on screen", () => {
      renderWithHistory(
        { ...shown, snapshot: undefined },
        { restore: restore() }
      );

      expect(screen.getByRole("button", { name: "Restore…" })).toBeDisabled();
    });
  });
});
