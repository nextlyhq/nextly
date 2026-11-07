// @vitest-environment jsdom

/**
 * Where Delete component is offered: in a saved component's document bar,
 * through the plugin's one toolbar slot, and on each row of the Components
 * list, whose tools draw the dialog for the row chosen. Neither is offered on
 * another collection's form, nor on a component not saved yet.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ComponentDeleteResult } from "../component-delete/contract";

/** A row action, as the list registry receives it. */
interface RowAction {
  readonly id: string;
  readonly destructive?: boolean;
  readonly isVisible?: (row: Record<string, unknown>) => boolean;
  readonly onSelect: (row: Record<string, unknown>) => void;
}

const rowActions: { target: string; action: RowAction }[] = [];
const navigated: string[] = [];
let identity: { kind: string; slug: string; documentId?: string } | null = null;
/** The editor's own actions, as `useDocumentActions` answers them. */
let editorActions: { actions: { id: string; disabledReason?: string }[] } = {
  actions: [{ id: "publish" }],
};
const resolved = {
  pagesCollection: "pages",
  layoutsCollection: "layouts",
  componentsCollection: "site-components",
};

const NOTHING_USES_IT: ComponentDeleteResult = {
  componentId: "c1",
  status: "none",
  mayDelete: true,
  run: null,
  plan: {
    complete: true,
    next: null,
    convert: { named: [], unreadable: 0, more: 0 },
    drafts: { named: [], unreadable: 0, more: 0 },
  },
};

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  writePluginRoute: () =>
    Promise.resolve({ message: "", item: NOTHING_USES_IT }),
  isApiError: () => false,
  apiErrorMessage: (_error: Error, fallback: string) => fallback,
  validationIssues: () => [],
  usePluginRouteMutation: () => ({}),
  registerRowAction: (target: string, action: RowAction) => {
    rowActions.push({ target, action });
  },
  navigateTo: (to: string) => {
    navigated.push(to);
  },
  useDocumentIdentity: () => identity,
  useDocumentStatus: () => null,
  useDocumentActions: () => editorActions,
  usePluginRoute: ({ enabled }: { enabled?: boolean }) => ({
    data: enabled === false ? undefined : resolved,
    error: null,
    pending: false,
    refetch: () => {},
  }),
}));

// The import bar beside it has tests of its own.
vi.mock("./transfer-import", () => ({ TransferImport: () => null }));

const { ComponentListTools } = await import("./DeleteComponentAction");
const { RemoveLayoutToolbarSlot } = await import("./RemoveLayoutAction");

beforeEach(() => {
  navigated.length = 0;
  identity = null;
  editorActions = { actions: [{ id: "publish" }] };
});

describe("in the document bar", () => {
  it("offers Delete component on a saved component's form, by the slug the site resolved", async () => {
    identity = {
      kind: "collection",
      slug: "site-components",
      documentId: "c1",
    };
    render(<RemoveLayoutToolbarSlot context="collection" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete component…" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove Layout…" })).toBeNull();
  });

  it("is held while the form's writes are, saying why in the form's own words", () => {
    const history =
      "You are viewing a past version. Return to the current one to make changes.";
    editorActions = {
      actions: [
        { id: "publish", disabledReason: history },
        { id: "unpublish", disabledReason: history },
      ],
    };
    identity = {
      kind: "collection",
      slug: "site-components",
      documentId: "c1",
    };
    render(<RemoveLayoutToolbarSlot context="collection" />);
    const button = screen.getByRole("button", { name: "Delete component…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toBe(history);
  });

  it("is free while one of the form's publication writes may run", () => {
    editorActions = {
      actions: [
        { id: "publish" },
        { id: "unpublish", disabledReason: "Not published." },
      ],
    };
    identity = {
      kind: "collection",
      slug: "site-components",
      documentId: "c1",
    };
    render(<RemoveLayoutToolbarSlot context="collection" />);
    const button = screen.getByRole("button", { name: "Delete component…" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute("title")).toBeNull();
  });

  it("is not offered on a component not saved yet", () => {
    identity = {
      kind: "collection",
      slug: "site-components",
      documentId: "create",
    };
    render(<RemoveLayoutToolbarSlot context="collection" />);
    expect(
      screen.queryByRole("button", { name: "Delete component…" })
    ).toBeNull();
  });

  it("is not offered on another collection's form", () => {
    identity = { kind: "collection", slug: "pages", documentId: "p1" };
    render(<RemoveLayoutToolbarSlot context="collection" />);
    expect(
      screen.queryByRole("button", { name: "Delete component…" })
    ).toBeNull();
  });

  it("leaves for the list once the component is deleted", async () => {
    identity = {
      kind: "collection",
      slug: "site-components",
      documentId: "c1",
    };
    render(<RemoveLayoutToolbarSlot context="collection" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete component…" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete component" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Back to Components" })
    );
    expect(navigated).toEqual(["/admin/collections/site-components"]);
  });
});

describe("on the Components list", () => {
  it("registers one destructive row action on the list it is drawn above, by that list's renamed slug", () => {
    // The plugin's collection renamed by the host: its list is keyed by the
    // new slug, and nothing registers under the old one, which another
    // collection may have taken.
    const { rerender } = render(
      <ComponentListTools collectionSlug="site-components" />
    );
    rerender(<ComponentListTools collectionSlug="site-components" />);
    expect(rowActions.map(entry => entry.target)).toEqual(["site-components"]);
    expect(rowActions[0]?.action.destructive).toBe(true);
    expect(rowActions[0]?.action.isVisible?.({ id: "c1" })).toBe(true);
    expect(rowActions[0]?.action.isVisible?.({})).toBe(false);
  });

  it("opens no dialog when the list is left and opened again", async () => {
    const first = render(
      <ComponentListTools collectionSlug="site-components" />
    );
    const action = rowActions.find(
      entry => entry.action.id === "page-builder-delete-component"
    )?.action;
    act(() => {
      action?.onSelect({ id: "c1", title: "Hero banner" });
    });
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    first.unmount();
    render(<ComponentListTools collectionSlug="site-components" />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByText("Hero banner")).toBeNull();
  });

  it("opens the dialog for the row chosen, naming it", async () => {
    render(<ComponentListTools collectionSlug="site-components" />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const action = rowActions.find(
      entry => entry.action.id === "page-builder-delete-component"
    )?.action;
    act(() => {
      action?.onSelect({ id: "c1", title: "Hero banner" });
    });
    expect(await screen.findByText("Hero banner")).toBeTruthy();
  });
});
