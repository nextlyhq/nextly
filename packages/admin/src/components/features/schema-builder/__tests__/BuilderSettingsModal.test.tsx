// Why: shell test locks the modal contract — title differs between create
// (kind-aware) and edit (uses singular name), the two tabs render, and the
// footer's primary button label differs between modes ("Continue" vs "Save").
// advancedFields list includes `status`; edit mode preserves whatever value
// was passed via `initialValues`. Tab content rendering is left to BasicsTab /
// AdvancedTab tests in their own files; this file only verifies the wiring.
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@admin/__tests__/utils";
import { useBuilderEntityState } from "@admin/hooks/useBuilderEntityState";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";

import {
  BuilderSettingsModal,
  type BuilderSettingsValues,
} from "../BuilderSettingsModal";
import { DESCRIPTION_MAX_LENGTH } from "../builder-settings-modal/BasicsTab";
import type { BuilderConfig } from "../builder-config";

import type { StoredHookConfig } from "@admin/types/collection";

/** What the server's address check refuses, by address. */
let refusals: Record<string, { code: string; message: string }> = {};
const check = vi.fn(
  async (kind: string, address: string, _pending?: unknown) => ({
    kind,
    address,
    refusal: refusals[address] ?? null,
  })
);
vi.mock("@admin/services/addressCheckApi", () => ({
  addressCheckApi: {
    check: (kind: string, address: string, pending?: unknown) =>
      check(kind, address, pending),
  },
}));

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

  it("keeps a CLEARED description as an explicit empty string", () => {
    // 🔴 Not `undefined`. Every update handler reads `description !== undefined`
    // as "the caller is not talking about this field", and `JSON.stringify`
    // drops an undefined property — so an emptied box would leave the old
    // description in the database while the manifest's full replace dropped it,
    // and the interface would report success. `""` is the only value that says
    // "remove it".
    expect(submitted({ description: "   " }).description).toBe("");
    expect(submitted({ description: "" }).description).toBe("");
  });

  it("still hands back undefined when there was never a description", () => {
    // The control for the case above: "" must mean CLEARED, so an absent one
    // must not also arrive as "" — that would turn every save of an entity
    // without a description into an instruction to clear one.
    expect(submitted({}).description).toBeUndefined();
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

// A description saved before the builder's limit, or set longer some other
// way, still loads whole: the field says it is over, and Save waits until it
// is shortened rather than cutting it.
describe("BuilderSettingsModal — the description limit", () => {
  it("holds Save while the description is over its limit", () => {
    const onSubmit = vi.fn();
    render(
      <BuilderSettingsModal
        open
        mode="edit"
        config={collectionConfig}
        initialValues={{
          singularName: "Post",
          pluralName: "Posts",
          slug: "posts",
          description: "a".repeat(DESCRIPTION_MAX_LENGTH + 1),
          icon: "FileText",
        }}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    const description = screen.getByLabelText("Description");
    expect(description).toHaveValue("a".repeat(DESCRIPTION_MAX_LENGTH + 1));
    expect(description).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText(
        `Keep the description to ${DESCRIPTION_MAX_LENGTH} characters or fewer.`
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(description, {
      target: { value: "a".repeat(DESCRIPTION_MAX_LENGTH) },
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(
      screen.getByText(`${DESCRIPTION_MAX_LENGTH}/${DESCRIPTION_MAX_LENGTH}`)
    ).toBeInTheDocument();
  });
});

describe("BuilderSettingsModal — a collection's stored hooks", () => {
  const slugHook: StoredHookConfig = {
    hookId: "auto-slug",
    hookType: "beforeChange",
    enabled: true,
    config: { sourceField: "title", targetField: "slug" },
    order: 0,
  };

  function renderEdit(storedHooks?: readonly StoredHookConfig[]) {
    render(
      <BuilderSettingsModal
        open
        mode="edit"
        config={collectionConfig}
        initialValues={{
          singularName: "Post",
          slug: "posts",
          icon: "Database",
        }}
        storedHooks={storedHooks}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
  }

  it("offers no Hooks tab when the collection has none", () => {
    renderEdit(undefined);
    expect(screen.queryByRole("tab", { name: /hooks/i })).toBeNull();
  });

  it("offers no Hooks tab for an empty list", () => {
    renderEdit([]);
    expect(screen.queryByRole("tab", { name: /hooks/i })).toBeNull();
  });

  it("shows the stored hooks, counted, in a tab of their own", async () => {
    const user = userEvent.setup();
    renderEdit([slugHook, { ...slugHook, hookId: "audit-fields", order: 1 }]);

    await user.click(screen.getByRole("tab", { name: "Hooks (2)" }));

    expect(
      screen.getByRole("heading", { name: "Auto-generate Slug" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Set Audit Fields" })
    ).toBeInTheDocument();
  });
});

// Once saved, an address names the entity's routes, its table and what refers
// to it, so it is fixed, and the settings say what changing it would break.
// Before the first save nothing refers to it yet, so it stays editable,
// checked as it is typed against everything else that holds an address.
describe("BuilderSettingsModal — the address", () => {
  const singleConfig: BuilderConfig = {
    kind: "single",
    basicsFields: ["singularName", "slug", "description", "icon"],
    advancedFields: ["status", "i18n"],
    toolbar: { previewSchemaChange: true },
    picker: {},
  };
  const SAVED: BuilderSettingsValues = {
    singularName: "Post",
    pluralName: "Posts",
    slug: "posts",
    description: "",
    icon: "FileText",
  };

  beforeEach(() => {
    refusals = {};
    check.mockClear();
  });

  it.each([
    [
      "collection",
      collectionConfig,
      undefined,
      "Fixed once saved: its API routes, and every client that calls them, use this address.",
    ],
    [
      "Single",
      singleConfig,
      undefined,
      "Fixed once saved: its API routes, and every client that calls them, use this address.",
    ],
    [
      "field group",
      componentConfig,
      3,
      "Fixed once saved: the fields that use this field group refer to it by this address. Used in 3 places you can read.",
    ],
  ] as const)(
    "a saved collection's, Single's and field group's address is fixed (%s)",
    (_kind, config, usedByCount, says) => {
      render(
        <BuilderSettingsModal
          open
          mode="edit"
          config={config}
          initialValues={SAVED}
          usedByCount={usedByCount}
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
        />
      );
      const address = screen.getByLabelText("Slug");
      expect(address).toHaveAttribute("readonly");
      expect(address).toHaveAccessibleDescription(says);
    }
  );

  it("keeps a saved entity's address when its name changes", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    // An address that is what the name derives, the one that would follow it.
    render(
      <BuilderSettingsModal
        open
        mode="edit"
        config={collectionConfig}
        initialValues={{ ...SAVED, slug: "post" }}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    const name = screen.getByRole("textbox", { name: "Singular name" });
    await user.clear(name);
    await user.type(name, "Article");
    expect(screen.getByLabelText("Slug")).toHaveValue("post");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ singularName: "Article", slug: "post" })
    );
  });

  it("keeps an unsaved entity's address editable, checked as typed, its own not counted against it", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    refusals = {
      articles: { code: "DUPLICATE", message: "Resource already exists." },
    };
    const others = [{ kind: "collection" as const, address: "drafts" }];
    render(
      <BuilderSettingsModal
        open
        mode="edit"
        config={collectionConfig}
        initialValues={SAVED}
        unsavedAddress={{ otherAddresses: others }}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    const address = screen.getByLabelText("Slug");
    expect(address).not.toHaveAttribute("readonly");

    await user.clear(address);
    await user.type(address, "articles");
    await waitFor(() =>
      expect(address).toHaveAccessibleDescription(
        "A collection or Single already uses this address."
      )
    );
    expect(check).toHaveBeenLastCalledWith("collection", "articles", others);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await user.clear(address);
    await user.type(address, "stories");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ slug: "stories" })
    );
  });

  it("a plugin's collection offers no editable setting", () => {
    render(
      <BuilderSettingsModal
        open
        mode="edit"
        config={collectionConfig}
        initialValues={SAVED}
        readOnly
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    for (const control of [
      ...screen.getAllByRole("textbox"),
      ...screen.queryAllByRole("switch"),
    ]) {
      expect(control).toBeDisabled();
    }
    // Nothing to save or cancel: the footer only closes.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});

// What the settings hand back is what the editor counts and lists: each
// setting changed in them is a pending change of its own, translation turned
// off among them.
describe("BuilderSettingsModal — its changes, pending", () => {
  it("each setting becomes a pending change, translation turned off among them", async () => {
    const user = userEvent.setup();
    const entity = {
      slug: "posts",
      settings: {
        singularName: "Post",
        pluralName: "Posts",
        slug: "posts",
        description: "",
        icon: "FileText",
        i18n: true,
      } satisfies BuilderSettingsValues,
    };
    const editor = renderHook(() => {
      const builder = useFieldBuilder({
        resolver: async values => ({ values, errors: {} }),
        defaultValues: {},
      });
      return useBuilderEntityState({
        entity,
        builder,
        toFields: () => [],
        toSettings: loaded => loaded.settings,
        onLoad: () => {},
        identity: loaded => loaded.slug,
      });
    });
    await waitFor(() => expect(editor.result.current.settings).not.toBeNull());

    render(
      <BuilderSettingsModal
        open
        mode="edit"
        config={collectionConfig}
        initialValues={editor.result.current.settings}
        onCancel={vi.fn()}
        onSubmit={next => editor.result.current.setSettings(next)}
      />
    );
    const name = screen.getByRole("textbox", { name: "Singular name" });
    await user.clear(name);
    await user.type(name, "Article");
    await user.click(screen.getByRole("tab", { name: "Advanced" }));
    await user.click(
      screen.getByRole("switch", { name: "Internationalization" })
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        editor.result.current.pending.settingChanges.map(
          change => `${change.label}: ${change.from} → ${change.to}`
        )
      ).toEqual([
        "name: Post → Article",
        // The plural the name derived follows it; the fixed address does not.
        "plural name: Posts → Articles",
        "translation: on → off",
      ])
    );
    expect(editor.result.current.unsavedCount).toBe(3);
  });
});

describe("BuilderSettingsModal — an unsaved address typed with spaces", () => {
  it("checks and submits the same trimmed address", async () => {
    refusals = {};
    check.mockClear();
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <BuilderSettingsModal
        open
        mode="edit"
        config={collectionConfig}
        initialValues={{
          singularName: "Post",
          slug: "posts",
          icon: "FileText",
        }}
        unsavedAddress={{ otherAddresses: [] }}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    const address = screen.getByLabelText("Slug");
    await user.clear(address);
    await user.type(address, "stories ");
    const save = screen.getByRole("button", { name: "Save" });
    await waitFor(() => expect(save).toBeEnabled());
    expect(check).toHaveBeenLastCalledWith("collection", "stories", []);
    await user.click(save);
    expect(onSubmit.mock.calls[0][0].slug).toBe("stories");
  });
});
