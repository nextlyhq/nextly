// @vitest-environment jsdom

/**
 * The component's own view in the inspector, over a real editor store.
 *
 * `component-fields` decides what an edit does and is asserted without a DOM.
 * What is only true HERE is the wiring: that a prop row's icon exposes the
 * prop, says so as a pressed button, and shows the field's name under it;
 * that a refusal is said beside the icon; that the fields are listed with
 * nothing selected, under a header naming the component; and that a removal
 * waits for the dialog's confirmation.
 *
 * @module component-fields-panel.test
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ComponentFieldsHost } from "./component-fields";
import { useEditorState, type EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

beforeEach(() => {
  registerBlocks(
    [
      {
        name: "acme/card",
        version: 1,
        description: "A card.",
        example: { props: {} },
        editor: { label: "Card" },
        render: () => null,
        props: {
          title: { type: "text", role: "content" },
          tone: { type: "select", options: ["light", "dark"] },
          count: { type: "number" },
        },
      },
      {
        name: "acme/sealed",
        version: 1,
        description: "A sealed area.",
        example: { props: {} },
        render: () => null,
        slots: {
          body: { defaultBlock: [{ type: "acme/card" }], lock: "contentOnly" },
        },
      },
    ] as never,
    { source: "component-fields-panel-test" }
  );
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

function component(
  envelope: Partial<ComponentDocument> = {}
): ComponentDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [
      { id: "c1", type: "acme/card", version: 1, props: {} },
      {
        id: "s1",
        type: "acme/sealed",
        version: 1,
        props: {},
        slots: {
          body: [{ id: "c2", type: "acme/card", version: 1, props: {} }],
        },
      },
    ],
    ...envelope,
  };
}

function mount(
  document: ComponentDocument,
  selected: string | null,
  host?: ComponentFieldsHost
) {
  const seen: { editor?: EditorState } = {};
  function Host() {
    const editor = useEditorState({ initialDocument: document });
    seen.editor = editor;
    React.useEffect(() => {
      if (selected !== null) editor.select(selected);
      // Selected once, as an author's first click would.
    }, []);
    return <InspectorPanel editor={editor} componentFields={host} />;
  }
  render(<Host />);
  return () => seen.editor!;
}

const fields = (editor: EditorState) =>
  (editor.document as ComponentDocument).exposed ?? [];

/** The expose control of one prop's row. */
function exposeRow(prop: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(
    `[data-expose-prop="${prop}"]`
  );
  if (row === null) throw new Error(`no expose control for ${prop}`);
  return row;
}

/** The icon button beside one prop that lets each placement change it. */
function exposeButton(prop: string): HTMLElement {
  return within(exposeRow(prop)).getByRole("button", {
    name: /^Let each placement/,
  });
}

describe("a prop row in a component's view", () => {
  it("exposes the prop with the icon beside it, and names the field under it", () => {
    const editor = mount(component(), "c1");
    const toggle = within(exposeRow("title")).getByRole("button", {
      name: "Let each placement change Title",
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);

    expect(fields(editor())).toMatchObject([
      { label: "Title", nodeId: "c1", propPath: "title", type: "text" },
    ]);
    // Pressed now, and the dashed row under the property names the field,
    // with the focus in it, since the name is what an author decides next.
    expect(exposeButton("title").getAttribute("aria-pressed")).toBe("true");
    const name = within(exposeRow("title")).getByRole("textbox", {
      name: "Name of the field for Title",
    });
    expect(name).toHaveProperty("value", "Title");
    expect(document.activeElement).toBe(name);
    // One edit, one undo step.
    expect(editor().undoDepth).toBe(1);
  });

  it("is a switch no longer: no row of switches under every property", () => {
    mount(component(), "c1");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("Expose to placements")).toBeNull();
  });

  it("renames the field on Enter, keeping its id", () => {
    const editor = mount(component(), "c1");
    fireEvent.click(exposeButton("title"));
    const id = fields(editor())[0]?.id;
    const name = within(exposeRow("title")).getByRole("textbox");
    fireEvent.change(name, { target: { value: "Headline" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(fields(editor())).toMatchObject([{ id, label: "Headline" }]);
  });

  it("asks before un-exposing a prop, and a field exposed again gets a new id", () => {
    const editor = mount(component(), "c1");
    fireEvent.click(exposeButton("title"));
    const first = fields(editor())[0]?.id;

    fireEvent.click(exposeButton("title"));
    const dialog = screen.getByRole("dialog", {
      name: "Remove the field “Title”?",
    });
    expect(fields(editor())).toHaveLength(1);
    act(() => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Remove field" })
      );
    });
    expect(fields(editor())).toEqual([]);

    // Placements may still hold values under the removed id until the
    // component is published, so the same name must not bring it back.
    fireEvent.click(exposeButton("title"));
    const second = fields(editor())[0]?.id;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it("holds the icon of a prop no placement could set, and says why when pressed", () => {
    const editor = mount(component(), "c1");
    const toggle = exposeButton("count");
    // Held, not disabled, so it can still be reached and its reason heard.
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(toggle.getAttribute("title")).toMatch(/can’t set a number value/);
    fireEvent.click(toggle);
    expect(fields(editor())).toEqual([]);
    expect(within(exposeRow("count")).getByRole("alert").textContent).toMatch(
      /can’t set a number value/
    );
  });

  it("refuses a non-content prop inside a contentOnly area when it is picked", () => {
    const editor = mount(component(), "c2");
    const toggle = exposeButton("tone");
    // Pressable though the lock holds the prop's own control: the refusal
    // that says why is the answer, and a dimmed icon would withhold it.
    expect(toggle.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(toggle);
    expect(within(exposeRow("tone")).getByRole("alert").textContent).toMatch(
      /locked to its content/
    );
    expect(fields(editor())).toEqual([]);
  });

  it("lets placements hide the block, from the same icon on its Shown row", () => {
    const editor = mount(component(), "c1");
    fireEvent.click(
      screen.getByRole("button", { name: "Let each placement hide Card" })
    );
    expect(fields(editor())).toMatchObject([
      { nodeId: "c1", type: "visibility", label: "Show card" },
    ]);
    expect(
      screen
        .getByRole("button", { name: "Let each placement hide Card" })
        .getAttribute("aria-pressed")
    ).toBe("true");
  });
});

describe("the component's fields, with nothing selected", () => {
  const exposedWithVariant = component({
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "c1",
        propPath: "title",
        type: "text",
      },
    ],
    variants: { night: { label: "Night", overrides: { title: "Late" } } },
  });

  it("heads the panel with the component's name and how much it holds", () => {
    mount(exposedWithVariant, null, { name: "Feature card" });
    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Feature card",
    });
    // The whole name on hover, for one too long for the panel.
    expect(heading.getAttribute("title")).toBe("Feature card");
    expect(screen.getByText("Component · 1 field · 1 variant")).toBeTruthy();
  });

  it("lists each field as a flat row: its type, its name, and where it comes from", () => {
    mount(exposedWithVariant, null);
    const list = screen.getByRole("region", { name: "Fields" });
    expect(
      within(list).getByRole("textbox", { name: "Name of the field Title" })
    ).toHaveProperty("value", "Title");
    expect(within(list).getByRole("img", { name: "Text" })).toBeTruthy();
    // Plain words: the block and its property, no stored names or ids.
    expect(list.textContent).toContain("Card title");
    expect(list.textContent).not.toMatch(/·\s*Title|Exposed/);
  });

  it("selects the field's block from its row", () => {
    const editor = mount(exposedWithVariant, null);
    fireEvent.click(
      screen.getByRole("button", { name: "Select the block Title comes from" })
    );
    expect(editor().selectedId).toBe("c1");
  });

  it("asks before removing, naming the variant that loses its value", () => {
    const editor = mount(exposedWithVariant, null);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove the field Title" })
    );
    const dialog = screen.getByRole("dialog", {
      name: "Remove the field “Title”?",
    });
    expect(dialog.textContent).toMatch(
      /Night: loses its value, and with nothing left it shows the defaults/
    );
    // Nothing changes until the author confirms.
    expect(fields(editor())).toHaveLength(1);

    act(() => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Remove field" })
      );
    });
    expect(fields(editor())).toEqual([]);
    expect(
      (editor().document as ComponentDocument).variants?.night?.overrides
    ).toEqual({});
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes nothing when the dialog is cancelled", () => {
    const editor = mount(exposedWithVariant, null);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove the field Title" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fields(editor())).toHaveLength(1);
  });

  it("says how to add the first field, pointing at the icon itself", () => {
    mount(component(), null, { name: "Promo band" });
    const list = screen.getByRole("region", { name: "Fields" });
    expect(list.textContent).toContain("No fields yet");
    // The icon itself sits in the sentence, named for a screen reader.
    expect(list.textContent).toContain("Select a block, then use");
    expect(list.textContent).toContain(
      "beside a property to let each placement change it."
    );
    expect(
      within(list).getByRole("img", { name: "the component mark" })
    ).toBeTruthy();
    expect(screen.getByText("Component · no fields yet")).toBeTruthy();
  });

  it("says nothing of fields on a page", () => {
    function Host() {
      const editor = useEditorState({
        initialDocument: {
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "page",
          nodes: [],
        },
      });
      return <InspectorPanel editor={editor} />;
    }
    render(<Host />);
    expect(screen.queryByRole("region", { name: "Fields" })).toBeNull();
    expect(screen.getByText("Select a block to edit it.")).toBeTruthy();
  });
});
