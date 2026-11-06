// The shared field picker, as every surface uses it: search first, a short
// most-used group then categories, keyboard alone, a label-only add step and
// add-and-add-another. The surface's configuration is the only input; the
// catalog rows come from the shipped catalog through the one description.
import userEvent from "@testing-library/user-event";
import {
  describeFieldTypes,
  FIELD_TYPE_CATALOG,
  MOST_USED_FIELD_TYPES,
} from "nextly/field-catalog";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { toSnakeName } from "@admin/lib/builder";
import { insertField } from "@admin/lib/builder/insert-field";
import type { PluginMetadata } from "@admin/types/branding";

import {
  FieldPicker,
  type FieldPickerConfig,
  type FieldPickerProps,
} from "../FieldPicker";

let plugins: PluginMetadata[] = [];
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins }),
}));

afterEach(() => {
  plugins = [];
});

const CONFIG: FieldPickerConfig = {
  surface: "entries",
  types: describeFieldTypes<string>(FIELD_TYPE_CATALOG),
  mostUsed: MOST_USED_FIELD_TYPES,
  deriveName: label => toSnakeName(label),
};

function renderPicker(over: Partial<FieldPickerProps> = {}) {
  const onAdd = vi.fn();
  const onCancel = vi.fn();
  const user = userEvent.setup();
  render(
    <FieldPicker
      open
      config={CONFIG}
      onAdd={onAdd}
      onCancel={onCancel}
      {...over}
    />
  );
  return { user, onAdd, onCancel };
}

const search = () =>
  screen.getByRole("combobox", { name: "Search field types" });
const optionNames = (root: HTMLElement = document.body) =>
  within(root)
    .queryAllByRole("option")
    .map(o => o.getAttribute("data-type"));
const groups = () =>
  screen.getAllByRole("group").map(g => ({
    heading: g.getAttribute("aria-label"),
    types: optionNames(g),
  }));
const activeType = () => {
  const id = search().getAttribute("aria-activedescendant");
  return id ? document.getElementById(id)?.getAttribute("data-type") : null;
};

describe("FieldPicker", () => {
  it("opens with focus in search, most-used first, then categories", () => {
    renderPicker();
    expect(search()).toHaveFocus();
    expect(groups()).toEqual([
      {
        heading: "Most used",
        types: ["text", "richText", "upload", "relationship", "select", "date"],
      },
      {
        heading: "Basic",
        types: ["textarea", "email", "password", "number", "icon"],
      },
      {
        heading: "Advanced",
        types: ["code", "radio", "checkbox", "json", "chips"],
      },
      { heading: "Structured", types: ["repeater", "group", "component"] },
    ]);
    // Each type shows its plain name and its one-line description.
    const upload = screen.getByRole("option", { name: /Image or file/ });
    expect(upload).toHaveTextContent("An uploaded file or image");
    // The type id is what stored data uses; a person never reads it here.
    expect(upload.textContent).not.toMatch(/\bupload\b/);
  });

  it("says when nothing matches", async () => {
    const { user } = renderPicker();
    await user.type(search(), "zzzz");
    expect(screen.queryAllByRole("option")).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No field type matches “zzzz”."
    );
  });

  it("shows search results as one list, best match first", async () => {
    const { user } = renderPicker();
    await user.type(search(), "relationship");
    expect(optionNames()).toEqual(["relationship"]);
    expect(activeType()).toBe("relationship");
  });

  it("arrows, Enter and Escape", async () => {
    const { user, onCancel } = renderPicker();
    expect(activeType()).toBe("text");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(activeType()).toBe("upload");
    await user.keyboard("{ArrowUp}");
    expect(activeType()).toBe("richText");
    // Up from the first stays on the first rather than leaving the list.
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(activeType()).toBe("text");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByRole("textbox", { name: "Label" })).toHaveFocus();
    expect(
      screen.getByText("Rich text", { selector: "[data-picked]" })
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Enter picks nothing when nothing matches", async () => {
    const { user } = renderPicker();
    await user.type(search(), "zzzz{Enter}");
    expect(screen.queryByRole("textbox", { name: "Label" })).toBeNull();
    expect(search()).toHaveFocus();
  });

  it("Add opens the new field", async () => {
    const { user, onAdd } = renderPicker();
    await user.click(screen.getByRole("option", { name: /Long text/ }));
    const add = screen.getByRole("button", { name: "Add field" });
    // Only a label is asked for, and nothing is added without one.
    expect(add).toBeDisabled();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    await user.type(
      screen.getByRole("textbox", { name: "Label" }),
      "Sub Title"
    );
    expect(screen.getByText("sub_title")).toBeInTheDocument();
    await user.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(
      { type: "textarea", label: "Sub Title", name: "sub_title" },
      { addAnother: false }
    );
  });

  it("Enter in the label adds the field", async () => {
    const { user, onAdd } = renderPicker();
    await user.click(screen.getByRole("option", { name: /^Text/ }));
    await user.type(
      screen.getByRole("textbox", { name: "Label" }),
      "Title{Enter}"
    );
    expect(onAdd).toHaveBeenCalledWith(
      { type: "text", label: "Title", name: "title" },
      { addAnother: false }
    );
  });

  it("Back returns to the search as it was", async () => {
    const { user } = renderPicker();
    await user.type(search(), "rich");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(search()).toHaveValue("rich");
    expect(search()).toHaveFocus();
  });

  it("Add and add another keeps the position moving", async () => {
    // A host as the Builder is one: it inserts each new field at the position
    // the picker was opened for, and keeps the picker open for the next.
    const first: BuilderField = {
      id: "a",
      name: "a",
      label: "A",
      type: "text",
    };
    const last: BuilderField = { id: "b", name: "b", label: "B", type: "text" };
    let fields: BuilderField[] = [first, last];
    function Host() {
      const [, rerender] = useState(0);
      return (
        <FieldPicker
          open
          config={CONFIG}
          onCancel={() => {}}
          onAdd={(choice, how) => {
            expect(how).toEqual({ addAnother: true });
            fields =
              insertField(
                fields,
                {
                  id: choice.name,
                  name: choice.name,
                  label: choice.label,
                  type: choice.type,
                },
                { beforeFieldId: "b" }
              ) ?? fields;
            rerender(n => n + 1);
          }}
        />
      );
    }
    const user = userEvent.setup();
    render(<Host />);
    for (const label of ["One", "Two", "Three"]) {
      await user.type(search(), "number{Enter}");
      await user.type(screen.getByRole("textbox", { name: "Label" }), label);
      await user.click(
        screen.getByRole("button", { name: "Add and add another" })
      );
      // Back on a fresh search, ready for the next.
      expect(search()).toHaveFocus();
      expect(search()).toHaveValue("");
    }
    expect(fields.map(f => f.name)).toEqual(["a", "one", "two", "three", "b"]);
  });

  it("chooses an existing field group, telling two of one name apart", async () => {
    const { user, onAdd } = renderPicker({
      config: {
        ...CONFIG,
        fieldGroups: {
          type: "component",
          options: [
            { slug: "seo", label: "SEO", text: "SEO (Field group, slug: seo)" },
            {
              slug: "seo_v2",
              label: "SEO",
              text: "SEO (Field group, slug: seo_v2)",
            },
          ],
        },
      },
    });
    await user.click(screen.getByRole("option", { name: /Field group/ }));
    const chooser = screen.getByRole("combobox", {
      name: "Search field groups",
    });
    expect(chooser).toHaveFocus();
    expect(screen.getAllByRole("option").map(o => o.textContent)).toEqual([
      "SEO (Field group, slug: seo)",
      "SEO (Field group, slug: seo_v2)",
    ]);
    await user.type(chooser, "seo_v2");
    expect(screen.getAllByRole("option").map(o => o.textContent)).toEqual([
      "SEO (Field group, slug: seo_v2)",
    ]);
    await user.keyboard("{Enter}");
    const label = screen.getByRole("textbox", { name: "Label" });
    expect(label).toHaveValue("SEO");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    expect(onAdd).toHaveBeenCalledWith(
      { type: "component", label: "SEO", name: "seo", fieldGroup: "seo_v2" },
      { addAnother: false }
    );
  });

  it("Back from the label returns to the field group chooser", async () => {
    const { user } = renderPicker({
      config: {
        ...CONFIG,
        fieldGroups: {
          type: "component",
          options: [
            { slug: "seo", label: "SEO", text: "SEO (Field group, slug: seo)" },
          ],
        },
      },
    });
    await user.click(screen.getByRole("option", { name: /Field group/ }));
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("combobox", { name: "Search field groups" })
    ).toHaveFocus();
  });

  it("says so when there is no field group to choose", async () => {
    const { user } = renderPicker({
      config: {
        ...CONFIG,
        fieldGroups: { type: "component", options: [] },
      },
    });
    await user.click(screen.getByRole("option", { name: /Field group/ }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "There are no field groups yet."
    );
    expect(screen.queryByRole("button", { name: "Add field" })).toBeNull();
  });

  it("a test plugin's type appears on its surface only", () => {
    plugins = [
      {
        name: "ratings",
        collections: [],
        fieldTypes: [
          {
            type: "rating",
            component: "ratings/Rating",
            storage: "number",
            label: "Rating",
            description: "Stars out of five",
            category: "Advanced",
            surfaces: ["forms"],
          },
        ],
      },
    ];
    const { unmount } = render(
      <FieldPicker
        open
        config={{ ...CONFIG, surface: "forms" }}
        onAdd={() => {}}
        onCancel={() => {}}
      />
    );
    const advanced = screen.getByRole("group", { name: "Advanced" });
    const rating = within(advanced).getByRole("option", { name: /Rating/ });
    expect(rating).toHaveTextContent("Stars out of five");
    unmount();

    render(
      <FieldPicker
        open
        config={{ ...CONFIG, surface: "entries" }}
        onAdd={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.queryByRole("option", { name: /Rating/ })).toBeNull();
    expect(optionNames()).not.toContain("rating");
  });

  it("drops the types a surface excludes, plugin ones included", () => {
    plugins = [
      {
        name: "ratings",
        collections: [],
        fieldTypes: [
          {
            type: "rating",
            component: "r",
            storage: "number",
            label: "Rating",
          },
        ],
      },
    ];
    renderPicker({
      config: { ...CONFIG, exclude: ["password", "rating"] },
    });
    expect(optionNames()).not.toContain("password");
    expect(optionNames()).not.toContain("rating");
    expect(optionNames()).toContain("text");
  });
});
