// Why: BuilderToolbar lock contract -- breadcrumb + name on the left,
// kind-aware action cluster on the right. PR D simplifications:
// - No icon tile, no source badge, no Hooks button, no unsaved-count
//   badge. Save schema disabled when nothing dirty and when locked.
// - Locked state surfaces via the disabled buttons' tooltip text.
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
  kind: "component",
  toolbar: { previewSchemaChange: false },
};

describe("BuilderToolbar", () => {
  it("renders breadcrumb, name, Settings, Save schema for collections", () => {
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
    expect(
      screen.getByRole("button", { name: /save schema/i })
    ).toBeInTheDocument();
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
    // No "3 unsaved" text or "unsaved" word visible. The Save Schema
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
    // icon name in a square. With it removed, the standalone "H" or "F"
    // letter shouldn't appear before the breadcrumb.
    const breadcrumb = screen.getByText(/components/i);
    const sibling = breadcrumb.previousSibling;
    expect(sibling).toBeNull();
  });

  it("disables Save schema when no unsaved changes", () => {
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        unsavedCount={0}
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /save schema/i })).toBeDisabled();
  });

  it("disables Save schema and Settings when locked", () => {
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
    expect(screen.getByRole("button", { name: /save schema/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /settings/i })).toBeDisabled();
  });

  it("invokes onSave when Save schema is clicked (and dirty)", async () => {
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
    await user.click(screen.getByRole("button", { name: /save schema/i }));
    expect(onSave).toHaveBeenCalledOnce();
  });
});
