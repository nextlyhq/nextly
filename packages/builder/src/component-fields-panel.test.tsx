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

/** The icon button beside one prop that lets each page change it. */
function exposeButton(prop: string): HTMLElement {
  return within(exposeRow(prop)).getByRole("button", {
    name: /^Let each page/,
  });
}

/** What a toggle's tooltip says, read with the focus on it as a keyboard would. */
function tooltipOf(button: HTMLElement): string {
  act(() => {
    button.focus();
  });
  const said = screen.getByRole("tooltip").textContent ?? "";
  act(() => {
    button.blur();
  });
  return said;
}

describe("a prop row in a component's view", () => {
  it("exposes the prop with the icon beside it, and names the field under it", () => {
    const editor = mount(component(), "c1");
    const toggle = within(exposeRow("title")).getByRole("button", {
      name: "Let each page change Title",
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
      name: "Name pages see for Title",
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

  it("holds the icon of a prop no page could set, and says why when pressed", () => {
    const editor = mount(component(), "c1");
    const toggle = exposeButton("count");
    // Held, not disabled, so it can still be reached and its reason heard.
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(tooltipOf(toggle)).toMatch(/can’t set a number value/);
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

  it("lets each page hide the block, from the same icon on its Shown row", () => {
    const editor = mount(component(), "c1");
    fireEvent.click(
      screen.getByRole("button", { name: "Let each page hide Card" })
    );
    expect(fields(editor())).toMatchObject([
      { nodeId: "c1", type: "visibility", label: "Show card" },
    ]);
    expect(
      screen
        .getByRole("button", { name: "Let each page hide Card" })
        .getAttribute("aria-pressed")
    ).toBe("true");
  });
});

describe("a prop the inspector leaves out, in a component's view", () => {
  it("can still be exposed, since a page may clear what hides it", () => {
    // A linked button offers no "Acts as", but a placement can clear the link
    // and make it a button, so the component may still expose it.
    registerBlocks(
      [
        {
          name: "acme/link-button",
          version: 1,
          description: "A button.",
          example: { props: {} },
          render: () => null,
          props: {
            href: { type: "url" },
            kind: {
              label: "Acts as",
              type: "select",
              options: ["button", "submit"],
              onlyWithout: ["href"],
            },
          },
        },
      ] as never,
      { source: "component-fields-panel-test-link" }
    );
    mount(
      component({
        nodes: [
          {
            id: "l1",
            type: "acme/link-button",
            version: 1,
            props: { href: "/pricing" },
          },
        ],
      }),
      "l1"
    );
    const row = exposeRow("kind");
    // Named as the block names it, not by its prop name.
    expect(row.parentElement?.textContent).toContain("Acts as");
    expect(row.parentElement?.textContent).not.toContain("Kind");
    // Its control is still left out: only the expose icon is offered.
    expect(screen.queryByRole("combobox", { name: /Kind/ })).toBeNull();
  });
});

describe("props drawn inside a group, in a component's view", () => {
  it("keeps an expose icon for each, the group's lead and the rest", () => {
    // An image's source and alt text are one control each, but every prop
    // under them stays one a placement may set: a direct address included.
    registerBlocks(
      [
        {
          name: "acme/picture",
          version: 1,
          description: "A picture.",
          example: { props: {} },
          render: () => null,
          props: {
            mediaId: { label: "Image", role: "content", type: "media" },
            src: { label: "Image address", role: "content", type: "url" },
            alt: { label: "Alt text", role: "content", type: "text" },
            decorative: { label: "Decorative", type: "checkbox" },
          },
        },
      ] as never,
      { source: "component-fields-panel-test-picture" }
    );
    mount(
      component({
        nodes: [
          {
            id: "p1",
            type: "acme/picture",
            version: 1,
            props: { src: "/a.jpg" },
          },
        ],
      }),
      "p1"
    );
    for (const prop of ["mediaId", "src", "alt", "decorative"]) {
      expect(exposeButton(prop)).toBeDefined();
    }
    // Named as the block names it, beside its icon.
    expect(exposeRow("src").parentElement?.textContent).toContain(
      "Image address"
    );
    // The grouped control is still drawn once, where its lead sits.
    expect(screen.getAllByRole("radiogroup", { name: "Source" })).toHaveLength(
      1
    );
  });
});

describe("the icon's words, in plain terms", () => {
  it("names a property's icon for pages, and says in one line what turning it on does", () => {
    mount(component(), "c1");
    const toggle = within(exposeRow("title")).getByRole("button", {
      name: "Let each page change Title",
    });
    expect(tooltipOf(toggle)).toBe(
      "Turn this on to let each use of the component, on any page, set its own title."
    );
    // No native title beside it: two tooltips would draw over each other.
    expect(toggle.getAttribute("title")).toBeNull();
  });

  it("says what the pressed icon means, and how to undo it", () => {
    mount(component(), "c1");
    fireEvent.click(
      within(exposeRow("title")).getByRole("button", {
        name: "Let each page change Title",
      })
    );
    const pressed = within(exposeRow("title")).getByRole("button", {
      name: "Let each page change Title",
    });
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    expect(tooltipOf(pressed)).toBe(
      "Each use can change this. Turn off to use the component’s value everywhere."
    );
  });

  it("describes the Field name to a keyboard or screen-reader user, not only on hover", () => {
    mount(component(), "c1");
    fireEvent.click(
      within(exposeRow("title")).getByRole("button", {
        name: "Let each page change Title",
      })
    );
    const name = within(exposeRow("title")).getByRole("textbox", {
      name: "Name pages see for Title",
    });
    const hint = document.getElementById(
      name.getAttribute("aria-describedby") ?? ""
    );
    expect(hint?.textContent).toBe(
      "The name each page’s editor shows for this field."
    );
  });

  it("words the Shown row's icon the same way", () => {
    mount(component(), "c1");
    const toggle = screen.getByRole("button", {
      name: "Let each page hide Card",
    });
    expect(tooltipOf(toggle)).toBe(
      "Turn this on to let each use of the component, on any page, hide this card."
    );
    expect(screen.getByText("On every page")).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByText("Each use chooses")).toBeTruthy();
    expect(
      tooltipOf(screen.getByRole("button", { name: "Let each page hide Card" }))
    ).toBe("Each use can hide this. Turn off to show it everywhere.");
  });

  it("says nothing of placements or exposing in the view an author reads", () => {
    mount(component(), "c1");
    fireEvent.click(
      within(exposeRow("title")).getByRole("button", {
        name: "Let each page change Title",
      })
    );
    const panel = document.querySelector<HTMLElement>(".nx-inspector");
    expect(panel?.textContent ?? "").not.toMatch(/placement|expos/i);
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
      "beside a property to let each page change it."
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
