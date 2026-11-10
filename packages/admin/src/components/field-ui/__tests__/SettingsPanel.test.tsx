// Why: the shared settings panel's contract, one test per promise it makes.
// The same panel for a new and an existing field, every setting it shows kept
// in the definition, each edit recorded at once with no Apply, a settings
// section for every type (Blocks and plugin types included), every stored
// width, the path the API returns a field by, and a setting a surface fixes
// shown fixed with its reason.
import { fireEvent } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import { FIELD_TYPES_CATALOG } from "@admin/components/features/schema-builder/field-picker-modal/field-types-catalog";
import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { toSnakeName } from "@admin/lib/builder";
import { countDirtyFields } from "@admin/lib/builder/dirty-tracking";

import {
  FieldSettingsPanel,
  type FieldSettingsSurface,
} from "../settings-panel";

// The installed plugins the panel sees, so a test can contribute a field type
// the way /admin-meta does. Empty unless a test sets it.
const branding = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
// Whether the workspace metadata (the plugin list) has answered: settled by
// default, so a missing plugin is a fact unless a test says otherwise.
const brandingStatus = vi.hoisted(() => ({
  current: { isPending: false, isUnavailable: false, retry: () => {} },
}));

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => branding.current,
  useBrandingStatus: () => ({
    ...brandingStatus.current,
    isBrandingUnavailable: false,
  }),
}));

// What the link and field-group editors list to choose from: two of each, so
// a choice can always move away from the current one.
vi.mock("@admin/hooks/queries", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries")>()),
  useCollections: () => ({
    data: {
      items: [
        { name: "posts", label: "Posts" },
        { name: "pages", label: "Pages" },
      ],
    },
    isLoading: false,
  }),
  useSingles: () => ({ data: { items: [] }, isLoading: false }),
  useFieldGroups: () => ({
    data: {
      items: [
        { slug: "seo", label: "SEO" },
        { slug: "hero", label: "Hero" },
      ],
    },
    isLoading: false,
  }),
}));

const entries: FieldSettingsSurface = {
  surface: "entries",
  deriveName: toSnakeName,
  conditions: "sibling",
};

const TAB_NAMES = [
  "General",
  "Validation",
  "Display",
  "Conditions",
  "Advanced",
];

/** Every type the Builder offers, and Blocks, which reaches it stored. */
const CORE_TYPES = [...FIELD_TYPES_CATALOG.map(entry => entry.type), "blocks"];

/** The types whose defining settings come first in General. */
const TYPES_WITH_DEFINING_SETTINGS = new Set([
  "select",
  "radio",
  "checkbox",
  "upload",
  "relationship",
  "component",
  "blocks",
]);

/**
 * A field of a type, given what that type needs before its own settings can
 * all be shown: options for a choice, a target for a link, a field group, and
 * a field inside repeating rows to label the rows by.
 */
function fieldOfType(type: string): BuilderField {
  const field: BuilderField = {
    id: `f-${type}`,
    name: "subject",
    label: "Subject",
    type,
    validation: {},
  };
  if (type === "select" || type === "radio" || type === "checkbox") {
    field.options = [
      { label: "First", value: "first" },
      { label: "Second", value: "second" },
    ];
  }
  if (type === "relationship") field.relationTo = "posts";
  if (type === "component") field.component = "seo";
  if (type === "repeater") {
    field.fields = [
      { id: "f-inner", name: "heading", label: "Heading", type: "text" },
    ];
  }
  return field;
}

/** Holds the field as a host would: each change replaces it at once. */
function Host({
  initial,
  saved = false,
  readOnly = false,
  surface = entries,
  onChange,
}: {
  initial: BuilderField;
  saved?: boolean;
  readOnly?: boolean;
  surface?: FieldSettingsSurface;
  onChange?: (next: BuilderField) => void;
}) {
  const [field, setField] = useState(initial);
  return (
    <FieldSettingsPanel
      surface={surface}
      field={field}
      ancestors={[]}
      siblings={[]}
      saved={saved}
      readOnly={readOnly}
      onChange={next => {
        setField(next);
        onChange?.(next);
      }}
    />
  );
}

/** The accessible name of a control, the way a screen reader reads it. */
function nameOf(element: HTMLElement): string {
  const label = element.getAttribute("aria-label");
  if (label) return label;
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .split(" ")
      .map(id => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }
  const labels = (element as HTMLInputElement).labels;
  if (labels && labels.length > 0) return labels[0].textContent?.trim() ?? "";
  // A button is named by its text when nothing else names it.
  if (element.tagName === "BUTTON" && !element.getAttribute("role")) {
    return element.textContent?.trim() ?? "";
  }
  return "";
}

/** The controls that set something, in the open tab. Action buttons are not. */
function settingControls(tabPanel: HTMLElement): HTMLElement[] {
  return Array.from(
    tabPanel.querySelectorAll<HTMLElement>(
      'input, textarea, [role="switch"], [role="radio"], [role="combobox"], button[aria-pressed]'
    )
  ).filter(element => !(element as HTMLInputElement).disabled);
}

function isChosen(element: HTMLElement): boolean {
  return (
    element.getAttribute("aria-checked") === "true" ||
    element.getAttribute("aria-pressed") === "true" ||
    (element instanceof HTMLInputElement &&
      element.type === "radio" &&
      element.checked)
  );
}

/**
 * A new text for each control typed into, so no two controls are given the
 * same value: typing a label derives the name, and a name typed afterwards as
 * the same text would change nothing and read as a setting not kept.
 */
let typed = 0;

/** Sets a control to a value other than the one it has. */
async function changeControl(user: UserEvent, element: HTMLElement) {
  const role = element.getAttribute("role");
  if (role === "combobox") {
    await user.click(element);
    const options = await screen.findAllByRole("option");
    const other = options.find(
      option => option.getAttribute("aria-selected") !== "true"
    );
    if (other) await user.click(other);
    return;
  }
  if (role === "switch" || role === "radio" || element.tagName === "BUTTON") {
    await user.click(element);
    return;
  }
  const input = element as HTMLInputElement;
  if (input.type === "radio") {
    await user.click(input);
    return;
  }
  if (input.type === "date") {
    fireEvent.change(input, { target: { value: "2026-01-02" } });
    return;
  }
  if (input.value !== "") await user.clear(input);
  // A list's entry box keeps what is typed until Enter adds it.
  typed += 1;
  await user.type(
    input,
    input.type === "number" ? `${typed}{Enter}` : `value${typed}{Enter}`
  );
}

describe("FieldSettingsPanel", () => {
  describe("same panel for a new and an existing field", () => {
    /** Every tab's named setting controls, in order. */
    async function inventory(user: UserEvent): Promise<string[]> {
      const found: string[] = [];
      for (const tab of TAB_NAMES) {
        await user.click(screen.getByRole("tab", { name: tab }));
        for (const control of settingControls(screen.getByRole("tabpanel"))) {
          found.push(`${tab}: ${nameOf(control)}`);
        }
      }
      return found;
    }

    it.each(CORE_TYPES)("%s", async type => {
      const user = userEvent.setup();
      const field = fieldOfType(type);

      const view = render(<Host initial={field} saved={false} />);
      expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual(
        TAB_NAMES
      );
      expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute(
        "aria-selected",
        "true"
      );
      const general = screen.getByRole("tabpanel");
      const label = within(general).getByLabelText(/^Label$/);
      const defining = within(general).queryByRole("group", {
        name: / settings$/,
      });
      if (TYPES_WITH_DEFINING_SETTINGS.has(type)) {
        expect(defining).not.toBeNull();
        expect(
          defining!.compareDocumentPosition(label) &
            Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
      } else {
        expect(defining).toBeNull();
      }
      const asNew = await inventory(user);
      view.unmount();

      render(<Host initial={field} saved />);
      expect(await inventory(user)).toEqual(asNew);
    });
  });

  describe("every visible setting reaches the definition", () => {
    it.each(CORE_TYPES)("%s", async type => {
      const user = userEvent.setup();
      let current = fieldOfType(type);
      render(
        <Host
          initial={current}
          onChange={next => {
            current = next;
          }}
        />
      );

      const unnamed: string[] = [];
      const unkept: string[] = [];
      for (const tab of TAB_NAMES) {
        await user.click(screen.getByRole("tab", { name: tab }));
        const visited = new Set<string>();
        // Controls are found again after each change, since a change can show
        // more (a custom file type, the rows' bounds); one already chosen is
        // tried once another in its group has been chosen instead.
        for (let pass = 0; pass < 2; pass++) {
          for (;;) {
            const next = settingControls(screen.getByRole("tabpanel")).find(
              control =>
                !visited.has(`${nameOf(control)}`) &&
                !(pass === 0 && isChosen(control))
            );
            if (!next) break;
            const name = nameOf(next);
            visited.add(name);
            if (name === "") {
              unnamed.push(`${tab}: ${next.outerHTML.slice(0, 80)}`);
              continue;
            }
            const before = current;
            await changeControl(user, next);
            if (countDirtyFields([before], [current]) !== 1) {
              unkept.push(`${tab}: ${name}`);
            }
          }
        }
      }
      expect(unnamed).toEqual([]);
      expect(unkept).toEqual([]);
    });
  });

  describe("a read-only panel disables the type's own controls", () => {
    // Blocks draws no edit controls at all when read-only (its lists are shown
    // as text), so it is checked separately below.
    it.each([...TYPES_WITH_DEFINING_SETTINGS].filter(t => t !== "blocks"))(
      "%s",
      type => {
        render(<Host initial={fieldOfType(type)} readOnly />);
        const defining = screen.getByRole("group", { name: / settings$/ });
        const controls = Array.from(
          defining.querySelectorAll<HTMLElement>(
            'input, textarea, button, [role="switch"], [role="combobox"]'
          )
        );
        expect(controls.length).toBeGreaterThan(0);
        const enabled = controls
          .filter(control => !control.matches(":disabled"))
          .map(control => control.outerHTML.slice(0, 80));
        expect(enabled).toEqual([]);
      }
    );
  });

  it("a read-only Blocks field shows its lists with nothing to edit", () => {
    render(
      <Host
        initial={{ ...fieldOfType("blocks"), blocks: { allow: ["core/*"] } }}
        readOnly
      />
    );
    const defining = screen.getByRole("group", { name: / settings$/ });
    expect(within(defining).getByText("core/*")).toBeInTheDocument();
    expect(within(defining).queryAllByRole("textbox")).toEqual([]);
    expect(within(defining).queryAllByRole("button")).toEqual([]);
  });

  it("edit, select another field, come back", async () => {
    const user = userEvent.setup();
    const first: BuilderField = {
      id: "f-a",
      name: "title_text",
      label: "Title",
      type: "text",
    };
    const second: BuilderField = {
      id: "f-b",
      name: "summary",
      label: "Summary",
      type: "textarea",
    };

    // A host holding two fields and showing one at a time, as the Builder
    // does: the panel is keyed by the field, so nothing survives in it.
    function TwoFields() {
      const [fields, setFields] = useState([first, second]);
      const [selected, setSelected] = useState(first.id);
      const field = fields.find(f => f.id === selected)!;
      return (
        <>
          {fields.map(f => (
            <button key={f.id} type="button" onClick={() => setSelected(f.id)}>
              {`Select ${f.id}`}
            </button>
          ))}
          <FieldSettingsPanel
            key={field.id}
            surface={entries}
            field={field}
            ancestors={[]}
            siblings={fields.filter(f => f.id !== field.id)}
            saved
            onChange={next =>
              setFields(all => all.map(f => (f.id === next.id ? next : f)))
            }
          />
        </>
      );
    }

    render(<TwoFields />);
    // Nothing to apply: the panel has no Apply, Save or Cancel.
    expect(
      screen.queryByRole("button", { name: /apply|save|cancel/i })
    ).toBeNull();

    const description = screen.getByLabelText("Description");
    await user.type(description, "Shown above the title");
    await user.click(screen.getByRole("button", { name: "Select f-b" }));
    expect(screen.getByLabelText(/^Label$/)).toHaveValue("Summary");
    await user.click(screen.getByRole("button", { name: "Select f-a" }));
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Shown above the title"
    );
  });

  it("the Blocks field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Host
        initial={{
          id: "f-content",
          name: "content",
          label: "Content",
          type: "blocks",
          blocks: { allow: ["core/*"] },
        }}
        onChange={onChange}
      />
    );
    const accepts = screen.getByRole("list", { name: "Blocks it accepts" });
    expect(within(accepts).getByText("core/*")).toBeInTheDocument();

    await user.type(
      screen.getByRole("textbox", { name: "Blocks it accepts" }),
      "acme/hero{Enter}"
    );
    expect(onChange.mock.lastCall?.[0].blocks).toEqual({
      allow: ["core/*", "acme/hero"],
    });

    // Removing every name stores no list, which the policy reads as "any".
    await user.click(screen.getByRole("button", { name: "Remove core/*" }));
    await user.click(screen.getByRole("button", { name: "Remove acme/hero" }));
    expect(onChange.mock.lastCall?.[0]).not.toHaveProperty("blocks");
  });

  it("a test plugin's field type", async () => {
    const user = userEvent.setup();
    branding.current = {
      plugins: [
        {
          name: "rating-plugin",
          enabled: true,
          fieldTypes: [
            {
              type: "star-rating",
              component: "rating-plugin/StarRating",
              storage: "number",
              label: "Star rating",
              settings: [
                { key: "max", label: "Most stars", control: "number" },
                {
                  key: "caption",
                  label: "Caption",
                  control: "text",
                  help: "Shown under the stars.",
                },
                {
                  key: "shape",
                  label: "Shape",
                  control: "select",
                  tab: "display",
                  options: [
                    { label: "Star", value: "star" },
                    { label: "Heart", value: "heart" },
                  ],
                },
                {
                  key: "half",
                  label: "Half stars",
                  control: "boolean",
                  tab: "advanced",
                },
              ],
            },
          ],
        },
      ],
    };
    try {
      let current: BuilderField = {
        id: "f-rating",
        name: "rating",
        label: "Rating",
        type: "star-rating",
        pluginOptions: { shape: "star" },
      };
      render(
        <Host
          initial={current}
          onChange={next => {
            current = next;
          }}
        />
      );

      // The settings the type declares for General come first, as its own.
      const general = screen.getByRole("tabpanel");
      const own = within(general).getByRole("group", {
        name: "Star rating settings",
      });
      expect(
        own.compareDocumentPosition(within(general).getByLabelText(/^Label$/)) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(screen.queryByText(/has no settings of its own/)).toBeNull();
      expect(within(own).getByLabelText("Caption")).toHaveAccessibleDescription(
        "Shown under the stars."
      );

      // Each one is kept in the field's own options, under its key.
      await user.type(within(own).getByLabelText("Most stars"), "5");
      await user.type(within(own).getByLabelText("Caption"), "Rate it");
      expect(current.pluginOptions).toMatchObject({
        max: 5,
        caption: "Rate it",
      });

      await user.click(screen.getByRole("tab", { name: "Display" }));
      await user.click(screen.getByRole("combobox", { name: "Shape" }));
      await user.click(await screen.findByRole("option", { name: "Heart" }));
      expect(current.pluginOptions?.shape).toBe("heart");

      await user.click(screen.getByRole("tab", { name: "Advanced" }));
      await user.click(screen.getByRole("switch", { name: "Half stars" }));
      expect(current.pluginOptions?.half).toBe(true);

      // Emptying a box removes the setting rather than storing an empty value.
      await user.click(screen.getByRole("tab", { name: "General" }));
      await user.clear(screen.getByLabelText("Caption"));
      expect(current.pluginOptions).not.toHaveProperty("caption");
    } finally {
      branding.current = {};
    }
  });

  it("keeps a declared number's sign and decimal point while it is typed", async () => {
    const user = userEvent.setup();
    branding.current = {
      plugins: [
        {
          name: "rating-plugin",
          enabled: true,
          fieldTypes: [
            {
              type: "star-rating",
              component: "rating-plugin/StarRating",
              storage: "number",
              label: "Star rating",
              settings: [{ key: "offset", label: "Offset", control: "number" }],
            },
          ],
        },
      ],
    };
    try {
      let current: BuilderField = {
        id: "f-rating",
        name: "rating",
        label: "Rating",
        type: "star-rating",
      };
      render(
        <Host
          initial={current}
          onChange={next => {
            current = next;
          }}
        />
      );
      const offset = screen.getByLabelText("Offset");
      await user.type(offset, "-5");
      expect(current.pluginOptions?.offset).toBe(-5);
      await user.clear(offset);
      expect(current.pluginOptions).not.toHaveProperty("offset");
      await user.type(offset, "1.5");
      expect(current.pluginOptions?.offset).toBe(1.5);
      expect(offset).toHaveValue("1.5");
    } finally {
      branding.current = {};
    }
  });

  describe("a plugin type whose plugin list has not arrived", () => {
    const rating: BuilderField = {
      id: "f-rating",
      name: "rating",
      label: "Rating",
      type: "star-rating",
    };

    it("says its settings are loading, not that it has none", () => {
      brandingStatus.current = { ...brandingStatus.current, isPending: true };
      try {
        render(<Host initial={rating} />);
        expect(
          screen.getByText(/loading this type's settings/i)
        ).toBeInTheDocument();
        expect(screen.queryByText(/has no settings of its own/)).toBeNull();
      } finally {
        brandingStatus.current = {
          ...brandingStatus.current,
          isPending: false,
        };
      }
    });

    it("says its settings could not be loaded, with a retry, when the list never came", async () => {
      const user = userEvent.setup();
      const retry = vi.fn();
      brandingStatus.current = { isPending: false, isUnavailable: true, retry };
      try {
        render(<Host initial={rating} />);
        expect(
          screen.getByText(/settings could not be loaded/i)
        ).toBeInTheDocument();
        expect(screen.queryByText(/has no settings of its own/)).toBeNull();
        await user.click(screen.getByRole("button", { name: "Retry" }));
        expect(retry).toHaveBeenCalledTimes(1);
      } finally {
        brandingStatus.current = {
          isPending: false,
          isUnavailable: false,
          retry: () => {},
        };
      }
    });
  });

  it("a test plugin's field type that declares no settings", () => {
    branding.current = {
      plugins: [
        {
          name: "rating-plugin",
          enabled: true,
          fieldTypes: [
            {
              type: "star-rating",
              component: "rating-plugin/StarRating",
              storage: "number",
              label: "Star rating",
            },
          ],
        },
      ],
    };
    try {
      render(
        <Host
          initial={{
            id: "f-rating",
            name: "rating",
            label: "Rating",
            type: "star-rating",
          }}
        />
      );
      // Named by the plugin, with every setting fields share, never empty.
      expect(screen.getByText(/Star rating$/)).toBeInTheDocument();
      expect(
        screen.getByText(/Star rating has no settings of its own/)
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/^Label$/)).toBeInTheDocument();
      expect(
        screen.getByRole("switch", { name: "Required" })
      ).toBeInTheDocument();
    } finally {
      branding.current = {};
    }
  });

  it.each(["25%", "33%", "50%", "66%", "75%", "100%"] as const)(
    "opens a field stored at each width: %s",
    width => {
      render(
        <Host
          initial={{
            id: "f-w",
            name: "w",
            label: "W",
            type: "text",
            admin: { width },
          }}
        />
      );
      const widths = screen.getByRole("radiogroup", { name: "Width" });
      expect(within(widths).getByRole("radio", { name: width })).toBeChecked();
      expect(
        within(widths).getAllByRole("radio", { checked: true })
      ).toHaveLength(1);
    }
  );

  it("shows `authors[].social[].url` for a field two levels deep", () => {
    const url: BuilderField = {
      id: "f-url",
      name: "url",
      label: "URL",
      type: "text",
    };
    const social: BuilderField = {
      id: "f-social",
      name: "social",
      label: "Social links",
      type: "repeater",
      fields: [url],
    };
    const authors: BuilderField = {
      id: "f-authors",
      name: "authors",
      label: "Authors",
      type: "repeater",
      fields: [social],
    };
    render(
      <FieldSettingsPanel
        surface={entries}
        field={url}
        ancestors={[authors, social]}
        siblings={[]}
        saved={false}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("authors[].social[].url")).toBeInTheDocument();
  });

  it("shows a group's field as a key of the group's object, with no list marker", () => {
    const title: BuilderField = {
      id: "f-t",
      name: "meta_title",
      label: "Meta title",
      type: "text",
    };
    const seo: BuilderField = {
      id: "f-seo",
      name: "seo",
      label: "SEO",
      type: "group",
      fields: [title],
    };
    render(
      <FieldSettingsPanel
        surface={entries}
        field={title}
        ancestors={[seo]}
        siblings={[]}
        saved={false}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("seo.meta_title")).toBeInTheDocument();
  });

  describe("an existing user field's name and type are fixed, with the reason", () => {
    const users: FieldSettingsSurface = {
      surface: "users",
      deriveName: toSnakeName,
      conditions: "none",
      fixed: [
        {
          setting: "name",
          when: "saved",
          reason: "A user field's name is fixed once it is created.",
        },
        {
          setting: "type",
          when: "saved",
          reason:
            "A user field's type is fixed once it is created; add a field of another type instead.",
        },
      ],
    };
    const company: BuilderField = {
      id: "f-company",
      name: "company",
      label: "Company",
      type: "text",
    };

    it("fixes both once the field is saved", () => {
      render(<Host initial={company} surface={users} saved />);
      const name = screen.getByLabelText(/^Name$/);
      expect(name).toBeDisabled();
      expect(name).toHaveAccessibleDescription(
        /a user field's name is fixed once it is created/i
      );
      expect(
        screen.getByText(/a user field's type is fixed once it is created/i)
      ).toBeInTheDocument();
    });

    it("leaves both open before the field is saved", () => {
      render(<Host initial={company} surface={users} saved={false} />);
      expect(screen.getByLabelText(/^Name$/)).toBeEnabled();
      expect(screen.queryByText(/is fixed once it is created/i)).toBeNull();
    });
  });
});
