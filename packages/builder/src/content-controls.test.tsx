// @vitest-environment jsdom

/**
 * The Content tab's controls registry, and the rule every inspector label
 * keeps: it names a control that is actually drawn.
 *
 * - Each prop type the registry knows resolves to its control, and the
 *   inspection marks exactly those types supported, from the same list.
 * - A prop of a type the registry does not know is still listed, by name,
 *   with no `<label for>` pointing at nothing.
 * - Every `<label for>` and `aria-labelledby` in the inspector resolves to an
 *   element in the page.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { CONTENT_CONTROL_TYPES, contentControlFor } from "./content-controls";
import type { EditorState } from "./editor-state";
import { inspectSelection } from "./inspector";
import { InspectorPanel } from "./inspector-panel";

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

/** A block with one prop of every type given. */
function register(types: readonly string[]): void {
  registerBlocks(
    [
      {
        name: "acme/every",
        version: 1,
        description: "A prop of every kind.",
        example: { props: {} },
        editor: { label: "Every" },
        props: Object.fromEntries(
          types.map(type =>
            type === "select"
              ? [`a_${type}`, { type, options: ["one", "two"] }]
              : [`a_${type}`, { type }]
          )
        ),
        render: () => null,
      },
    ] as never,
    { source: "content-controls-test" }
  );
}

function editorFor(document: BlockDocument): EditorState {
  return {
    document,
    selectedId: "a",
    selection: { ids: ["a"], primary: "a" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    // Nothing composed around the page: its own tree is all there is.
    composed: () => undefined,
  } as unknown as EditorState;
}

const documentOf = (): BlockDocument =>
  ({
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "a", type: "acme/every", version: 1, props: {} } as BlockNode,
    ],
  }) as BlockDocument;

describe("the controls registry", () => {
  it("has a control for each type it lists", () => {
    // The positive control: the list is not empty.
    expect(CONTENT_CONTROL_TYPES.length).toBeGreaterThan(5);
    for (const type of CONTENT_CONTROL_TYPES) {
      expect(contentControlFor(type), type).toBeDefined();
    }
  });

  it("has none for a type it does not list", () => {
    expect(contentControlFor("acme-unknown")).toBeUndefined();
    // An inherited name must not resolve to something that is not a control.
    expect(contentControlFor("constructor")).toBeUndefined();
  });

  it("marks a prop supported exactly when the registry has its type", () => {
    register([...CONTENT_CONTROL_TYPES, "acme-unknown"]);
    const inspection = inspectSelection(documentOf(), "a");
    const supported = Object.fromEntries(
      (inspection?.props ?? []).map(prop => [prop.schema.type, prop.supported])
    );
    for (const type of CONTENT_CONTROL_TYPES)
      expect(supported[type], type).toBe(true);
    expect(supported["acme-unknown"]).toBe(false);
  });
});

describe("every label names a drawn control", () => {
  it("draws a control for each known type", () => {
    register(CONTENT_CONTROL_TYPES);
    const { container } = render(
      <InspectorPanel editor={editorFor(documentOf())} />
    );
    const fields = container.querySelectorAll("[data-content-control]");
    expect(
      [...fields]
        .map(field => field.getAttribute("data-content-control"))
        .sort()
    ).toEqual([...CONTENT_CONTROL_TYPES].sort());
  });

  it("leaves no label pointing at nothing, an unsupported prop included", () => {
    register([...CONTENT_CONTROL_TYPES, "acme-unknown"]);
    const { container } = render(
      <InspectorPanel editor={editorFor(documentOf())} />
    );

    // The positive control: there are labels to check.
    const labels = [...container.querySelectorAll("label[for]")];
    expect(labels.length).toBeGreaterThan(3);
    const dangling = labels
      .map(label => label.getAttribute("for") ?? "")
      .filter(id => document.getElementById(id) === null);
    expect(dangling).toEqual([]);

    const labelledBy = [...container.querySelectorAll("[aria-labelledby]")]
      .flatMap(element =>
        (element.getAttribute("aria-labelledby") ?? "").split(/\s+/)
      )
      .filter(id => id !== "" && document.getElementById(id) === null);
    expect(labelledBy).toEqual([]);

    // The unsupported prop is still listed, with its type.
    expect(container.textContent).toContain("acme-unknown");
  });
});

describe("what an author reads", () => {
  /** One block whose props carry, or leave out, the author's words. */
  function registerWorded(): void {
    registerBlocks(
      [
        {
          name: "acme/every",
          version: 1,
          description: "Worded props.",
          example: { props: {} },
          editor: { label: "Every" },
          props: {
            alt: { type: "text", label: "Alt text" },
            plain: { type: "text" },
            loading: {
              type: "select",
              label: "Loading",
              options: ["lazy", "eager"],
              optionLabels: { lazy: "Load when near the screen" },
            },
            open: { type: "checkbox", label: "Open by default" },
            tag: {
              type: "select",
              label: "HTML tag",
              display: "menu",
              options: ["div", "section", "article", "aside"],
              optionLabels: {
                div: "Generic box",
                section: "Section",
                article: "Article",
                aside: "Aside",
              },
              showOptionValue: true,
            },
          },
          render: () => null,
        },
      ] as never,
      { source: "content-controls-test" }
    );
  }

  it("labels a field with the words its block gives, and its name otherwise", () => {
    registerWorded();
    const document = documentOf();
    (document.nodes[0] as BlockNode).props = { loading: "lazy" };
    const { getByLabelText, getByText } = render(
      <InspectorPanel editor={editorFor(document)} />
    );
    expect(getByLabelText("Alt text")).toBeDefined();
    // The control: a prop with no words of its own keeps its spaced name.
    expect(getByLabelText("Plain")).toBeDefined();
    // The option's words, not the stored value, on the select.
    expect(getByText("Load when near the screen")).toBeDefined();
  });

  it("draws an on/off prop as a switch that says what on does", () => {
    registerWorded();
    const { getByRole, queryByRole } = render(
      <InspectorPanel editor={editorFor(documentOf())} />
    );
    expect(getByRole("switch", { name: "Open by default" })).toBeDefined();
    expect(queryByRole("checkbox")).toBeNull();
  });

  it("shows an option's value muted beside its words, where the block asks", () => {
    // "div" read as code; "Generic box" alone hid the tag from whoever knows it.
    registerWorded();
    const { getByRole } = render(
      <InspectorPanel editor={editorFor(documentOf())} />
    );
    fireEvent.click(getByRole("combobox", { name: "HTML tag" }));
    const option = getByRole("option", { name: /Generic box/ });
    expect(
      option.querySelector(".nx-inspector__option-value")?.textContent
    ).toBe("div");
  });

  it("puts an on/off prop's label in the label column and its switch in the control column", () => {
    // The switch drawn before its label broke the column every other row
    // keeps: label on the left, control on the right.
    registerWorded();
    const { getByRole } = render(
      <InspectorPanel editor={editorFor(documentOf())} />
    );
    const toggle = getByRole("switch", { name: "Open by default" });
    const row = toggle.closest('[data-content-control="checkbox"]');
    expect(row?.className).not.toContain("nx-inspector__field--inline");
    expect(row?.firstElementChild?.tagName).toBe("LABEL");
    expect(row?.lastElementChild).toBe(toggle);
  });
});

describe("a few short options in a row", () => {
  function registerChoices(): void {
    registerBlocks(
      [
        {
          name: "acme/every",
          version: 1,
          description: "Choices.",
          example: { props: {} },
          editor: { label: "Every" },
          props: {
            kind: {
              type: "select",
              label: "Kind",
              options: ["unordered", "ordered"],
              optionLabels: { unordered: "Bulleted", ordered: "Numbered" },
            },
            as: {
              type: "select",
              label: "Element type",
              options: ["div", "section", "article"],
              display: "menu",
            },
            loading: {
              type: "select",
              options: ["lazy", "eager"],
              optionLabels: {
                lazy: "Load when near the screen",
                eager: "Load immediately",
              },
            },
          },
          render: () => null,
        },
      ] as never,
      { source: "content-controls-test" }
    );
  }

  function mountWith(props: Record<string, unknown>) {
    registerChoices();
    const document = documentOf();
    (document.nodes[0] as BlockNode).props = props;
    const editor = editorFor(document);
    const view = render(<InspectorPanel editor={editor} />);
    return { editor, view };
  }

  it("draws them as radio buttons the arrow keys move between", () => {
    const { editor, view } = mountWith({ kind: "unordered" });
    const kind = view.getByRole("radiogroup", { name: "Kind" });
    const bulleted = view.getByRole("radio", { name: "Bulleted" });
    expect(bulleted.getAttribute("aria-checked")).toBe("true");
    // Only the chosen one is in the tab order.
    expect(bulleted.tabIndex).toBe(0);
    expect(view.getByRole("radio", { name: "Numbered" }).tabIndex).toBe(-1);

    fireEvent.keyDown(bulleted, { key: "ArrowRight" });
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { props: { kind: "ordered" } },
    });
    expect(kind).toBeDefined();
  });

  it("keeps a menu for options too long to sit side by side", () => {
    const { view } = mountWith({ loading: "lazy" });
    expect(view.queryByRole("radiogroup", { name: "Loading" })).toBeNull();
    expect(view.getByRole("combobox", { name: "Loading" })).toBeDefined();
  });

  it("keeps a menu where the block asks for one, however short the options", () => {
    // One prop drawn one way on every block: a block's element type is a
    // menu whether it offers three tags or four.
    const { view } = mountWith({ as: "div" });
    expect(view.queryByRole("radiogroup", { name: "Element type" })).toBeNull();
    expect(view.getByRole("combobox", { name: "Element type" })).toBeDefined();
  });

  it("keeps a menu while the stored value is none of the options", () => {
    // A row would show nothing chosen and replace the value on a click.
    const { view } = mountWith({ kind: "dashed" });
    expect(view.queryByRole("radiogroup", { name: "Kind" })).toBeNull();
    expect(view.getByRole("combobox", { name: "Kind" })).toBeDefined();
  });
});

describe("a prop never set", () => {
  function registerDefaults(): void {
    registerBlocks(
      [
        {
          name: "acme/every",
          version: 1,
          description: "Defaults.",
          example: { props: {} },
          editor: { label: "Every" },
          props: {
            full: { type: "checkbox", label: "Allow full screen" },
            loading: {
              type: "select",
              label: "Loading",
              options: ["lazy", "eager"],
            },
          },
          defaultProps: { full: true, loading: "lazy" },
          render: () => null,
        },
      ] as never,
      { source: "content-controls-test" }
    );
  }

  it("shows the block's default, since that is the value that applies", () => {
    registerDefaults();
    const view = render(<InspectorPanel editor={editorFor(documentOf())} />);
    expect(
      view
        .getByRole("switch", { name: "Allow full screen" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      view.getByRole("radio", { name: "lazy" }).getAttribute("aria-checked")
    ).toBe("true");
  });

  it("shows a stored value over the default", () => {
    registerDefaults();
    const document = documentOf();
    (document.nodes[0] as BlockNode).props = { full: false, loading: "eager" };
    const view = render(<InspectorPanel editor={editorFor(document)} />);
    expect(
      view
        .getByRole("switch", { name: "Allow full screen" })
        .getAttribute("aria-checked")
    ).toBe("false");
    expect(
      view.getByRole("radio", { name: "eager" }).getAttribute("aria-checked")
    ).toBe("true");
  });
});
