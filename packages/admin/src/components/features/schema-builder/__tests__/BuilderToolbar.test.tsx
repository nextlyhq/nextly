// Why: BuilderToolbar lock contract -- breadcrumb + name on the left,
// kind-aware action cluster on the right: the number of unsaved changes
// with Undo, Redo and Discard all, then Add field, Settings and Save.
// - No icon tile, no source badge, no Hooks button. Save schema disabled
//   when nothing is unsaved and when locked.
// - Locked state surfaces via the disabled buttons' tooltip text.
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderPendingChanges } from "@admin/hooks/useBuilderEntityState";

import { BuilderToolbar } from "../BuilderToolbar";
import type { BuilderConfig } from "../builder-config";

const collectionConfig: BuilderConfig = {
  kind: "collection",
  basicsFields: [],
  advancedFields: [],
  toolbar: { previewSchemaChange: true },
  picker: {},
};

const componentConfig: BuilderConfig = {
  ...collectionConfig,
  kind: "field-group",
  toolbar: { previewSchemaChange: false },
};

/** Nothing pending: no changes, nothing to undo or redo. */
const noPending: BuilderPendingChanges = {
  changes: [],
  marks: new Map(),
  saved: [],
  canUndo: false,
  canRedo: false,
  undo: () => null,
  redo: () => null,
  discardAll: () => {},
};

describe("BuilderToolbar", () => {
  it("renders breadcrumb, name, Settings, Save for collections", () => {
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        unsavedCount={0}
        pending={noPending}
        onAddField={vi.fn()}
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByText(/collections/i)).toBeInTheDocument();
    expect(screen.getByText("Posts")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /settings/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  // The number of unsaved changes is shown at all times, beside the Undo,
  // Redo and Discard all that act on them.
  it("shows how many changes are unsaved, with Undo, Redo and Discard all", () => {
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        unsavedCount={3}
        pending={{ ...noPending, canUndo: true }}
        onAddField={vi.fn()}
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByText("3 unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Discard all changes" })
    ).toBeEnabled();
  });

  it("does not render a source badge anymore (removed in PR D)", () => {
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        unsavedCount={0}
        pending={noPending}
        onAddField={vi.fn()}
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.queryByText(/^Code$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^UI$/)).not.toBeInTheDocument();
  });

  it("does not render a Hooks button (UI removed in PR D)", () => {
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        unsavedCount={0}
        pending={noPending}
        onAddField={vi.fn()}
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(
      screen.queryByRole("button", { name: /hooks/i })
    ).not.toBeInTheDocument();
  });

  it("does not render the icon tile (removed in PR D)", () => {
    render(
      <BuilderToolbar
        config={componentConfig}
        name="Hero"
        unsavedCount={0}
        pending={noPending}
        onAddField={vi.fn()}
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    // The legacy first-letter tile rendered the first character of the
    // icon name in a square. With it removed, no standalone letter appears
    // beside the breadcrumb — the crumb's chevron is decoration INSIDE the
    // back link, not a tile.
    expect(screen.queryByText(/^[HF]$/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /back to field groups/i })
    ).toBeInTheDocument();
  });

  it("renders the crumb as a link back to the kind's builder list", () => {
    // Builder pages render standalone, so the crumb is the only way back to
    // the list — it must be a link with the list as its destination, not a
    // label.
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        unsavedCount={0}
        pending={noPending}
        onAddField={vi.fn()}
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(
      screen.getByRole("link", { name: /back to collections/i })
    ).toHaveAttribute("href", "/admin/builder/collections");
  });

  // The page's guard asks before every way out — this link, the browser's
  // back, a reload, closing the tab — so the crumb does not ask again itself:
  // one question, not two. It moves through the admin's own history, the one
  // the guard watches; a link routed any other way would leave unasked.
  it("leaves the question to the page's guard rather than asking itself", () => {
    const start = window.location.pathname;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        unsavedCount={2}
        pending={noPending}
        onAddField={vi.fn()}
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("link", { name: /back to collections/i }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/admin/builder/collections");
    confirmSpy.mockRestore();
    window.history.replaceState(null, "", start);
  });

  it("disables Save when no unsaved changes", () => {
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        unsavedCount={0}
        pending={noPending}
        onAddField={vi.fn()}
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("shows a read-only badge, disables Save, but keeps Settings viewable when locked", () => {
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        locked
        unsavedCount={0}
        pending={noPending}
        onAddField={vi.fn()}
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    // Settings stays enabled so code-first config can be inspected read-only.
    expect(
      screen.getByRole("button", { name: /view settings/i })
    ).toBeEnabled();
  });

  it("invokes onSave when Save is clicked (and dirty)", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        unsavedCount={2}
        pending={noPending}
        onAddField={vi.fn()}
        onOpenSettings={vi.fn()}
        onSave={onSave}
      />
    );
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledOnce();
  });
});
