// @vitest-environment jsdom

/**
 * Where Delete component is offered: in place of the component store's own
 * Delete, in the document's menu (the editor keeps the row, its permission
 * and its holds, and leaves a deleted document), and on each row of the
 * store's list, whose tools draw the dialog for the row chosen.
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
/** The bodies the route was sent. */
const sent: unknown[] = [];

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
  writePluginRoute: (args: { body: { dryRun?: true } }) => {
    sent.push(args.body);
    return Promise.resolve({
      message: "",
      item:
        args.body.dryRun === true
          ? NOTHING_USES_IT
          : { ...NOTHING_USES_IT, status: "done" },
    });
  },
  isApiError: () => false,
  apiErrorMessage: (_error: Error, fallback: string) => fallback,
  validationIssues: () => [],
  usePluginRouteMutation: () => ({}),
  registerRowAction: (target: string, action: RowAction) => {
    rowActions.push({ target, action });
  },
  // The plugin's options as the browser gets them: a host's own store.
  usePluginClientConfig: () => ({ componentStore: "site-components-store" }),
}));

// The import bar beside it has tests of its own.
vi.mock("./transfer-import", () => ({ TransferImport: () => null }));

const {
  ComponentListTools,
  ComponentStoreDeleteHost,
  DeleteComponentReplacement,
} = await import("./DeleteComponentAction");

/** The replacement as the editor mounts it, for document `c1`. */
function replacement(mayWrite: () => boolean = () => true) {
  const close = vi.fn();
  render(
    <DeleteComponentReplacement
      action="delete"
      collectionSlug="components"
      entryId="c1"
      documentLock={{ readOnly: false, actionsDisabled: false }}
      mayWrite={mayWrite}
      close={close}
    />
  );
  return close;
}

beforeEach(() => {
  sent.length = 0;
});

describe("in place of the document's Delete", () => {
  it("opens the dialog for the document on screen at once", async () => {
    replacement();
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect((await screen.findAllByText(/Nothing uses/)).length).toBeGreaterThan(
      0
    );
    expect(sent).toEqual([{ dryRun: true }]);
  });

  it("closes with nothing when the author cancels", async () => {
    const close = replacement();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledWith();
  });

  it("closes saying the document was deleted, so the editor leaves it and refreshes its lists", async () => {
    const close = replacement();
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete component" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Back to the list" })
    );
    expect(close).toHaveBeenCalledWith("deleted");
  });

  it("starts no delete when the form's writes became held while it was open", async () => {
    replacement(() => false);
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete component" })
    );
    expect(
      (await screen.findAllByText(/changes are on hold/)).length
    ).toBeGreaterThan(0);
    expect(sent).toEqual([{ dryRun: true }]);
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

  it("registers on a host's own store's list from the header, whatever the host draws above that list, and opens one dialog for the row chosen there", async () => {
    // Drawn in the header, twice as a page may draw it, and not in the slot
    // above the list, which the host's own component may hold.
    render(<ComponentStoreDeleteHost />);
    render(<ComponentStoreDeleteHost />);
    render(<ComponentListTools collectionSlug="site-components" />);
    expect(
      rowActions.filter(entry => entry.target === "site-components-store")
    ).toHaveLength(1);
    const hosts = rowActions.find(
      entry => entry.target === "site-components-store"
    )?.action;
    act(() => {
      hosts?.onSelect({ id: "c9", title: "Host banner" });
    });
    // One dialog, for the host store's row.
    expect(await screen.findAllByRole("alertdialog")).toHaveLength(1);
    expect(screen.getByText("Host banner")).toBeTruthy();
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
