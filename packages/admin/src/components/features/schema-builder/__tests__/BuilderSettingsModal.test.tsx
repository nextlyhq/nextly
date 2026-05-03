// Why: shell test locks the modal contract — title differs between create
// (kind-aware) and edit (uses singular name), the two tabs render, and the
// footer's primary button label differs between modes ("Continue" vs "Save").
// Tab content rendering is left to BasicsTab / AdvancedTab tests in their own
// files; this file only verifies the wiring.
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { BuilderSettingsModal } from "../BuilderSettingsModal";
import type { BuilderConfig } from "../builder-config";

const collectionConfig: BuilderConfig = {
  kind: "collection",
  basicsFields: ["singularName", "pluralName", "slug", "description", "icon"],
  advancedFields: ["adminGroup", "order", "status", "i18n", "showSystemFields"],
  toolbar: { showHooks: true, previewSchemaChange: true },
  picker: {},
};

describe("BuilderSettingsModal — shell", () => {
  it("renders the kind-aware title in create mode", () => {
    render(
      <BuilderSettingsModal
        open
        mode="create"
        config={collectionConfig}
        initialValues={null}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    // Match the heading specifically — "New collection" also appears in the
    // description text below the title.
    expect(
      screen.getByRole("heading", { name: /new collection/i })
    ).toBeInTheDocument();
  });

  it("renders Basics and Advanced tab triggers", () => {
    render(
      <BuilderSettingsModal
        open
        mode="create"
        config={collectionConfig}
        initialValues={null}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByRole("tab", { name: /basics/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /advanced/i })).toBeInTheDocument();
  });

  it("shows 'Continue' in create mode and 'Save' in edit mode", () => {
    const { rerender } = render(
      <BuilderSettingsModal
        open
        mode="create"
        config={collectionConfig}
        initialValues={null}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: /continue/i })
    ).toBeInTheDocument();

    rerender(
      <BuilderSettingsModal
        open
        mode="edit"
        config={collectionConfig}
        initialValues={{
          singularName: "Post",
          pluralName: "Posts",
          slug: "posts",
          description: "",
          icon: "FileText",
        }}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  it("invokes onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(
      <BuilderSettingsModal
        open
        mode="create"
        config={collectionConfig}
        initialValues={null}
        onCancel={onCancel}
        onSubmit={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
