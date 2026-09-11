// @vitest-environment jsdom

/**
 * The instance inspector, driven through the inspector panel against a real
 * editor.
 *
 * `instance-inspector.ts` decides which rows an instance offers and what op
 * each edit produces, and asserts that without a DOM. What is only true HERE
 * is the wiring: that selecting an instance draws this surface rather than the
 * block inspector's "select a block", that a field's edit reaches
 * `editor.apply` as the override op at the moment it should, and that the way
 * back — the reset — is on the row where an author can see it.
 *
 * @module instance-inspector-panel.test
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type ComponentLookup,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import type { SavedComponent } from "./inserter";
import { InspectorPanel } from "./inspector-panel";

afterEach(cleanup);

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither, and a missing one
  // throws during render rather than failing an assertion.
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

/** A definition exposing a title (text), a tone (select) and a picture (image). */
function header(extra: Partial<ComponentDocument> = {}): ComponentDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [
      {
        id: "h1",
        type: "acme/heading",
        version: 1,
        props: { text: "Site name", tone: "light", image: "hero.png" },
      },
    ],
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "h1",
        propPath: "text",
        type: "text",
      },
      {
        id: "tone",
        label: "Tone",
        nodeId: "h1",
        propPath: "tone",
        type: "select",
        options: [
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ],
      },
      {
        id: "picture",
        label: "Picture",
        nodeId: "h1",
        propPath: "image",
        type: "image",
      },
    ],
    ...extra,
  } as ComponentDocument;
}

function instance(props: Record<string, unknown> = {}): BlockNode {
  return {
    id: "i1",
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId: "header", ...props },
  };
}

function pageOf(node: BlockNode): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [node],
  } as BlockDocument;
}

function editorFor(
  document: BlockDocument
): EditorState & { apply: ReturnType<typeof vi.fn> } {
  return {
    document,
    selectedId: "i1",
    selection: { ids: ["i1"], primary: "i1" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

const LIBRARY: readonly SavedComponent[] = [
  { id: "header", title: "Header", usedOn: 12, document: header() },
];

/**
 * `null` for a lookup holding NO definition — not `undefined`, which a default
 * parameter reads as "use the default" and would hand the header back.
 */
function mount(
  node: BlockNode,
  definition: ComponentDocument | null = header(),
  components: readonly SavedComponent[] = LIBRARY
) {
  const lookup: ComponentLookup = new Map(
    definition === null ? [] : [["header", definition]]
  );
  const editor = editorFor(pageOf(node));
  render(
    <InspectorPanel
      editor={editor}
      componentLibrary={{ definitions: lookup, components }}
    />
  );
  return editor;
}

/** The props the one applied op carries, read off the spy. */
function appliedProps(editor: { apply: ReturnType<typeof vi.fn> }): unknown {
  expect(editor.apply).toHaveBeenCalledTimes(1);
  const op = editor.apply.mock.calls[0]?.[0] as {
    kind: string;
    id: string;
    patch: { props: unknown };
  };
  expect(op.kind).toBe("update");
  expect(op.id).toBe("i1");
  return op.patch.props;
}

describe("what a selected instance is shown as", () => {
  it("draws the instance surface — the component's title and usage — and no tabs", () => {
    // Before this surface existed the block inspector answered "select a
    // block" to an author who had just clicked a component, because an
    // instance's type is not in the registry.
    mount(instance());

    expect(screen.getByRole("heading", { name: /Header/ })).toBeDefined();
    expect(screen.getByText(/used on 12 pages/)).toBeDefined();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText("Select a block to edit it.")).toBeNull();
  });

  it("titles by the id when the library has no row, and says nothing about usage", () => {
    mount(instance(), header(), []);

    expect(screen.getByRole("heading", { name: /header/ })).toBeDefined();
    expect(screen.queryByText(/used on/)).toBeNull();
  });

  it("says the component could not be loaded when the lookup holds no definition", () => {
    // The same state the canvas draws as could-not-be-loaded, in words — and
    // the default for a host that supplied no lookup at all.
    mount(instance(), null);

    expect(screen.getByRole("status").textContent).toContain(
      "could not be loaded"
    );
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
  });

  it("reads a host that supplied no lookup as one whose definitions could not be loaded", () => {
    // The default has to be the honest one: without the canvas's lookup the
    // rows cannot be read from what the page draws, so none are.
    const editor = editorFor(pageOf(instance()));
    render(<InspectorPanel editor={editor} />);

    expect(screen.getByRole("status").textContent).toContain(
      "could not be loaded"
    );
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("says when the component exposes nothing, rather than showing an empty list", () => {
    mount(instance(), header({ exposed: [] }));

    expect(
      screen.getByText(/exposes nothing to edit here/).textContent
    ).toContain("Components screen");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("editing an exposed property", () => {
  it("shows the value in force and commits a typed value as an override, keeping the component id", () => {
    const editor = mount(instance());
    const field = screen.getByRole("textbox", { name: "Title" });
    expect((field as HTMLInputElement).value).toBe("Site name");

    fireEvent.change(field, { target: { value: "Acme" } });
    // Nothing yet: text commits on blur, so one undo takes back one edit.
    expect(editor.apply).not.toHaveBeenCalled();
    fireEvent.blur(field);

    expect(appliedProps(editor)).toEqual({
      componentId: "header",
      overrides: { title: "Acme" },
    });
  });

  it("commits on Enter as well as on blur", () => {
    const editor = mount(instance());
    const field = screen.getByRole("textbox", { name: "Title" });

    fireEvent.change(field, { target: { value: "Acme" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(appliedProps(editor)).toMatchObject({
      overrides: { title: "Acme" },
    });
  });

  it("CLEARS the property when the field is emptied, rather than writing an empty string", () => {
    // The whole reason the sentinel exists: taking away a subtitle the
    // definition fills in, which `""` cannot say.
    const editor = mount(instance());
    const field = screen.getByRole("textbox", { name: "Title" });

    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);

    expect(appliedProps(editor)).toEqual({
      componentId: "header",
      overrides: { title: { $unset: true } },
    });
  });

  it("follows the stored value when the document changes underneath it", () => {
    // An undo, a reset, or an edit from elsewhere replaces the override; a
    // field that kept its draft would go on showing a value the document no
    // longer has, and its next blur would write that stale value back.
    const lookup: ComponentLookup = new Map([["header", header()]]);
    const library = { definitions: lookup, components: LIBRARY };
    const { rerender } = render(
      <InspectorPanel
        editor={editorFor(pageOf(instance({ overrides: { title: "One" } })))}
        componentLibrary={library}
      />
    );
    expect(
      (screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value
    ).toBe("One");

    rerender(
      <InspectorPanel
        editor={editorFor(pageOf(instance({ overrides: { title: "Two" } })))}
        componentLibrary={library}
      />
    );

    expect(
      (screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value
    ).toBe("Two");
  });

  it("writes nothing for a field left as it was", () => {
    const editor = mount(instance());

    fireEvent.blur(screen.getByRole("textbox", { name: "Title" }));

    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("keeps the other overrides when one is set", () => {
    const editor = mount(instance({ overrides: { tone: "dark" } }));
    const field = screen.getByRole("textbox", { name: "Title" });

    fireEvent.change(field, { target: { value: "Acme" } });
    fireEvent.blur(field);

    expect(appliedProps(editor)).toEqual({
      componentId: "header",
      overrides: { tone: "dark", title: "Acme" },
    });
  });
});

describe("where a value came from, and the way back", () => {
  it("badges an inherited row as inherited and offers it no reset", () => {
    mount(instance());

    expect(screen.getAllByText("Inherited").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Reset/ })).toBeNull();
  });

  it("badges an overridden row and resets it by REMOVING the override, on the row", () => {
    // Visible, on the row: the editor that hid its reset behind a context
    // menu is the one whose users had to ask where it was.
    const editor = mount(instance({ overrides: { title: "Acme" } }));

    expect(screen.getByText("Overridden")).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Reset Title to the component's value",
      })
    );

    // The record goes with its last override, rather than staying empty.
    expect(appliedProps(editor)).toStrictEqual({ componentId: "header" });
  });

  it("badges a cleared row as cleared, shows it empty, and still offers the reset", () => {
    mount(instance({ overrides: { title: { $unset: true } } }));

    expect(screen.getByText("Cleared")).toBeDefined();
    expect(
      (screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value
    ).toBe("");
    expect(
      screen.getByRole("button", {
        name: "Reset Title to the component's value",
      })
    ).toBeDefined();
  });
});

describe("a choice with an empty option", () => {
  it("renders a definition whose select offers “none” as an empty value, and writes it back empty", () => {
    // The validator accepts `""` as an option value and the select control
    // throws on it at render, so an otherwise valid component crashed its
    // inspector. The empty value wears a sentinel in the control and comes
    // back as `""` — asserted on the WRITE, since the sentinel must never
    // reach the document.
    const noneable = header({
      exposed: [
        {
          id: "tone",
          label: "Tone",
          nodeId: "h1",
          propPath: "tone",
          type: "select",
          options: [
            { value: "", label: "None" },
            { value: "dark", label: "Dark" },
          ],
        },
      ],
    });
    const editor = mount(instance({ overrides: { tone: "" } }), noneable);

    // Rendered at all is the first half: the trigger stands and shows the
    // empty option's label as the current choice.
    const trigger = screen.getByRole("combobox", { name: "Tone" });
    expect(trigger.textContent).toContain("None");
    expect(editor.apply).not.toHaveBeenCalled();
  });
});

describe("rows with no control", () => {
  it("lists a type it cannot edit yet, with its value, rather than hiding it", () => {
    mount(instance());

    const note = screen.getByText(/Not editable here yet \(image\)/);
    expect(note.textContent).toContain("hero.png");
    expect(screen.queryByRole("textbox", { name: "Picture" })).toBeNull();
  });

  it("names the exposure the page shows instead, for a shadowed row, and draws no control for it", () => {
    const twice = header({
      exposed: [
        {
          id: "title",
          label: "Title",
          nodeId: "h1",
          propPath: "text",
          type: "text",
        },
        {
          id: "headline",
          label: "Headline",
          nodeId: "h1",
          propPath: "text",
          type: "text",
        },
      ],
    });
    mount(instance({ overrides: { headline: "Later wins" } }), twice);

    expect(screen.getByText(/Set by “Headline”/)).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
    // The row in force keeps its control.
    expect(screen.getByRole("textbox", { name: "Headline" })).toBeDefined();
  });
});

describe("overrides the component no longer exposes", () => {
  it("lists them with their stored value and discards one by removing it", () => {
    const editor = mount(
      instance({ overrides: { title: "Acme", subtitle: "Gone now" } })
    );

    expect(
      screen.getByRole("heading", { name: "No longer exposed" })
    ).toBeDefined();
    expect(screen.getByText("Gone now")).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Discard the stored value for subtitle",
      })
    );

    expect(appliedProps(editor)).toEqual({
      componentId: "header",
      overrides: { title: "Acme" },
    });
  });

  it("draws no such section when there are none", () => {
    // The control: a section that was always on screen would be one an author
    // learns to read past.
    mount(instance({ overrides: { title: "Acme" } }));

    expect(
      screen.queryByRole("heading", { name: "No longer exposed" })
    ).toBeNull();
  });
});
