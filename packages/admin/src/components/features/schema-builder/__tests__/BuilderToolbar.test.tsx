// Why: BuilderToolbar lock contract -- breadcrumb + name on the left,
// kind-aware action cluster on the right. PR D simplifications:
// - No icon tile, no source badge, no Hooks button, no unsaved-count
//   badge. Save schema disabled when nothing dirty and when locked.
// - Locked state surfaces via the disabled buttons' tooltip text.
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

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

describe("BuilderToolbar", () => {
  it("renders breadcrumb, name, Settings, Save for collections", () => {
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        unsavedCount={0}
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

  it("does not render an unsaved badge (removed in PR D)", () => {
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        unsavedCount={3}
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    // No "3 unsaved" text or "unsaved" word visible. The Save
    // button being enabled is the only unsaved signal.
    expect(screen.queryByText(/unsaved/i)).toBeNull();
    expect(screen.queryByLabelText(/unsaved changes/i)).toBeNull();
  });

  it("does not render a source badge anymore (removed in PR D)", () => {
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        unsavedCount={0}
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
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(
      screen.getByRole("link", { name: /back to collections/i })
    ).toHaveAttribute("href", "/admin/builder/collections");
  });

  it("asks before leaving with unsaved changes, and not when clean", () => {
    // No builder page mounts a navigation guard, so the crumb — the page's
    // only exit — must stand in front of unsaved work itself.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { rerender } = render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        unsavedCount={2}
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("link", { name: /back to collections/i }));
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(confirmSpy.mock.calls[0][0]).toMatch(/unsaved changes/i);

    confirmSpy.mockClear();
    rerender(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        unsavedCount={0}
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("link", { name: /back to collections/i }));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("disables Save when no unsaved changes", () => {
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        unsavedCount={0}
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
        onOpenSettings={vi.fn()}
        onSave={onSave}
      />
    );
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledOnce();
  });
});
