// @vitest-environment jsdom

/**
 * The Style tab, driven through a host that renders it against a real editor.
 *
 * `style-inspector.ts` decides which sections a block offers and what each
 * property carries, and asserts that without a DOM. What is only true HERE is
 * the wiring: that a control shows the stored value, that an edit reaches
 * `editor.apply` as the op the store owns, that an emptied field CLEARS rather
 * than writing an empty value, and that a refusal is shown rather than
 * swallowed.
 *
 * @module style-inspector-panel.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";
import { StyleInspectorPanel } from "./style-inspector-panel";

afterEach(() => {
  cleanup();
  clearBlocks();
});

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

function register(
  supports: Record<string, boolean | Record<string, boolean>>
): void {
  registerBlocks(
    [
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        editor: { label: "Box" },
        props: { text: { type: "text" } },
        supports,
        render: () => null,
      },
    ] as never,
    { source: "style-inspector-panel-test" }
  );
}

function documentOf(styles?: NodeStyles): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "a", type: "acme/box", version: 1, props: {}, styles },
    ] as BlockNode[],
  } as BlockDocument;
}

function editorFor(
  document: BlockDocument,
  selectedId: string | null = "a"
): EditorState & { apply: ReturnType<typeof vi.fn> } {
  return {
    document,
    selectedId,
    selection: {
      ids: selectedId === null ? [] : [selectedId],
      primary: selectedId,
    },
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

function mount(
  supports: Record<string, boolean | Record<string, boolean>>,
  styles?: NodeStyles
) {
  register(supports);
  const editor = editorFor(documentOf(styles));
  render(<StyleInspectorPanel editor={editor} />);
  return editor;
}

/** The fields of one property, scoped so two properties sharing a side name do not collide. */
function fieldsOf(property: string) {
  return within(
    document.querySelector(`[data-property="${property}"]`) as HTMLElement
  );
}

describe("the Style tab beside Content", () => {
  it("offers both tabs and shows Content first", () => {
    register({ effects: true });
    render(<InspectorPanel editor={editorFor(documentOf())} />);

    expect(screen.getByRole("tab", { name: "Content" })).toHaveProperty(
      "ariaSelected",
      "true"
    );
    expect(screen.getByRole("tab", { name: "Style" })).toHaveProperty(
      "ariaSelected",
      "false"
    );
    // The content half is still what it was: the block's props.
    expect(screen.getByLabelText("Text")).toBeDefined();
  });

  it("shows the style sections once the Style tab is chosen", () => {
    register({ effects: true });
    render(<InspectorPanel editor={editorFor(documentOf())} />);

    // `mouseDown` rather than `click`: the trigger activates on pointer-down,
    // and a synthetic click leaves it unselected — which would let every
    // assertion below run against the Content tab.
    const style = screen.getByRole("tab", { name: "Style" });
    fireEvent.mouseDown(style);

    expect(style.getAttribute("aria-selected")).toBe("true");
    // Queried by ROLE, which ignores the hidden panel: both panels are in the
    // DOM and the inactive one is hidden, so a query that read hidden nodes
    // would pass whether or not the tab ever changed.
    expect(screen.getByRole("button", { name: /Effects/ })).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Opacity" })).toBeDefined();
  });

  it("offers no tabs at all when nothing is selected", () => {
    // A Style tab over no selection would offer somewhere to click that can
    // never show anything, and the entry's own fields are a left panel rather
    // than this region.
    register({ effects: true });
    render(<InspectorPanel editor={editorFor(documentOf(), null)} />);

    expect(screen.queryByRole("tab", { name: "Style" })).toBeNull();
    expect(screen.getByText("Select a block to edit it.")).toBeDefined();
  });
});

describe("sections", () => {
  it("opens one section at a time", () => {
    mount({ spacing: true, effects: true });

    // The first section is open and the second is not, without either being
    // clicked: an accordion that opened nothing would show a block's style
    // surface as a column of headings.
    const spacing = screen.getByRole("button", { name: /Spacing/ });
    const effects = screen.getByRole("button", { name: /Effects/ });
    expect(spacing.getAttribute("aria-expanded")).toBe("true");
    expect(effects.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(effects);

    expect(spacing.getAttribute("aria-expanded")).toBe("false");
    expect(effects.getAttribute("aria-expanded")).toBe("true");
  });

  it("counts the properties this node sets in each section", () => {
    const styles = {
      base: { [BASE_BREAKPOINT]: { margin: "8px", opacity: 0.5 } },
    } as NodeStyles;
    mount({ spacing: true, effects: true }, styles);

    // One of two in spacing, one of five in effects — so an author can see
    // which sections they have touched without opening each one.
    expect(screen.getAllByLabelText("1 set")).toHaveLength(2);
  });

  it("says so when a block offers no style properties at all", () => {
    mount({});

    expect(
      screen.getByText("This block does not offer style properties.")
    ).toBeDefined();
  });
});

describe("controls", () => {
  it("shows the value stored at this address", () => {
    const styles = {
      base: { [BASE_BREAKPOINT]: { padding: { blockStart: "12px" } } },
    } as NodeStyles;
    mount({ spacing: true }, styles);

    expect(
      (fieldsOf("padding").getByLabelText("Block start") as HTMLInputElement)
        .value
    ).toBe("12px");
    // The same side of a DIFFERENT property is empty, which is what says the
    // read is addressed rather than by leaf name.
    expect(
      (fieldsOf("margin").getByLabelText("Block start") as HTMLInputElement)
        .value
    ).toBe("");
  });

  it("draws a keyword leaf as a select over the catalog's own vocabulary", () => {
    mount({ effects: true });

    const trigger = screen.getByLabelText("Mix blend mode");
    fireEvent.click(trigger);

    // `multiply` is the catalog's, not a list written here — a value absent
    // from `mix-blend-mode` would fail to appear.
    expect(screen.getByRole("option", { name: "multiply" })).toBeDefined();
  });

  it("writes through the store on blur, not on every keystroke", () => {
    const editor = mount({ spacing: true });
    const field = fieldsOf("padding").getByLabelText("Block start");

    fireEvent.change(field, { target: { value: "12px" } });
    expect(editor.apply).not.toHaveBeenCalled();

    fireEvent.blur(field);

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(editor.apply.mock.calls[0]?.[0]).toMatchObject({
      kind: "update",
      id: "a",
      patch: {
        styles: {
          base: { [BASE_BREAKPOINT]: { padding: { blockStart: "12px" } } },
        },
      },
    });
  });

  it("CLEARS on an emptied field rather than storing an empty value", () => {
    // A stored `""` would pin the property to nothing here and beat the tier an
    // author is asking to get back — and the validator refuses it anyway.
    const styles = {
      base: { [BASE_BREAKPOINT]: { padding: { blockStart: "12px" } } },
    } as NodeStyles;
    const editor = mount({ spacing: true }, styles);
    const field = fieldsOf("padding").getByLabelText("Block start");

    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);

    // Named for REMOVAL rather than set to an empty object: an op is
    // persisted, and `JSON.stringify` drops an undefined value, so the inverse
    // of the edit that added the first style has to say which key goes.
    expect(editor.apply.mock.calls[0]?.[0]).toEqual({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["styles"],
    });
  });

  it("stores a numeric draft as a NUMBER where the leaf takes one", () => {
    // Measured: `opacity: "0.5"` is refused and `opacity: 0.5` is accepted, so
    // passing the draft through unchanged would refuse every numeric edit.
    const editor = mount({ effects: true });
    const field = screen.getByLabelText("Opacity");

    fireEvent.change(field, { target: { value: "0.5" } });
    fireEvent.blur(field);

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(editor.apply.mock.calls[0]?.[0]).toMatchObject({
      patch: { styles: { base: { [BASE_BREAKPOINT]: { opacity: 0.5 } } } },
    });
  });

  it("passes a non-numeric draft through, so a CSS-wide keyword reaches a number leaf", () => {
    const editor = mount({ effects: true });
    const field = screen.getByLabelText("Opacity");

    fireEvent.change(field, { target: { value: "inherit" } });
    fireEvent.blur(field);

    expect(editor.apply.mock.calls[0]?.[0]).toMatchObject({
      patch: {
        styles: { base: { [BASE_BREAKPOINT]: { opacity: "inherit" } } },
      },
    });
  });

  it("shows the catalog's own refusal and applies nothing", () => {
    const editor = mount({ spacing: true });
    const field = fieldsOf("padding").getByLabelText("Block start");

    fireEvent.change(field, { target: { value: "12 furlongs" } });
    fireEvent.blur(field);

    expect(editor.apply).not.toHaveBeenCalled();
    // The message is the validator's rather than one written here, so a change
    // to how the catalog explains a length is carried straight to the author.
    expect(screen.getByRole("alert").textContent).toContain("is not a length");
  });

  it("drops a refusal once the document holds a different value here", () => {
    // A refusal describes the draft that produced it. An undo, or an edit
    // applied from somewhere else, leaves the SELECTION alone — so the remount
    // key does not change and nothing else would clear the message, leaving an
    // error under a field that now shows a different value.
    register({ spacing: true });
    const editor = editorFor(documentOf());
    const { rerender } = render(<StyleInspectorPanel editor={editor} />);

    const field = fieldsOf("padding").getByLabelText("Block start");
    fireEvent.change(field, { target: { value: "12 furlongs" } });
    fireEvent.blur(field);
    expect(screen.getByRole("alert")).toBeDefined();

    const repaired = editorFor(
      documentOf({
        base: { [BASE_BREAKPOINT]: { padding: { blockStart: "4px" } } },
      } as NodeStyles)
    );
    rerender(<StyleInspectorPanel editor={repaired} />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (fieldsOf("padding").getByLabelText("Block start") as HTMLInputElement)
        .value
    ).toBe("4px");
  });

  it("offers every form the catalog declares, so an unset union is authorable", () => {
    // Without this, an unset `borderRadius` could only ever be one radius: the
    // engine answers with the catalog's first arm when nothing is stored.
    mount({ border: { radius: true } });

    const trigger = screen.getByLabelText("Form");
    fireEvent.click(trigger);
    // Named from the arms' own shape kinds rather than numbered.
    expect(screen.getByRole("option", { name: "Per corner" })).toBeDefined();

    fireEvent.click(screen.getByRole("option", { name: "Per corner" }));

    expect(
      fieldsOf("borderRadius").getByLabelText("Start start")
    ).toBeDefined();
  });

  it("clears the stored value when the form changes under it", () => {
    // One radius is not four corners, so there is nothing to carry across — and
    // leaving the value would snap the panel straight back, because a stored
    // value decides its own arm.
    const styles = {
      base: { [BASE_BREAKPOINT]: { borderRadius: "4px" } },
    } as NodeStyles;
    const editor = mount({ border: { radius: true } }, styles);

    fireEvent.click(screen.getByLabelText("Form"));
    fireEvent.click(screen.getByRole("option", { name: "Per corner" }));

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(editor.apply.mock.calls[0]?.[0]).toEqual({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["styles"],
    });
  });

  it("lets a keyword selection be cleared, which a select cannot offer as an item", () => {
    const styles = {
      base: { [BASE_BREAKPOINT]: { mixBlendMode: "multiply" } },
    } as NodeStyles;
    const editor = mount({ effects: true }, styles);

    fireEvent.click(
      fieldsOf("mixBlendMode").getByRole("button", { name: "Clear" })
    );

    expect(editor.apply.mock.calls[0]?.[0]).toEqual({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["styles"],
    });
  });

  it("shows a stored keyword the catalog does not list verbatim, rather than blank", () => {
    // The validator accepts keywords case-insensitively and accepts the CSS-wide
    // keywords everywhere, so `inherit` is live and compiles while matching no
    // catalog item — and a select showing nothing over a working value reads as
    // an unset property.
    const styles = {
      base: { [BASE_BREAKPOINT]: { mixBlendMode: "inherit" } },
    } as NodeStyles;
    mount({ effects: true }, styles);

    expect(fieldsOf("mixBlendMode").getByText("inherit")).toBeDefined();
  });

  it("reports an edit the op store refused, which the validator cannot anticipate", () => {
    // `styleWriteOp` judges the edited leaf; `applyOp` judges the whole
    // document. A page at its byte limit refuses an edit whose value is valid,
    // and an unreported refusal leaves the field reading as saved.
    register({ spacing: true });
    const editor = editorFor(documentOf());
    editor.apply.mockReturnValue(null);
    render(<StyleInspectorPanel editor={editor} />);

    const field = fieldsOf("padding").getByLabelText("Block start");
    fireEvent.change(field, { target: { value: "12px" } });
    fireEvent.blur(field);

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be applied"
    );
  });

  it("refuses to style a multi-selection rather than editing its primary", () => {
    // Exported standalone, so a host can mount it with no wrapper to make this
    // refusal for it — and `selectedId` is the PRIMARY, so it would silently
    // change one block while the canvas outlines six.
    register({ spacing: true });
    const editor = editorFor(documentOf());
    const many = {
      ...editor,
      selection: { ids: ["a", "b"], primary: "a" },
    } as unknown as EditorState;
    render(<StyleInspectorPanel editor={many} />);

    expect(
      screen.getByText("2 blocks selected. Select one to style it.")
    ).toBeDefined();
    expect(screen.queryByLabelText("Block start")).toBeNull();
  });

  it("shows a stored token by name rather than as editable text", () => {
    // `{ $token }` is one value spelled as an object. Typing over it would
    // store the token's NAME as a literal — a value that looks right in the
    // field and compiles to nothing.
    const styles = {
      base: {
        [BASE_BREAKPOINT]: { padding: { blockStart: { $token: "space.4" } } },
      },
    } as NodeStyles;
    const editor = mount({ spacing: true }, styles);
    const padding = fieldsOf("padding");

    expect(padding.getByText("space.4")).toBeDefined();
    expect(padding.queryByDisplayValue("space.4")).toBeNull();

    fireEvent.click(padding.getByRole("button", { name: "Clear" }));

    expect(editor.apply).toHaveBeenCalledTimes(1);
  });
});
