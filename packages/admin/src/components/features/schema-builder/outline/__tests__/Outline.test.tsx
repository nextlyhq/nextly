/**
 * The Builder's outline over the nested fixture: every field at every depth,
 * folding, finding, hidden fields, field groups, read-only rows, selection,
 * the form preview, and the tree's roles and keys.
 */
import { DndContext } from "@dnd-kit/core";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { FieldInsertPosition } from "@admin/lib/builder/insert-field";
import {
  judgeMove,
  moveDestinations,
  type MoveContext,
} from "@admin/lib/builder/move-rule";
import {
  buildOutline,
  flattenOutline,
  nodePlacement,
  type OutlineNode,
} from "@admin/lib/builder/outline/outline-model";
import type { FieldDefinition } from "@admin/types/collection";

import {
  nestedFixtureBlockCatalogs,
  nestedFixtureFieldGroups,
  nestedFixtureFields,
} from "../../__fixtures__/nested-fixture";
import { BuilderFieldSettings } from "../../BuilderFieldSettings";
import type { BuilderField } from "../../types";
import { FormPreview } from "../FormPreview";
import { Outline, type OutlineCallbacks } from "../Outline";

const FOLD_KEY = "test:outline:fixture";

/** The page's side, with the move rule's real answers over the fixture. */
function callbacks(entityReadOnly = false) {
  const fields = nestedFixtureFields();
  const ctx: MoveContext = { entityReadOnly, topLevelReservesNames: true };
  return {
    select: vi.fn(),
    addAt: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
    setHidden: vi.fn(),
    openFieldGroup: vi.fn(),
    fields,
    judgeMove: vi.fn((id: string, target: FieldInsertPosition) =>
      judgeMove(fields, id, target, ctx)
    ),
    moveDestinations: vi.fn((id: string) => moveDestinations(fields, id, ctx)),
    commitMove: vi.fn(),
  } satisfies OutlineCallbacks;
}

function fixtureOutline(entityReadOnly = false): OutlineNode[] {
  return buildOutline(nestedFixtureFields(), {
    entityReadOnly,
    entityLocalized: true,
    fieldGroups: nestedFixtureFieldGroups(),
  });
}

function renderOutline(
  options: {
    nodes?: OutlineNode[];
    selectedId?: string | null;
    readOnly?: boolean;
    on?: ReturnType<typeof callbacks>;
  } = {}
) {
  const on = options.on ?? callbacks(options.readOnly);
  const nodes = options.nodes ?? fixtureOutline(options.readOnly);
  const view = render(
    <DndContext>
      <Outline
        kind="collection"
        nodes={nodes}
        systemFields={[]}
        errors={
          new Map([
            [
              "f-cta-kind",
              {
                kind: "no-options" as const,
                message:
                  'Select/Radio field "kind" must have at least one option',
              },
            ],
          ])
        }
        foldKey={FOLD_KEY}
        selectedId={options.selectedId ?? null}
        readOnly={options.readOnly ?? false}
        callbacks={on}
        renderPreview={() => <p>The preview</p>}
      />
    </DndContext>
  );
  return { on, nodes, ...view };
}

const row = (path: string) =>
  document.querySelector<HTMLElement>(`[role="treeitem"][data-path="${path}"]`);
const paths = () =>
  screen.getAllByRole("treeitem").map(item => item.getAttribute("data-path"));

beforeEach(() => {
  window.localStorage.clear();
});

describe("the outline of the nested fixture", () => {
  it("a row for every field of the nested fixture", () => {
    renderOutline();
    expect(paths()).toEqual(
      flattenOutline(fixtureOutline()).map(node => node.path)
    );
    const label = row("sections/items/cta/label") as HTMLElement;
    expect(label).toHaveAttribute("aria-level", "4");
    expect(within(label).getByText("Button label")).toBeInTheDocument();
    expect(within(label).getByText("label")).toBeInTheDocument();
    expect(within(label).getByText("Text")).toBeInTheDocument();
  });

  it("marks each row with its badges", () => {
    renderOutline();
    const badges = (path: string) => (row(path) as HTMLElement).textContent;
    expect(badges("title")).toContain("Required");
    expect(badges("title")).toContain("Translatable");
    expect(badges("internal_note")).toContain("Hidden");
    expect(badges("banner_text")).toContain("Has a condition");
    expect(badges("meta/rating")).toContain(
      "Locked · Defined by @acme/reviews"
    );
    expect(badges("sections/items/cta/kind")).toContain("Has an error");
    // A long-text field left at its default translates in a translated
    // entity; a checkbox does not, and carries no badge at all.
    expect(badges("summary_a")).toContain("Translatable");
    expect(badges("show_banner")).not.toMatch(
      /Required|Translatable|Hidden|Has a condition|Locked|Has an error/
    );
  });

  it("folds each kind of container", async () => {
    renderOutline();
    const user = userEvent.setup();
    for (const [container, child] of [
      ["meta", "meta/title"],
      ["sections", "sections/heading"],
      ["sections/items", "sections/items/cta"],
      ["sections/items/cta", "sections/items/cta/label"],
      ["seo", "seo/meta_title"],
      ["seo/social", "seo/social/handle"],
    ] as const) {
      const item = row(container) as HTMLElement;
      expect(item).toHaveAttribute("aria-expanded", "true");
      item.focus();
      await user.keyboard("{ArrowLeft}");
      expect(row(container)).toHaveAttribute("aria-expanded", "false");
      expect(row(child)).toBeNull();
      await user.keyboard("{ArrowRight}");
      expect(row(child)).not.toBeNull();
    }
  });

  it("folds all and unfolds all, and remembers it for the entity", async () => {
    const { unmount } = renderOutline();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Fold all" }));
    expect(
      screen
        .getAllByRole("treeitem")
        .every(item => item.getAttribute("aria-level") === "1")
    ).toBe(true);
    unmount();

    // Drawn again, as after a reload: still folded.
    renderOutline();
    expect(row("meta/title")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Unfold all" }));
    expect(row("seo/social/handle")).not.toBeNull();
  });

  it("finds a match inside each kind of container", async () => {
    renderOutline();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Fold all" }));
    const find = screen.getByRole("searchbox", { name: "Find a field" });
    for (const [query, path] of [
      ["button label", "sections/items/cta/label"],
      ["rating", "meta/rating"],
      ["handle", "seo/social/handle"],
      ["Checkbox", "show_banner"],
    ] as const) {
      await user.clear(find);
      await user.type(find, query);
      expect(row(path)).not.toBeNull();
      // Every row drawn is the match or a container above it.
      for (const drawn of paths()) {
        expect(path.startsWith(drawn as string)).toBe(true);
      }
    }
  });

  it("a hidden field stays", async () => {
    const { on } = renderOutline();
    const hidden = row("internal_note") as HTMLElement;
    expect(hidden).toHaveTextContent("Hidden");
    await userEvent.click(hidden);
    expect(on.select).toHaveBeenCalledWith("f-internal-note");
    hidden.focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Show" })
    );
    expect(on.setHidden).toHaveBeenCalledWith("f-internal-note", false);
  });

  it("shows each accepted field group's own count, on its own row", () => {
    renderOutline({
      nodes: buildOutline(
        [
          {
            id: "f-zone",
            name: "zone",
            label: "Zone",
            type: "component",
            components: ["seo", "social"],
          } as BuilderField,
        ],
        { entityReadOnly: false, fieldGroups: nestedFixtureFieldGroups() }
      ),
    });
    expect(row("zone/@seo")).toHaveTextContent("Shared · used in 3 places");
    expect(row("zone/@social")).toHaveTextContent("Shared · used in 1 place");
    // The field itself stands for neither, so it carries no count.
    expect(row("zone")).not.toHaveTextContent("used in");
  });

  it("a field group's fields, read-only, with its link", async () => {
    const { on } = renderOutline();
    const field = row("seo/meta_title") as HTMLElement;
    expect(field).toHaveTextContent("Defined in the field group SEO");
    expect(row("seo")).toHaveTextContent("Shared · used in 3 places");
    field.focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Open the field group SEO" })
    );
    expect(on.openFieldGroup).toHaveBeenCalledWith("seo");
  });

  it("draws each accepted block and its props beneath a blocks field, read-only", async () => {
    const { on } = renderOutline({
      nodes: buildOutline(nestedFixtureFields(), {
        entityReadOnly: false,
        fieldGroups: nestedFixtureFieldGroups(),
        blockCatalogs: nestedFixtureBlockCatalogs(),
      }),
    });
    const heading = row("body/#core/heading") as HTMLElement;
    expect(heading).toHaveTextContent("Heading");
    expect(heading).toHaveTextContent("Block");
    expect(heading).toHaveTextContent(
      "Defined by @nextlyhq/plugin-page-builder"
    );
    expect(row("body/#core/heading/#level")).toHaveTextContent("Level");
    expect(row("body/#core/heading/#level")).toHaveTextContent("select");
    // The entry no registered block answers is said, not dropped.
    expect(row("body")).toHaveTextContent(
      "no registered block matches acme/hero"
    );
    // A block is no field: nothing to open, and no settings in its menu.
    await userEvent.click(heading);
    expect(on.select).not.toHaveBeenCalled();
    heading.focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    expect(screen.queryByRole("menuitem", { name: /settings/ })).toBeNull();
  });

  it("says why a blocks field's blocks are not shown, when they are not", () => {
    renderOutline({
      nodes: buildOutline(nestedFixtureFields(), {
        entityReadOnly: false,
        fieldGroups: nestedFixtureFieldGroups(),
        blockCatalogs: new Map([
          ['["core/heading","acme/hero"]', { state: "unavailable" as const }],
        ]),
      }),
    });
    expect(row("body")).toHaveTextContent(
      "block details need the Page Builder plugin"
    );
    expect(row("body/#core/heading")).toBeNull();
  });

  it("shows a blocks field with the blocks it accepts", () => {
    renderOutline();
    expect(row("body")).toHaveTextContent("Blocks: core/heading, acme/hero");
  });

  it.each([
    [undefined, "Blocks: any block"],
    [[], "Blocks: none accepted"],
    [["core/*", "acme/hero"], "Blocks: core/*, acme/hero"],
    [["a", "b", "c", "d", "e"], "Blocks: a, b, c and 2 more"],
  ] as const)(
    "says what a blocks field allowing %j accepts",
    (allow, words) => {
      const body: BuilderField = {
        id: "f-body",
        name: "body",
        label: "Body",
        type: "blocks",
        ...(allow === undefined ? {} : { blocks: { allow: [...allow] } }),
      } as BuilderField;
      renderOutline({
        nodes: buildOutline([body], {
          entityReadOnly: false,
          fieldGroups: new Map(),
        }),
      });
      expect(row("body")).toHaveTextContent(words);
    }
  );
});

describe("a read-only row", () => {
  const CHANGING = [
    "Add a field inside",
    "Add a field after",
    "Move up",
    "Move down",
    "Duplicate",
    "Hide",
    "Show",
    "Delete",
  ];

  async function menuOf(path: string): Promise<string[]> {
    (row(path) as HTMLElement).focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    const menu = await screen.findByRole("menu");
    const items = within(menu)
      .queryAllByRole("menuitem")
      .map(item => item.textContent ?? "");
    await userEvent.keyboard("{Escape}");
    return items;
  }

  it.each([
    [
      "a plugin-owned field nested in a group",
      "meta/rating",
      "Defined by @acme/reviews",
    ],
    ["a code-owned field", "legacy_code", "Defined in code"],
    [
      "a field group's field",
      "seo/meta_title",
      "Defined in the field group SEO",
    ],
    [
      "a field of a field group used inside a field group",
      "seo/social/handle",
      "Defined in the field group Social",
    ],
  ])(
    "each kind of read-only row offers no changing action: %s",
    async (_, path, where) => {
      const { on } = renderOutline();
      expect(row(path)).toHaveTextContent(where);
      const items = await menuOf(path);
      expect(items).toContain("View settings");
      for (const action of CHANGING) expect(items).not.toContain(action);
      // Nor by key: no "/", no Alt+arrow move.
      (row(path) as HTMLElement).focus();
      await userEvent.keyboard("/{Alt>}{ArrowUp}{ArrowDown}{/Alt}");
      expect(on.addAt).not.toHaveBeenCalled();
      expect(on.commitMove).not.toHaveBeenCalled();
    }
  );

  it("each kind of read-only row offers no changing action: a read-only entity", async () => {
    renderOutline({ readOnly: true });
    const items = await menuOf("title");
    for (const action of CHANGING) expect(items).not.toContain(action);
    expect(screen.queryByRole("button", { name: "+ Add field" })).toBeNull();
  });

  it("shows its settings in the panel without letting them change", () => {
    const nodes = fixtureOutline();
    const byId = new Map(flattenOutline(nodes).map(node => [node.id, node]));
    const node = byId.get("f-seo/meta_title") as OutlineNode;
    render(
      <BuilderFieldSettings
        kind="collection"
        fields={nestedFixtureFields()}
        fieldId={node.id}
        savedFieldIds={new Set()}
        readOnly={false}
        docked
        readOnlyReason={node.readOnly}
        fallbackPlacement={nodePlacement(node, byId, nodes)}
        onOpenFieldGroup={vi.fn()}
        onFieldChange={vi.fn()}
        onFieldDelete={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(
      screen.getByText("Defined in the field group SEO.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open the field group SEO" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete field" })).toBeNull();
    for (const input of screen.getAllByRole("textbox")) {
      expect(input).toBeDisabled();
    }
  });

  it("the panel finds a plugin-owned field read-only as the outline does", () => {
    render(
      <BuilderFieldSettings
        kind="collection"
        fields={nestedFixtureFields()}
        fieldId="f-meta-rating"
        savedFieldIds={new Set()}
        readOnly={false}
        docked
        onFieldChange={vi.fn()}
        onFieldDelete={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Defined by @acme/reviews.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete field" })).toBeNull();
  });
});

describe("selecting a row", () => {
  it("selecting keeps the scroll position", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { on, rerender, nodes } = renderOutline();
    await userEvent.click(row("sections/items/cta/label") as HTMLElement);
    expect(on.select).toHaveBeenCalledWith("f-cta-label");
    // Drawn selected, and nothing scrolled the outline to it.
    rerender(
      <DndContext>
        <Outline
          kind="collection"
          nodes={nodes}
          systemFields={[]}
          errors={new Map()}
          foldKey={FOLD_KEY}
          selectedId="f-cta-label"
          readOnly={false}
          callbacks={on}
          renderPreview={() => null}
        />
      </DndContext>
    );
    expect(row("sections/items/cta/label")).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
    // The outline moves focus to the row it selects without scrolling to it.
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
  });
});

describe("the tree", () => {
  it("tree roles, levels and expanded state", () => {
    renderOutline();
    const tree = screen.getByRole("tree", { name: "Fields" });
    const items = within(tree).getAllByRole("treeitem");
    expect(items.length).toBe(flattenOutline(fixtureOutline()).length);
    const rating = row("meta/rating") as HTMLElement;
    expect(rating).toHaveAttribute("aria-level", "2");
    expect(rating).toHaveAttribute("aria-posinset", "2");
    expect(rating).toHaveAttribute("aria-setsize", "2");
    expect(rating).not.toHaveAttribute("aria-expanded");
    expect(row("meta")).toHaveAttribute("aria-expanded", "true");
    // One tab stop, and no control inside any row.
    expect(items.filter(item => item.tabIndex === 0)).toHaveLength(1);
    for (const item of items) {
      expect(item.querySelector("button, a, input, [tabindex]")).toBeNull();
    }
  });

  it("arrows, Home, End and type-ahead", async () => {
    renderOutline();
    const user = userEvent.setup();
    (row("title") as HTMLElement).focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(row("summary_a"));
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(row("title"));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(row("seo/social/handle"));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(row("title"));
    // Left on a field inside a container goes to the container.
    (row("meta/rating") as HTMLElement).focus();
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(row("meta"));
    // Type-ahead finds the next row whose label starts with what was typed.
    await user.keyboard("se");
    expect(document.activeElement).toBe(row("sections"));
  });

  it("moves a field within its container by Alt and an arrow, and says so", async () => {
    const { on } = renderOutline();
    (row("summary_b") as HTMLElement).focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(on.commitMove).toHaveBeenCalledTimes(1);
    const [moved] = on.commitMove.mock.calls[0] as [BuilderField[]];
    expect(moved.slice(0, 3).map(field => field.name)).toEqual([
      "title",
      "summary_b",
      "summary_a",
    ]);
    expect(
      screen.getByText("Moved Summary up, position 2 of 11.")
    ).toBeInTheDocument();
  });
});

describe("the form preview", () => {
  it("the preview follows a width change", () => {
    const half = (id: string): BuilderField => ({
      id,
      name: id,
      label: id,
      type: "text",
      admin: { width: "50%" },
    });
    // A row of the form that holds two fields side by side.
    const twoColumns = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "[style*='grid-template-columns']"
        ),
      ].filter(grid => grid.children.length === 2);

    const { rerender } = render(
      <FormPreview
        kind="collection"
        fields={[half("first"), half("second")]}
        fieldGroups={new Map()}
        fieldGroupsLoad="loaded"
      />
    );
    expect(twoColumns()).toHaveLength(1);

    rerender(
      <FormPreview
        kind="collection"
        fieldGroupsLoad="loaded"
        fields={[
          half("first"),
          { ...half("second"), admin: { width: "100%" } },
        ]}
        fieldGroups={new Map()}
      />
    );
    expect(twoColumns()).toHaveLength(0);
  });

  it("opens in place of the outline and back", async () => {
    renderOutline();
    await userEvent.click(
      screen.getByRole("button", { name: "Preview the form" })
    );
    expect(screen.getByText("The preview")).toBeInTheDocument();
    expect(screen.queryByRole("tree")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Show the outline" })
    );
    expect(screen.getByRole("tree")).toBeInTheDocument();
  });
});

describe("the form preview's fields", () => {
  const titleField: BuilderField = {
    id: "system_title",
    name: "title",
    label: "Title",
    type: "text",
    isSystem: true,
  };
  const body: BuilderField = {
    id: "f-body",
    name: "body",
    label: "Body",
    type: "text",
  };

  it("draws a collection's built-in fields, as its entry form does", () => {
    render(
      <FormPreview
        kind="collection"
        fields={[titleField, body]}
        fieldGroups={new Map()}
        fieldGroupsLoad="loaded"
      />
    );
    expect(screen.getByLabelText(/Title/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Body/)).toBeInTheDocument();
  });

  it("draws none for a field group, which has no built-in fields of its own", () => {
    render(
      <FormPreview
        kind="field-group"
        fields={[titleField, body]}
        fieldGroups={new Map()}
        fieldGroupsLoad="loaded"
      />
    );
    expect(screen.queryByLabelText(/Title/)).toBeNull();
    expect(screen.getByLabelText(/Body/)).toBeInTheDocument();
  });

  it("seeds each field with its default, as the create form does, so a condition reading one holds", () => {
    render(
      <FormPreview
        kind="collection"
        fields={[
          {
            id: "f-show",
            name: "show_banner",
            label: "Show banner",
            type: "checkbox",
            defaultValue: true,
          },
          {
            id: "f-banner",
            name: "banner_text",
            label: "Banner text",
            type: "text",
            defaultValue: "Welcome",
            admin: {
              condition: {
                field: "show_banner",
                operator: "equals",
                value: true,
              },
            },
          },
        ]}
        fieldGroups={new Map()}
        fieldGroupsLoad="loaded"
      />
    );
    expect(screen.getByLabelText(/Banner text/)).toHaveValue("Welcome");
  });

  it("draws a field group placed directly inside another, as the entry form now does", () => {
    const groups = new Map([
      [
        "seo",
        {
          slug: "seo",
          label: "SEO",
          fields: [
            { name: "meta_title", label: "Meta title", type: "text" },
            {
              name: "social",
              label: "Social",
              type: "component",
              component: "social",
            },
          ] as FieldDefinition[],
        },
      ],
      [
        "social",
        {
          slug: "social",
          label: "Social",
          fields: [
            { name: "handle", label: "Handle", type: "text" },
          ] as FieldDefinition[],
        },
      ],
    ]);
    render(
      <FormPreview
        kind="collection"
        fields={[
          {
            id: "f-seo",
            name: "seo",
            label: "SEO",
            type: "component",
            component: "seo",
          } as BuilderField,
        ]}
        fieldGroups={groups}
        fieldGroupsLoad="loaded"
      />
    );
    expect(screen.getByLabelText(/Meta title/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Handle/)).toBeInTheDocument();
  });

  it("says when the field groups it uses could not be loaded", () => {
    render(
      <FormPreview
        kind="collection"
        fields={[body]}
        fieldGroups={new Map()}
        fieldGroupsLoad="failed"
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("could not be loaded");
  });
});

describe("a field group the outline was not handed", () => {
  it.each([
    ["loading", "Loading its fields…"],
    ["failed", "Its fields could not be loaded (seo)"],
    ["loaded", "No field group named seo"],
  ] as const)("says why its fields are missing while %s", (load, words) => {
    renderOutline({
      nodes: buildOutline(nestedFixtureFields(), {
        entityReadOnly: false,
        fieldGroups: new Map(),
        fieldGroupsLoad: load,
      }),
    });
    expect(row("seo")).toHaveTextContent(words);
    expect(row("seo/meta_title")).toBeNull();
  });
});

describe("moving past a read-only sibling", () => {
  it("is not offered, by key or in the menu", async () => {
    const { on } = renderOutline();
    // meta/title's next sibling is meta/rating, which a plugin owns.
    (row("meta/title") as HTMLElement).focus();
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(on.commitMove).not.toHaveBeenCalled();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    expect(
      await screen.findByRole("menuitem", { name: "Move down" })
    ).toHaveAttribute("aria-disabled", "true");
  });
});
