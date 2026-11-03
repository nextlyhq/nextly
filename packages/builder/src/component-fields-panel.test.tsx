// @vitest-environment jsdom

/**
 * The component's own view in the inspector, over a real editor store.
 *
 * `component-fields` decides what an edit does and is asserted without a DOM.
 * What is only true HERE is the wiring: that a prop row's switch exposes the
 * prop and shows its name, that a refusal is said beside the switch, that the
 * fields are listed with nothing selected, and that a removal waits for the
 * dialog's confirmation.
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

function mount(document: ComponentDocument, selected: string | null) {
  const seen: { editor?: EditorState } = {};
  function Host() {
    const editor = useEditorState({ initialDocument: document });
    seen.editor = editor;
    React.useEffect(() => {
      if (selected !== null) editor.select(selected);
      // Selected once, as an author's first click would.
    }, []);
    return <InspectorPanel editor={editor} />;
  }
  render(<Host />);
  return () => seen.editor!;
}

const fields = (editor: EditorState) =>
  (editor.document as ComponentDocument).exposed ?? [];

/** The expose control under one prop's row. */
function exposeRow(prop: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(
    `[data-expose-prop="${prop}"]`
  );
  if (row === null) throw new Error(`no expose control for ${prop}`);
  return row;
}

describe("a prop row in a component's view", () => {
  it("exposes the prop when switched on, and names the field", () => {
    const editor = mount(component(), "c1");
    fireEvent.click(within(exposeRow("title")).getByRole("switch"));

    expect(fields(editor())).toMatchObject([
      { label: "Title", nodeId: "c1", propPath: "title", type: "text" },
    ]);
    expect(
      within(exposeRow("title")).getByRole("textbox", {
        name: "Name of the exposed field for Title",
      })
    ).toHaveProperty("value", "Title");
    // One edit, one undo step.
    expect(editor().undoDepth).toBe(1);
  });

  it("renames the field on Enter, keeping its id", () => {
    const editor = mount(component(), "c1");
    fireEvent.click(within(exposeRow("title")).getByRole("switch"));
    const id = fields(editor())[0]?.id;
    const name = within(exposeRow("title")).getByRole("textbox");
    fireEvent.change(name, { target: { value: "Headline" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(fields(editor())).toMatchObject([{ id, label: "Headline" }]);
  });

  it("asks before switching an exposed prop off, and a field exposed again gets a new id", () => {
    const editor = mount(component(), "c1");
    fireEvent.click(within(exposeRow("title")).getByRole("switch"));
    const first = fields(editor())[0]?.id;

    fireEvent.click(within(exposeRow("title")).getByRole("switch"));
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
    fireEvent.click(within(exposeRow("title")).getByRole("switch"));
    const second = fields(editor())[0]?.id;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it("dims the switch of a prop no placement could set, and says why", () => {
    mount(component(), "c1");
    const row = exposeRow("count");
    expect(within(row).getByRole("switch")).toHaveProperty("disabled", true);
    expect(row.textContent).toMatch(/can’t set a number value/);
  });

  it("refuses a non-content prop inside a contentOnly area when it is picked", () => {
    const editor = mount(component(), "c2");
    const toggle = within(exposeRow("tone")).getByRole("switch");
    // Pressable though the lock holds the prop's own control: the refusal
    // that says why is the answer, and a dimmed switch would withhold it.
    expect(toggle.matches(":disabled")).toBe(false);
    fireEvent.click(toggle);
    expect(within(exposeRow("tone")).getByRole("alert").textContent).toMatch(
      /locked to its content/
    );
    expect(fields(editor())).toEqual([]);
  });

  it("lets placements hide the block", () => {
    const editor = mount(component(), "c1");
    fireEvent.click(
      screen.getByRole("switch", { name: "Let placements hide this" })
    );
    expect(fields(editor())).toMatchObject([
      { nodeId: "c1", type: "visibility", label: "Show card" },
    ]);
  });
});

describe("the exposed fields, with nothing selected", () => {
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

  it("lists each field with its type and the block it drives", () => {
    mount(exposedWithVariant, null);
    const list = screen.getByRole("region", { name: "Exposed fields" });
    expect(within(list).getByRole("textbox")).toHaveProperty("value", "Title");
    expect(list.textContent).toMatch(/Card · Title/);
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

  it("says nothing of exposed fields on a page", () => {
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
    expect(screen.queryByRole("region", { name: "Exposed fields" })).toBeNull();
    expect(screen.getByText("Select a block to edit it.")).toBeTruthy();
  });
});
