// Why: BuilderToolbar lock contract — breadcrumb + name on the left,
// kind-aware action cluster on the right. Hooks button hidden for
// Components per config. Save schema disabled when nothing dirty and
// when the collection is locked. Source badge renders when source is
// passed, plus a tooltip-bearing reason when locked. Unsaved-count badge
// appears when count > 0.
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { BuilderToolbar } from "../BuilderToolbar";
import type { BuilderConfig } from "../builder-config";

const collectionConfig: BuilderConfig = {
  kind: "collection",
  basicsFields: [],
  advancedFields: [],
  toolbar: { showHooks: true, previewSchemaChange: true },
  picker: {},
};

const componentConfig: BuilderConfig = {
  ...collectionConfig,
  kind: "component",
  toolbar: { showHooks: false, previewSchemaChange: false },
};

describe("BuilderToolbar", () => {
  it("renders breadcrumb, name, Settings, Hooks, Save schema for collections", () => {
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        icon="FileText"
        unsavedCount={0}
        onOpenSettings={vi.fn()}
        onOpenHooks={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByText(/collections/i)).toBeInTheDocument();
    expect(screen.getByText("Posts")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /settings/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hooks/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save schema/i })
    ).toBeInTheDocument();
  });

  it("hides Hooks for components (per config)", () => {
    render(
      <BuilderToolbar
        config={componentConfig}
        name="Hero"
        icon="Box"
        unsavedCount={0}
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(
      screen.queryByRole("button", { name: /hooks/i })
    ).not.toBeInTheDocument();
  });

  it("shows the unsaved-count badge when count > 0", () => {
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        icon="FileText"
        unsavedCount={3}
        onOpenSettings={vi.fn()}
        onOpenHooks={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/3 unsaved changes/i)).toBeInTheDocument();
  });

  it("disables Save schema when no unsaved changes", () => {
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        icon="FileText"
        unsavedCount={0}
        onOpenSettings={vi.fn()}
        onOpenHooks={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /save schema/i })).toBeDisabled();
  });

  it("renders the source badge when source is provided (UI)", () => {
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        icon="FileText"
        source="ui"
        unsavedCount={0}
        onOpenSettings={vi.fn()}
        onOpenHooks={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByText(/^UI$/)).toBeInTheDocument();
  });

  it("disables Save schema and Settings when locked, renders the Code badge", () => {
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        icon="FileText"
        source="code"
        locked
        unsavedCount={0}
        onOpenSettings={vi.fn()}
        onOpenHooks={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /save schema/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /settings/i })).toBeDisabled();
    expect(screen.getByText(/^Code$/)).toBeInTheDocument();
  });

  it("invokes onSave when Save schema is clicked (and dirty)", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <BuilderToolbar
        config={collectionConfig}
        name="Posts"
        icon="FileText"
        unsavedCount={2}
        onOpenSettings={vi.fn()}
        onOpenHooks={vi.fn()}
        onSave={onSave}
      />
    );
    await user.click(screen.getByRole("button", { name: /save schema/i }));
    expect(onSave).toHaveBeenCalledOnce();
  });
});
