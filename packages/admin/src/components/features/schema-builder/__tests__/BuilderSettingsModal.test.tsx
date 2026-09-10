// Why: shell test locks the modal contract — title differs between create
// (kind-aware) and edit (uses singular name), the two tabs render, and the
// footer's primary button label differs between modes ("Continue" vs "Save").
// advancedFields list includes `status`; edit mode preserves whatever value
// was passed via `initialValues`. Tab content rendering is left to BasicsTab /
// AdvancedTab tests in their own files; this file only verifies the wiring.
import { describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen } from "@admin/__tests__/utils";

import {
  BuilderSettingsModal,
  type BuilderSettingsValues,
} from "../BuilderSettingsModal";
import type { BuilderConfig } from "../builder-config";

const collectionConfig: BuilderConfig = {
  kind: "collection",
  basicsFields: ["singularName", "pluralName", "slug", "description", "icon"],
  advancedFields: ["status", "i18n", "showSystemFields"],
  toolbar: { previewSchemaChange: true },
  picker: {},
};

const componentConfig: BuilderConfig = {
  kind: "field-group",
  basicsFields: ["singularName", "slug", "description", "icon"],
  advancedFields: ["category", "i18n", "showSystemFields"],
  toolbar: { previewSchemaChange: false },
  picker: {},
};

describe("BuilderSettingsModal — what it hands the page", () => {
  /** Submit with `initialValues` and hand back the single argument onSubmit got. */
  function submitted(values: Partial<BuilderSettingsValues>) {
    const onSubmit = vi.fn();
    render(
      <BuilderSettingsModal
        open
        mode="edit"
        config={collectionConfig}
        initialValues={{
          singularName: "Post",
          slug: "posts",
          icon: "Database",
          ...values,
        }}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    return onSubmit.mock.calls[0][0] as BuilderSettingsValues;
  }

  it("trims the description before anyone writes it", () => {
    // 🔴 A settings save fans out to TWO writes — the create/update request and
    // the `ui-schema.json` projection — describing the same entity. Normalising
    // in one of them is what let a row and the file record different
    // descriptions, so replaying the manifest visibly changed a saved value.
    // Trimmed here, at the one boundary both of them read from.
    expect(
      submitted({ description: "  Long-form writing  " }).description
    ).toBe("Long-form writing");
  });

  it("hands back nothing for a description that is only whitespace", () => {
    // "No description" and "a description that is blank" are different things
    // and only the first is one a reader can mean. `undefined` is also what
    // makes the manifest projection omit the key rather than write "".
    expect(submitted({ description: "   " }).description).toBeUndefined();
    expect(submitted({ description: "" }).description).toBeUndefined();
  });

  it("leaves every other answer exactly as it was", () => {
    // The control. Normalising at this boundary must not become a second place
    // that quietly reshapes the values — only the description is touched.
    const values = submitted({
      status: true,
      i18n: true,
      category: "  Content  ",
    });
    expect(values.status).toBe(true);
    expect(values.i18n).toBe(true);
    expect(values.category).toBe("  Content  ");
    expect(values.singularName).toBe("Post");
  });
});

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

  it("defaults status to true in create mode when advancedFields includes status", async () => {
    const onSubmit = vi.fn();
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(
      <BuilderSettingsModal
        open
        mode="create"
        config={collectionConfig}
        initialValues={null}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    // Fill the bare minimum so submit is allowed; the status default
    // we care about flows through unchanged.
    await user.type(screen.getByLabelText(/singular name/i), "Post");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
    const submitted = onSubmit.mock.lastCall?.[0];
    expect(submitted.status).toBe(true);
  });

  it("does not default status when the kind's advancedFields excludes status (Component)", async () => {
    const onSubmit = vi.fn();
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(
      <BuilderSettingsModal
        open
        mode="create"
        config={componentConfig}
        initialValues={null}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    await user.type(screen.getByLabelText(/singular name/i), "Hero");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
    const submitted = onSubmit.mock.lastCall?.[0];
    // Components have no Draft/Published lifecycle (they're field-group
    // templates). The status default must NOT leak into the submitted
    // payload for kinds that don't list status in advancedFields.
    expect(submitted.status).toBeUndefined();
  });

  it("preserves initialValues.status in edit mode (does not override to true)", async () => {
    const onSubmit = vi.fn();
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(
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
          status: false,
        }}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
    const submitted = onSubmit.mock.lastCall?.[0];
    expect(submitted.status).toBe(false);
  });

  // The slug addresses the entity's route, its table and every record stored
  // under it, and no update call sends a changed one — they all take the slug
  // from the route. An editable field here accepts a value that is dropped by
  // the next load, and on the kinds whose dirty check compares `slug` it also
  // enables Save and re-pins the baseline as though the change had landed.
  it("offers the slug for editing while creating", () => {
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
    expect(screen.getByLabelText("Slug")).not.toHaveAttribute("readonly");
  });

  it("shows the slug read-only once the entity exists", () => {
    render(
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
    const slug = screen.getByLabelText("Slug");
    // Still shown and still readable: the slug is what a developer needs in
    // order to reference the entity, so it is presented rather than hidden.
    expect(slug).toHaveValue("posts");
    expect(slug).toHaveAttribute("readonly");
  });
});
