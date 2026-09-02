// @vitest-environment jsdom

/**
 * The Style tab, driven through a host that renders it against a real editor.
 *
 * `style-inspector.ts` decides which sections a block offers and what each
 * property carries, and asserts that without a DOM. What is only true HERE is
 * the wiring: that a control shows the stored value, that an edit reaches
 * `editor.applyAll` as the op the store owns, that an emptied field CLEARS rather
 * than writing an empty value, and that a refusal is shown rather than
 * swallowed.
 *
 * @module style-inspector-panel.test
 */
import {
  BASE_BREAKPOINT,
  breakpointContexts,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type BreakpointSet,
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
import { applyOps, type BuilderOp } from "./ops";
import { InspectorPanel } from "./inspector-panel";
import {
  breakpointLabel,
  describeProvenance,
  StyleInspectorPanel,
} from "./style-inspector-panel";
import type { StylePolicy } from "./style-values";

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
      {
        id: "a",
        type: "acme/box",
        version: 1,
        props: {},
        // OMITTED rather than set to `undefined` when there are no styles. A
        // node holding `undefined` is not a document the product can produce —
        // it will not serialise — and the op layer refuses to edit one, so a
        // fixture carrying the key made the unstyled case unusable for any
        // assertion that applies an op.
        ...(styles === undefined ? {} : { styles }),
      },
    ] as BlockNode[],
  } as BlockDocument;
}

function editorFor(
  document: BlockDocument,
  selectedId: string | null = "a"
): EditorState & { applyAll: ReturnType<typeof vi.fn> } {
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
  } as unknown as EditorState & { applyAll: ReturnType<typeof vi.fn> };
}

function mount(
  supports: Record<string, boolean | Record<string, boolean>>,
  styles?: NodeStyles,
  policy?: StylePolicy
) {
  register(supports);
  const editor = editorFor(documentOf(styles));
  render(
    <StyleInspectorPanel
      editor={editor}
      {...(policy === undefined ? {} : { policy })}
    />
  );
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

describe("when there is nothing to style", () => {
  it("says to select a block, rather than rendering an empty panel", () => {
    /*
     * Not covered by the wrapper's own no-selection case: that one renders
     * `InspectorPanel`, which says "Select a block to edit it." This panel says
     * "style", and a query matching one does not match the other.
     */
    register({ spacing: true });
    const { container } = render(
      <StyleInspectorPanel editor={editorFor(documentOf(), null)} />
    );
    expect(
      container.querySelector('[data-empty="no-selection"]')
    ).not.toBeNull();
    expect(screen.getByText(/select a block to style it/i)).toBeDefined();
  });
});

describe("the class selector, mounted above the style sections", () => {
  const LIBRARY = [
    { id: "id-hero", slug: "hero", orderIndex: 0, styles: {} },
    { id: "id-card", slug: "card", orderIndex: 1, styles: {} },
  ];

  /** The panel with a node carrying classes, and a host that opted in. */
  function mountWithClasses(
    options: {
      classIds?: string[];
      library?: typeof LIBRARY | undefined;
      optIn?: boolean;
    } = {}
  ) {
    register({ spacing: true });
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "a",
          type: "acme/box",
          version: 1,
          props: {},
          ...(options.classIds === undefined
            ? {}
            : { classes: options.classIds }),
        },
      ] as BlockNode[],
    } as BlockDocument;
    const editor = editorFor(document);
    const onCreateClass = vi.fn(async () => ({
      ok: true as const,
      classId: "id-new",
    }));
    render(
      <StyleInspectorPanel
        editor={editor}
        {...(options.optIn === false ? {} : { onCreateClass })}
        {...(options.library === undefined
          ? {}
          : { classLibrary: options.library })}
      />
    );
    return { editor, onCreateClass };
  }

  it("is absent entirely when the host never opted in", () => {
    /*
     * `onCreateClass` is what opts in, NOT the library. A host that cannot
     * write the site style has no way to create a class, and a selector that
     * offered to would report an intent nobody acts on.
     */
    mountWithClasses({ optIn: false, library: LIBRARY });
    expect(screen.queryByRole("combobox", { name: /add a class/i })).toBeNull();
  });

  it("shows the loading state when the host opted in but is still reading", () => {
    // The distinction that would otherwise collapse: an absent library means
    // "in flight" only BECAUSE opting in is signalled separately. Drawn the
    // same way, a host mid-load and a host with no class surface at all would
    // be indistinguishable, and only one of them has a field about to fill.
    mountWithClasses({ library: undefined });
    expect(screen.getByText(/loading classes/i)).toBeDefined();
  });

  it("shows the classes the selected node carries", () => {
    mountWithClasses({ classIds: ["id-card"], library: LIBRARY });
    expect(screen.getByRole("button", { name: /remove card/i })).toBeDefined();
  });

  it("writes an applied class through the editor, with no host callback", () => {
    // Applying an EXISTING class is a node edit, which this panel already
    // knows how to write. Requiring a callback for it would make the host
    // rebuild an op the panel is holding all the parts of.
    const { editor, onCreateClass } = mountWithClasses({ library: LIBRARY });
    fireEvent.change(screen.getByRole("combobox", { name: /add a class/i }), {
      target: { value: "hero" },
    });
    fireEvent.keyDown(screen.getByRole("combobox", { name: /add a class/i }), {
      key: "Enter",
    });

    expect(onCreateClass).not.toHaveBeenCalled();
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(editor.applyAll.mock.calls[0]?.[0]?.[0]).toEqual({
      kind: "update",
      id: "a",
      patch: { classes: ["id-hero"] },
    });
  });

  it("UNSETS the field when the last class is removed", () => {
    /*
     * Not `classes: []`. The field is optional and the two mean the same to
     * every reader, so writing the empty array leaves a key that says nothing
     * — and an inverse built from it would restore that key on undo.
     */
    const { editor } = mountWithClasses({
      classIds: ["id-hero"],
      library: LIBRARY,
    });
    fireEvent.click(screen.getByRole("button", { name: /remove hero/i }));

    expect(editor.applyAll.mock.calls[0]?.[0]?.[0]).toEqual({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["classes"],
    });
  });

  it("appears for a block that offers no style properties at all", () => {
    /*
     * Named classes compile independently of a block's own style support, so
     * such a block can still carry one. Exiting early on an empty section list
     * left the only surface that can apply a class unreachable for exactly the
     * blocks whose styling has to come from classes.
     */
    register({});
    const editor = editorFor(documentOf());
    render(
      <StyleInspectorPanel
        editor={editor}
        onCreateClass={vi.fn(async () => ({
          ok: true as const,
          classId: "id-new",
        }))}
        classLibrary={LIBRARY}
      />
    );

    expect(
      screen.getByRole("combobox", { name: /add a class/i })
    ).toBeDefined();
    // And it still says the block has no style controls, rather than pretending.
    expect(screen.getByText(/does not offer style properties/i)).toBeDefined();
  });

  it("forgets a typed query when the selection moves to another block", () => {
    /*
     * The query and the highlighted row are state about the node in hand.
     * Unkeyed, React reuses the component across a selection change while the
     * write callback switches to the new node — so Enter applies the PREVIOUS
     * block's pending choice to the block now selected.
     */
    register({ spacing: true });
    const first = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "a", type: "acme/box", version: 1, props: {} },
        { id: "b", type: "acme/box", version: 1, props: {} },
      ] as BlockNode[],
    } as BlockDocument;

    const view = render(
      <StyleInspectorPanel
        editor={editorFor(first, "a")}
        onCreateClass={vi.fn(async () => ({
          ok: true as const,
          classId: "id-new",
        }))}
        classLibrary={LIBRARY}
      />
    );
    const field = () => screen.getByRole("combobox", { name: /add a class/i });
    fireEvent.change(field(), { target: { value: "hero" } });
    expect((field() as HTMLInputElement).value).toBe("hero");

    view.rerender(
      <StyleInspectorPanel
        editor={editorFor(first, "b")}
        onCreateClass={vi.fn(async () => ({
          ok: true as const,
          classId: "id-new",
        }))}
        classLibrary={LIBRARY}
      />
    );
    expect((field() as HTMLInputElement).value).toBe("");
  });

  it("tells the selector when the document refused the write", () => {
    /*
     * `applyAll` answers null when the store refuses — a page at its byte limit
     * rejects an edit the class rules found valid. Discarded, the selector
     * clears the query and resets as though the class had been applied, so the
     * author loses the typed choice and is told nothing.
     */
    register({ spacing: true });
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "a", type: "acme/box", version: 1, props: {} },
      ] as BlockNode[],
    } as BlockDocument;
    const editor = editorFor(document);
    editor.applyAll.mockReturnValue(null);

    render(
      <StyleInspectorPanel
        editor={editor}
        onCreateClass={vi.fn(async () => ({
          ok: true as const,
          classId: "id-new",
        }))}
        classLibrary={LIBRARY}
      />
    );
    const field = () => screen.getByRole("combobox", { name: /add a class/i });
    fireEvent.change(field(), { target: { value: "hero" } });
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect((field() as HTMLInputElement).value).toBe("hero");
    expect(screen.getByRole("alert").textContent).toMatch(
      /could not be applied/i
    );
  });

  it("reports a creation to the host, then writes the id it answers with", async () => {
    /*
     * Asserting only that no write happened YET is satisfied by the promise not
     * having settled, and would hold for a panel that never applies the class.
     * The write has to be observed after the microtask runs.
     */
    const { editor, onCreateClass } = mountWithClasses({ library: LIBRARY });
    fireEvent.change(screen.getByRole("combobox", { name: /add a class/i }), {
      target: { value: "call-to-action" },
    });
    fireEvent.keyDown(screen.getByRole("combobox", { name: /add a class/i }), {
      key: "Enter",
    });

    expect(onCreateClass).toHaveBeenCalledWith("call-to-action");
    expect(editor.applyAll).not.toHaveBeenCalled();

    await React.act(async () => {});

    expect(editor.applyAll.mock.calls[0]?.[0]?.[0]).toEqual({
      kind: "update",
      id: "a",
      patch: { classes: ["id-new"] },
    });
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

  it("keeps a section collapsed when the author closes it", () => {
    // The accordion sends "" on collapse. Treating that as "not chosen" made
    // the first section impossible to close, and closing any later one opened
    // the first instead.
    mount({ spacing: true, effects: true });
    const spacing = screen.getByRole("button", { name: /Spacing/ });
    expect(spacing.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(spacing);

    expect(spacing.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen
        .getByRole("button", { name: /Effects/ })
        .getAttribute("aria-expanded")
    ).toBe("false");
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

  it("writes on Enter, and stops the entry form from submitting", () => {
    /*
     * Both halves matter and neither implies the other. Committing without
     * `preventDefault` submits the surrounding entry form, saving or
     * publishing the entry when the author meant to finish one field; and
     * preventing without committing loses the edit silently. Nothing covered
     * this before, which is how the handler came to be refactored unguarded.
     */
    const editor = mount({ spacing: true });
    const field = fieldsOf("padding").getByLabelText("Block start");

    fireEvent.change(field, { target: { value: "12px" } });
    expect(editor.applyAll).not.toHaveBeenCalled();

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    field.dispatchEvent(event);

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("writes through the store on blur, not on every keystroke", () => {
    const editor = mount({ spacing: true });
    const field = fieldsOf("padding").getByLabelText("Block start");

    fireEvent.change(field, { target: { value: "12px" } });
    expect(editor.applyAll).not.toHaveBeenCalled();

    fireEvent.blur(field);

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(editor.applyAll.mock.calls[0]?.[0]?.[0]).toMatchObject({
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
    expect(editor.applyAll.mock.calls[0]?.[0]?.[0]).toEqual({
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

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(editor.applyAll.mock.calls[0]?.[0]?.[0]).toMatchObject({
      patch: { styles: { base: { [BASE_BREAKPOINT]: { opacity: 0.5 } } } },
    });
  });

  it("passes a non-numeric draft through, so a CSS-wide keyword reaches a number leaf", () => {
    const editor = mount({ effects: true });
    const field = screen.getByLabelText("Opacity");

    fireEvent.change(field, { target: { value: "inherit" } });
    fireEvent.blur(field);

    expect(editor.applyAll.mock.calls[0]?.[0]?.[0]).toMatchObject({
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

    expect(editor.applyAll).not.toHaveBeenCalled();
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

    const trigger = screen.getByLabelText("Border radius form");
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

    fireEvent.click(screen.getByLabelText("Border radius form"));
    fireEvent.click(screen.getByRole("option", { name: "Per corner" }));

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(editor.applyAll.mock.calls[0]?.[0]?.[0]).toEqual({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["styles"],
    });
  });

  it("clears only the union position when a NESTED form changes", () => {
    // `position` holds a type, an inset and a zIndex, and only the last is a
    // union. Clearing the property root to change the zIndex form would delete
    // the author's positioning scheme and offsets with it.
    const styles = {
      base: {
        [BASE_BREAKPOINT]: { position: { type: "relative", zIndex: 3 } },
      },
    } as NodeStyles;
    const editor = mount({ position: true }, styles);

    fireEvent.click(screen.getByLabelText("Z index form"));
    fireEvent.click(screen.getByRole("option", { name: "Keyword" }));

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(editor.applyAll.mock.calls[0]?.[0]?.[0]).toMatchObject({
      patch: {
        styles: {
          base: { [BASE_BREAKPOINT]: { position: { type: "relative" } } },
        },
      },
    });
  });

  it("lets a keyword selection be cleared, which a select cannot offer as an item", () => {
    const styles = {
      base: { [BASE_BREAKPOINT]: { mixBlendMode: "multiply" } },
    } as NodeStyles;
    const editor = mount({ effects: true }, styles);

    fireEvent.click(
      fieldsOf("mixBlendMode").getByRole("button", {
        name: "Clear Mix blend mode",
      })
    );

    expect(editor.applyAll.mock.calls[0]?.[0]?.[0]).toEqual({
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
    editor.applyAll.mockReturnValue(null);
    render(<StyleInspectorPanel editor={editor} />);

    const field = fieldsOf("padding").getByLabelText("Block start");
    fireEvent.change(field, { target: { value: "12px" } });
    fireEvent.blur(field);

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
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

  it("stores only the numeric grammar CSS accepts, leaving other spellings alone", () => {
    // `Number` reads spellings CSS does not: `0x10` is 16, `0b10` is 2, `0o10`
    // is 8. Converting those would store a number the author never typed and
    // pass validation on the way through.
    const editor = mount({ effects: true });
    const field = screen.getByLabelText("Opacity");

    fireEvent.change(field, { target: { value: "0x10" } });
    fireEvent.blur(field);

    // Left as text, so the catalog refuses it and says why.
    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("is not a number");
  });

  it("makes a retained but unsupported value clear-only, not editable", () => {
    // The value is live on the page — nothing in validation or compilation
    // reads `supports` — so it must be removable. Letting it go on being EDITED
    // is the other error: that writes new values through a capability the block
    // has withdrawn.
    const styles = {
      base: { [BASE_BREAKPOINT]: { fontSize: "20px" } },
    } as NodeStyles;
    const editor = mount({ spacing: true, typography: false }, styles);

    fireEvent.click(screen.getByRole("button", { name: /Typography/ }));
    const fontSize = fieldsOf("fontSize");

    expect(fontSize.queryByRole("textbox")).toBeNull();
    expect(fontSize.getByText("20px")).toBeDefined();

    fireEvent.click(fontSize.getByRole("button", { name: "Clear Font size" }));
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
  });

  it("names every ROOT form selector for its own property", () => {
    // A property whose shape is a union at the top draws one control and so no
    // heading. `fontWeight`, `lineHeight` and `fontStyle` are all such unions,
    // and a selector called "Form" three times over tells a screen-reader user
    // nothing about which property it changes.
    mount({ typography: true });

    expect(screen.getByLabelText("Font weight form")).toBeDefined();
    expect(screen.getByLabelText("Line height form")).toBeDefined();
    expect(screen.getByLabelText("Font style form")).toBeDefined();
  });

  it("leaves a trailing decimal point for the catalog, rather than reading it as a number", () => {
    // CSS requires a digit AFTER a decimal point, so `1.` is a number followed
    // by a stray delimiter rather than a number. `Number("1.")` answers 1
    // regardless, which would store a value the author never spelled validly.
    const editor = mount({ effects: true });
    const field = screen.getByLabelText("Opacity");

    fireEvent.change(field, { target: { value: "1." } });
    fireEvent.blur(field);

    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("names a read-only value through its label, which `for` cannot reach", () => {
    // HTML's `for` associates a label only with a LABELABLE element — input,
    // select, textarea, button, output, meter, progress. These branches render
    // a paragraph, so the association is dropped silently and the value has no
    // accessible name at all.
    const styles = {
      base: {
        [BASE_BREAKPOINT]: { padding: { blockStart: { $token: "space.4" } } },
      },
    } as NodeStyles;
    mount({ spacing: true }, styles);

    // The COMPUTED accessible name, not the raw attribute. Asserting
    // `aria-labelledby` and resolving the id by hand passes even when the
    // element's role prohibits a name — which a bare paragraph's does — so it
    // would have reported this association as working while it was dropped.
    expect(
      fieldsOf("padding").getByRole("group", { name: "Block start" })
    ).toBeDefined();
  });

  it("names a token's clear action for its property, not just 'Clear'", () => {
    // Several token-valued properties on one panel would otherwise be a column
    // of identical buttons, and the label pointed at an id nothing carried.
    const styles = {
      base: {
        [BASE_BREAKPOINT]: {
          padding: { blockStart: { $token: "space.4" } },
          margin: { blockStart: { $token: "space.2" } },
        },
      },
    } as NodeStyles;
    mount({ spacing: true }, styles);

    // Each names the PROPERTY it clears, not just the side: `padding` and
    // `margin` both have a block start, so a name built from the side alone
    // says the same thing twice.
    expect(
      screen.getByRole("button", { name: "Clear Padding block start" })
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Clear Margin block start" })
    ).toBeDefined();
  });

  it("names every keyword clear action for its own property", () => {
    // Two keyword properties set at once would otherwise offer two buttons
    // both called "Clear", and a screen-reader user cannot tell which
    // declaration each removes.
    // One section, so both controls are in the OPEN accordion: a closed section
    // hides its buttons and `getByRole` would report them missing rather than
    // unnamed, which is a different failure wearing the same message.
    const styles = {
      base: { [BASE_BREAKPOINT]: { mixBlendMode: "multiply", filter: "none" } },
    } as NodeStyles;
    mount({ effects: true }, styles);

    expect(
      screen.getByRole("button", { name: "Clear Mix blend mode" })
    ).toBeDefined();
  });

  it("does not read NBSP-only text as an empty field, which would DELETE the value", () => {
    // `String.prototype.trim` strips NBSP; CSS does not. Reading it as empty
    // turns a value the engine refuses into a silent clear of the declaration.
    const styles = {
      base: { [BASE_BREAKPOINT]: { padding: { blockStart: "12px" } } },
    } as NodeStyles;
    const editor = mount({ spacing: true }, styles);
    const field = fieldsOf("padding").getByLabelText("Block start");

    fireEvent.change(field, { target: { value: "\u00a0" } });
    fireEvent.blur(field);

    // Refused as a value, not treated as a request to clear.
    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("trims the whitespace CSS trims, not the whitespace JavaScript trims", () => {
    // `String.prototype.trim` strips NBSP and the Unicode spaces where CSS
    // strips neither, so trimming with it would turn a spelling the engine
    // refuses into a number it accepts.
    const editor = mount({ effects: true });
    const field = screen.getByLabelText("Opacity");

    fireEvent.change(field, { target: { value: "\u00a00.5" } });
    fireEvent.blur(field);

    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("gives a field an identity that includes the address it writes to", () => {
    // A host switching state or breakpoint leaves this field mounted, and where
    // both addresses hold the same value the synchronisation effect does not
    // run — so an unfinished draft would commit into the new address.
    register({ spacing: true });
    const editor = editorFor(documentOf());
    const { rerender } = render(<StyleInspectorPanel editor={editor} />);

    fireEvent.change(fieldsOf("padding").getByLabelText("Block start"), {
      target: { value: "99px" },
    });

    rerender(<StyleInspectorPanel editor={editor} state="hover" />);

    // A fresh field for the new address, not the base breakpoint's draft.
    expect(
      (fieldsOf("padding").getByLabelText("Block start") as HTMLInputElement)
        .value
    ).toBe("");
  });

  it("ties a refusal to the control that produced it", () => {
    // `role="alert"` announces once and is then gone. Without the relationship
    // being stated, a screen-reader user returning to the field — or meeting
    // several rejected controls — cannot tell which message belongs to which.
    const editor = mount({ spacing: true });
    const field = fieldsOf("padding").getByLabelText("Block start");

    fireEvent.change(field, { target: { value: "12 furlongs" } });
    fireEvent.blur(field);
    expect(editor.applyAll).not.toHaveBeenCalled();

    const describedBy = field.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(
      document.getElementById(describedBy as string)?.textContent
    ).toContain("is not a length");
    expect(field.getAttribute("aria-invalid")).toBe("true");
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

    fireEvent.click(
      padding.getByRole("button", { name: "Clear Padding block start" })
    );

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
  });
});

describe("the site's host-fetch policy", () => {
  /*
   * What a host hands the panel, and what the published compiler judges the
   * same value by. The panel carries it to `styleWriteOp` and to the engine's
   * arm selection; a panel mounted without one asks the engine to validate
   * with no host list, and absence means UNASKED rather than allowed.
   */
  const REFUSE: StylePolicy = { mayFetchUrl: () => false };
  const ALLOW: StylePolicy = { mayFetchUrl: () => true };
  const REMOTE = "https://cdn.example/hero.png";

  it("refuses a URL naming a host the site does not load from", () => {
    const editor = mount({ background: { image: true } }, undefined, REFUSE);
    const field = fieldsOf("background").getByLabelText("Url");

    fireEvent.change(field, { target: { value: REMOTE } });
    fireEvent.blur(field);

    // The write is withheld, so the author never stores a value the page
    // would drop. Without the policy this call happens and the URL is saved.
    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const describedBy = field.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(
      document.getElementById(describedBy as string)?.textContent
    ).toBeTruthy();
  });

  it("accepts the same URL when the site DOES load from that host", () => {
    // The positive control, and it is what separates "the policy is applied"
    // from "the panel refuses every URL". Both halves produce a refused write
    // in the test above; only this one distinguishes them.
    const editor = mount({ background: { image: true } }, undefined, ALLOW);
    const field = fieldsOf("background").getByLabelText("Url");

    fireEvent.change(field, { target: { value: REMOTE } });
    fireEvent.blur(field);

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(field.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("asks nothing at all when the host declared no list", () => {
    // A site that configured nothing keeps today's behaviour: the engine's
    // scheme allowlist is the only limit. Passing an empty policy here rather
    // than a refusing one is what makes that distinct from a lockdown.
    const editor = mount({ background: { image: true } });
    const field = fieldsOf("background").getByLabelText("Url");

    fireEvent.change(field, { target: { value: REMOTE } });
    fireEvent.blur(field);

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
  });

  it("carries the policy from the Inspector's Style tab, not just its own prop", () => {
    // The forwarding hop. `StyleInspectorPanel` taking a policy proves nothing
    // about the panel a host actually mounts, which is `InspectorPanel` — and
    // that is the component the page-builder plugin hands its derived policy.
    register({ background: { image: true } });
    const editor = editorFor(documentOf());
    render(<InspectorPanel editor={editor} policy={REFUSE} />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    const field = fieldsOf("background").getByLabelText("Url");

    fireEvent.change(field, { target: { value: REMOTE } });
    fireEvent.blur(field);

    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("a value the panel shows and could not remove", () => {
  /*
   * One shape at several sites: the panel renders a value that IS emitted on
   * the page while offering no action that removes it. Each test below is one
   * site, and the separating property is the same throughout — the author can
   * SEE what is set, and one action clears it.
   */

  it("keeps the panel for an UNREGISTERED block, clear-only", () => {
    // No `register` call at all. `compile-page.ts` walks every node and hands
    // `node.styles` to `envelopeRules` without asking the registry, so this
    // padding is on the page. The panel used to answer null here.
    const styles = {
      base: { [BASE_BREAKPOINT]: { padding: { blockStart: "12px" } } },
    } as NodeStyles;
    const editor = editorFor(documentOf(styles));
    render(<StyleInspectorPanel editor={editor} />);

    const padding = fieldsOf("padding");
    expect(padding.getByText("12px")).toBeDefined();
    // Not editable: no definition declares the property supported, so writing
    // a NEW value through a block that no longer exists is the opposite error.
    expect(padding.queryByDisplayValue("12px")).toBeNull();

    fireEvent.click(
      padding.getByRole("button", { name: "Clear Padding block start" })
    );

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
  });

  it("shows a scalar no field can type, and clears it", () => {
    // `{ value: "12px" }` at a scalar position, which an import or the API can
    // write. The text projection of it is `""`, so the field read as UNSET
    // while the value compiled — and the one keystroke that would clear it,
    // emptying the field, was refused because the empty draft already equalled
    // that empty projection.
    const styles = {
      base: { [BASE_BREAKPOINT]: { fontSize: { value: "12px" } } },
    } as NodeStyles;
    const editor = mount({ typography: true }, styles);
    const fontSize = fieldsOf("fontSize");

    expect(fontSize.queryByRole("textbox")).toBeNull();
    expect(fontSize.getByText('{"value":"12px"}')).toBeDefined();

    fireEvent.click(fontSize.getByRole("button", { name: "Clear Font size" }));

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
  });

  it("shows a value a SELECT has no item for, and clears it", () => {
    // A number stored where the leaf's vocabulary is keywords. The trigger has
    // no item to be current, so it rendered its "Not set" placeholder over a
    // live value — and the Clear button beside it was withheld for exactly the
    // same reason, because it keys off the same empty string.
    const styles = {
      base: { [BASE_BREAKPOINT]: { textAlign: 4 } },
    } as NodeStyles;
    const editor = mount({ typography: true }, styles);
    const textAlign = fieldsOf("textAlign");

    expect(textAlign.getByText("4")).toBeDefined();

    fireEvent.click(
      textAlign.getByRole("button", { name: "Clear Text align" })
    );

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
  });

  it("withholds the form selector on a property the block no longer offers", () => {
    // `FormChoice` REMOVES what is stored at the union's position, which is
    // right while a property is editable and wrong once it is not: the selector
    // sat enabled beside the "no longer offers" notice, reading as "switch this
    // to corners" and deleting the value instead.
    const styles = {
      base: { [BASE_BREAKPOINT]: { borderRadius: "4px" } },
    } as NodeStyles;
    mount({ border: { line: true } }, styles);

    expect(
      document.querySelector('[data-not-offered="borderRadius"]')
    ).not.toBeNull();
    expect(
      document.querySelector('[data-form-choice="borderRadius"]')
    ).toBeNull();
  });

  it("offers the form selector while the property IS still supported", () => {
    // The positive control for the test above. Without it, a panel that had
    // simply stopped rendering form selectors altogether would pass.
    mount({ border: { radius: true } });

    expect(
      document.querySelector('[data-form-choice="borderRadius"]')
    ).not.toBeNull();
  });

  it("puts back what the document holds when a draft only RE-SPELLS it", () => {
    // `01` commits as the `1` already stored, so `styleWriteOp` answers with no
    // op and the stored value never moves — which means the effect that syncs
    // the field cannot fire. The typed text stayed on screen, showing something
    // the document does not contain, until the panel remounted.
    const styles = {
      base: { [BASE_BREAKPOINT]: { opacity: 1 } },
    } as NodeStyles;
    const editor = mount({ effects: true }, styles);
    const field = screen.getByRole("textbox", { name: "Opacity" });

    fireEvent.change(field, { target: { value: "01" } });
    fireEvent.blur(field);

    expect(editor.applyAll).not.toHaveBeenCalled();
    expect((field as HTMLInputElement).value).toBe("1");
  });

  it("KEEPS a refused draft, so the author can correct it", () => {
    // The other half of the rule above, and the reason it is three outcomes
    // rather than a boolean: resetting here would delete what the author typed
    // the instant they got it wrong.
    const styles = {
      base: { [BASE_BREAKPOINT]: { opacity: 1 } },
    } as NodeStyles;
    mount({ effects: true }, styles);
    const field = screen.getByRole("textbox", { name: "Opacity" });

    fireEvent.change(field, { target: { value: "12 furlongs" } });
    fireEvent.blur(field);

    expect((field as HTMLInputElement).value).toBe("12 furlongs");
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("a free-form value the panel must let an author repair", () => {
  it("draws a TEXT FIELD for a free-form value the arm refuses on content", () => {
    // `fontStyle` is a keyword or a free-form value. `"oblique; color: red"` is
    // refused by both arms, and until the engine's rank learned to tell a
    // vocabulary refusal from a content one the catalog's first arm won — so
    // the author was handed a select, and the only way to repair the value was
    // to abandon it and choose a keyword instead.
    const styles = {
      base: { [BASE_BREAKPOINT]: { fontStyle: "oblique; color: red" } },
    } as NodeStyles;
    const editor = mount({ typography: true }, styles);
    const fontStyle = fieldsOf("fontStyle");

    const field = fontStyle.getByDisplayValue("oblique; color: red");
    fireEvent.change(field, { target: { value: "oblique 10deg" } });
    fireEvent.blur(field);

    // Repaired in place, which is the whole point: a select could only ever
    // have replaced the value with one of its three keywords.
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
  });

  it("still draws the KEYWORD control for a value the keyword arm accepts", () => {
    // The control that separates "the rank learned something" from "the panel
    // stopped drawing keyword controls and hands everything a text field".
    //
    // Which keyword control it is, is not the property under test. `fontStyle`
    // offers three short values, so it draws them as a group of buttons rather
    // than a menu — the discriminator here is that an accepted keyword does NOT
    // fall through to the free-form field the case above repairs in.
    const styles = {
      base: { [BASE_BREAKPOINT]: { fontStyle: "italic" } },
    } as NodeStyles;
    mount({ typography: true }, styles);

    expect(fieldsOf("fontStyle").queryByRole("textbox")).toBeNull();
    expect(
      fieldsOf("fontStyle").getByRole("button", { name: "italic" })
    ).toBeDefined();
  });
});

describe("naming a value the panel cannot edit", () => {
  it("points the read-only group at the note explaining it", () => {
    // The group carries the property's name and a Clear button. Without this
    // the note beside it — the only thing saying WHY the value cannot be
    // edited — is never announced, so a screen-reader user meets a read-only
    // field with no account of what made it one.
    const styles = {
      base: { [BASE_BREAKPOINT]: { fontSize: { value: "12px" } } },
    } as NodeStyles;
    mount({ typography: true }, styles);

    const group = fieldsOf("fontSize").getByRole("group", {
      name: "Font size",
    });
    const describedBy = group.getAttribute("aria-describedby");

    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe(
      "No control here can edit this value. It is still on the page and can be cleared."
    );
  });
});

describe("the numeric affordances a simple measurement earns", () => {
  const withPadding = (value: string): NodeStyles =>
    ({
      base: { [BASE_BREAKPOINT]: { padding: { blockStart: value } } },
    }) as NodeStyles;

  it("steps a measurement with the arrow keys, keeping its unit", () => {
    const editor = mount({ spacing: true }, withPadding("12px"));
    const field = fieldsOf("padding").getByLabelText("Block start");

    fireEvent.keyDown(field, { key: "ArrowUp" });

    expect(editor.applyAll.mock.calls[0]?.[0]?.[0]).toMatchObject({
      kind: "update",
      id: "a",
      patch: {
        styles: {
          base: { [BASE_BREAKPOINT]: { padding: { blockStart: "13px" } } },
        },
      },
    });
  });

  it("steps by ten with Shift, which is what every comparable editor does", () => {
    const editor = mount({ spacing: true }, withPadding("12px"));
    const field = fieldsOf("padding").getByLabelText("Block start");

    fireEvent.keyDown(field, { key: "ArrowDown", shiftKey: true });

    expect(editor.applyAll.mock.calls[0]?.[0]?.[0]).toMatchObject({
      patch: {
        styles: {
          base: { [BASE_BREAKPOINT]: { padding: { blockStart: "2px" } } },
        },
      },
    });
  });

  it("LEAVES a value it cannot decompose entirely alone", () => {
    // The property the whole design exists for. A field that modelled the value
    // as a number and a unit would answer this keystroke with `0px` and destroy
    // an expression the author spent real effort on — silently, because the
    // result is a perfectly valid declaration.
    const editor = mount(
      { spacing: true },
      withPadding("clamp(1rem, 2vw, 3rem)")
    );
    const field = fieldsOf("padding").getByLabelText("Block start");

    fireEvent.keyDown(field, { key: "ArrowUp" });
    fireEvent.keyDown(field, { key: "ArrowDown", shiftKey: true });

    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(field).toHaveProperty("value", "clamp(1rem, 2vw, 3rem)");
  });

  it("declines a step the property would reject, rather than writing and being refused", () => {
    // `padding` takes no negative measurement, so stepping `0px` down has no
    // legal answer. The distinction the assertions draw is between DECLINING
    // and writing something the validator then rejects: both leave the document
    // untouched, so `apply` alone cannot tell them apart. A rejected write also
    // raises the refusal message beside the field, so its ABSENCE is what says
    // the step never happened — the author gets a key that quietly does
    // nothing, not an error for a value they never typed.
    const editor = mount({ spacing: true }, withPadding("0px"));
    const field = fieldsOf("padding").getByLabelText("Block start");

    fireEvent.keyDown(field, { key: "ArrowDown" });

    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field).toHaveProperty("value", "0px");
  });

  it("offers a unit menu only where the value is one measurement", () => {
    mount({ spacing: true }, withPadding("12px"));
    expect(
      fieldsOf("padding").getByLabelText("Unit for Padding block start")
    ).toBeDefined();

    cleanup();
    clearBlocks();
    mount({ spacing: true }, withPadding("auto"));
    // A menu rendered over `auto` could only offer no-ops, and a control that
    // silently does nothing is worse than one that is not drawn.
    expect(
      fieldsOf("padding").queryByLabelText("Unit for Padding block start")
    ).toBeNull();
  });

  it("names each side's unit menu for that side, not for the property", () => {
    // A composite draws one menu per side. Named from the property alone, all
    // four would announce "Unit for Padding" and a screen-reader user could not
    // tell which side a menu edits, so the distinctness is asserted by naming
    // two of them rather than by matching one string.
    mount({ spacing: true }, {
      base: {
        [BASE_BREAKPOINT]: {
          padding: { blockStart: "12px", blockEnd: "4px" },
        },
      },
    } as NodeStyles);
    const padding = fieldsOf("padding");

    expect(
      padding.getByLabelText("Unit for Padding block start")
    ).toBeDefined();
    expect(padding.getByLabelText("Unit for Padding block end")).toBeDefined();
  });

  it("keeps a stored unit the menu does not offer, rather than showing an empty one", () => {
    // `ch` is a valid length this build does not put in the menu. A controlled
    // select with no matching item renders a BLANK trigger over a value that is
    // doing something, so the stored unit is carried as its own item.
    mount({ spacing: true }, withPadding("12ch"));

    expect(
      fieldsOf("padding").getByLabelText("Unit for Padding block start")
    ).toHaveProperty("textContent", "ch");
  });

  it("leaves scientific notation to the plain field", () => {
    // `1e-3rem` is a legal value with no decimal count that both preserves it
    // and survives a step: composing one back rounds it to `0`. Declining is
    // what keeps it intact, so neither affordance is offered.
    const editor = mount({ spacing: true }, withPadding("1e-3rem"));
    const field = fieldsOf("padding").getByLabelText("Block start");

    fireEvent.keyDown(field, { key: "ArrowUp" });

    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(field).toHaveProperty("value", "1e-3rem");
    expect(
      fieldsOf("padding").queryByLabelText("Unit for Padding block start")
    ).toBeNull();
  });
});

describe("what the arrow keys do and do not claim", () => {
  const withPadding = (value: string): NodeStyles =>
    ({
      base: { [BASE_BREAKPOINT]: { padding: { blockStart: value } } },
    }) as NodeStyles;

  it("steps the DRAFT an author is mid-edit on, not the stored value", () => {
    // A text input has no numeric fallback, so declining here would leave the
    // arrow doing nothing precisely while the field is being used — and reading
    // `stored` instead would step from a value the author has already moved on
    // from, discarding what they typed.
    const editor = mount({ spacing: true }, withPadding("12px"));
    const field = fieldsOf("padding").getByLabelText("Block start");

    fireEvent.change(field, { target: { value: "20px" } });
    fireEvent.keyDown(field, { key: "ArrowUp" });

    expect(editor.applyAll.mock.calls[0]?.[0]?.[0]).toMatchObject({
      patch: {
        styles: {
          base: { [BASE_BREAKPOINT]: { padding: { blockStart: "21px" } } },
        },
      },
    });
    // One op, not a commit of the draft followed by a step of the result.
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(field).toHaveProperty("value", "21px");
  });

  it("leaves an arrow to the IME while a composition is in progress", () => {
    // An IME uses the arrows to move through conversion candidates. Stepping
    // there edits the style AND suppresses the candidate move, so the author
    // loses the keystroke twice over. The shortcut manager states the same rule.
    const editor = mount({ spacing: true }, withPadding("12px"));
    const field = fieldsOf("padding").getByLabelText("Block start");

    fireEvent.keyDown(field, { key: "ArrowUp", isComposing: true });

    expect(editor.applyAll).not.toHaveBeenCalled();
  });

  it.each(["altKey", "ctrlKey", "metaKey"])(
    "leaves %s+Arrow to the platform",
    modifier => {
      // These chords are OS, browser and assistive-navigation shortcuts.
      // Claiming one mutates a style and adds an undo entry from a keystroke
      // the author aimed somewhere else entirely.
      const editor = mount({ spacing: true }, withPadding("12px"));
      const field = fieldsOf("padding").getByLabelText("Block start");

      fireEvent.keyDown(field, { key: "ArrowUp", [modifier]: true });

      expect(editor.applyAll).not.toHaveBeenCalled();
    }
  );

  it("swaps the unit on the quantity the AUTHOR is looking at", () => {
    // Two controls edit one value. With the draft private to the text field,
    // the menu read `stored` instead — so typing `20` over `12px` and then
    // picking `rem` committed `12rem`, silently discarding the 20 on screen.
    // `20` alone is refused on blur (padding takes no unitless number), which
    // is exactly why the stale value was still there to be composed from.
    const editor = mount({ spacing: true }, withPadding("12px"));
    const padding = fieldsOf("padding");
    const field = padding.getByLabelText("Block start");

    fireEvent.change(field, { target: { value: "20" } });
    fireEvent.blur(field);
    fireEvent.click(padding.getByLabelText("Unit for Padding block start"));
    fireEvent.click(screen.getByRole("option", { name: "rem" }));

    const written = editor.applyAll.mock.calls.at(-1)?.[0]?.[0] as {
      patch?: {
        styles?: Record<string, Record<string, Record<string, unknown>>>;
      };
    };
    const side = written.patch?.styles?.base?.[BASE_BREAKPOINT]?.padding as
      | { blockStart?: unknown }
      | undefined;
    expect(side?.blockStart).toBe("20rem");
  });

  it("points a refusal at the unit menu as well as the field", () => {
    // A unit change can be refused, and the message explaining it is rendered
    // once for the whole field. A screen-reader user who returns to the MENU is
    // otherwise sitting on the control that failed with nothing saying so.
    // `-5px` is refused because `padding` takes no negative measurement, and it
    // is still A MEASUREMENT — which matters, because the menu follows the
    // draft. A refusal that leaves unparseable text behind removes the menu
    // legitimately, so it could not carry a description at all.
    mount({ spacing: true }, withPadding("12px"));
    const padding = fieldsOf("padding");
    const field = padding.getByLabelText("Block start");

    fireEvent.change(field, { target: { value: "-5px" } });
    fireEvent.blur(field);

    // Asserted unconditionally. Guarding this on the menu being present would
    // pass in the world where it is absent — which is the world the assertion
    // is supposed to rule out — so the menu is required first and described
    // second.
    const unit = padding.getByLabelText("Unit for Padding block start");
    const description = field.getAttribute("aria-describedby");
    expect(description).not.toBeNull();
    expect(unit.getAttribute("aria-describedby")).toBe(description);
    expect(unit.getAttribute("aria-invalid")).toBe("true");
  });

  it("declines precision the formatter cannot round, rather than throwing", () => {
    // The engine accepts more fractional digits than `toFixed` takes, so
    // composing one would raise a RangeError in the middle of a keystroke.
    const editor = mount(
      { spacing: true },
      withPadding(`0.${"1".repeat(101)}px`)
    );
    const field = fieldsOf("padding").getByLabelText("Block start");

    expect(() => fireEvent.keyDown(field, { key: "ArrowUp" })).not.toThrow();
    expect(editor.applyAll).not.toHaveBeenCalled();
  });
});

describe("where a control's value came from", () => {
  /** The dot for one property's single control. */
  const dotIn = (property: string) =>
    document.querySelector(
      `[data-property="${property}"] .nx-style-inspector__provenance`
    );

  /**
   * A trace entry as the compiler records one.
   *
   * Hand-built rather than compiled, because these tests are about the WIRING —
   * that the panel resolves one subject, asks per control and renders the
   * answer. Whether the cascade itself is read correctly is
   * `style-provenance.test.ts`'s question and is settled there.
   */
  const entry = (over: Record<string, unknown> = {}) =>
    ({
      origin: { kind: "node", id: "a" },
      property: "color",
      value: "#111",
      state: "base",
      breakpoint: BASE_BREAKPOINT,
      ...over,
    }) as never;

  function mountWithTrace(entries: readonly unknown[] | undefined) {
    register({ color: true });
    const editor = editorFor(
      documentOf({ base: { [BASE_BREAKPOINT]: { color: "#111" } } })
    );
    render(
      <StyleInspectorPanel
        editor={editor}
        {...(entries === undefined
          ? {}
          : {
              // The cascade's tree is this document's own here: the harness
              // builds a document that needs no repair, so the prepared tree and
              // the stored one are the same nodes. Passing the editor's is what
              // makes these tests about the WIRING rather than about
              // preparation, which has its own suite.
              cascade: {
                entries,
                nodes: editor.document.nodes,
              } as never,
            })}
      />
    );
    return editor;
  }

  it("marks a value the author set on THIS block as set here", () => {
    mountWithTrace([entry()]);
    const dot = dotIn("color");
    expect(dot?.getAttribute("data-provenance")).toBe("authored");
    // Named for assistive technology, not only in a tooltip: a `title` reaches
    // a mouse and nothing else.
    expect(dot?.getAttribute("aria-label")).toBe("Set here");
  });

  it("names the CLASS an inherited value came from, by its slug", () => {
    /*
     * The slug, never the id. The id is storage and must not reach anything
     * rendered or queried; the slug is what the author typed and what the
     * canvas shows.
     */
    register({ color: true });
    const editor = editorFor({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "a",
          type: "acme/box",
          version: 1,
          props: {},
          classes: ["cls-1"],
        },
      ],
    } as never);
    render(
      <StyleInspectorPanel
        editor={editor}
        cascade={
          {
            nodes: editor.document.nodes,
            entries: [
              entry({
                origin: { kind: "class", id: "cls-1", slug: "card" },
              }),
            ] as never,
          } as never
        }
      />
    );
    const dot = dotIn("color");
    expect(dot?.getAttribute("data-provenance")).toBe("inherited");
    expect(dot?.getAttribute("aria-label")).toBe("Inherited from .card");
  });

  it("refuses to style a block whose id another block also uses", () => {
    /*
     * The case that makes the two trees disagree, and the one edit here that
     * could not mean what it appears to mean.
     *
     * Gating runs before deduplication, so a gated first duplicate leaves a
     * LATER node owning that id in the prepared tree while every lookup in the
     * stored document returns the first. Controls and writes would describe one
     * block while the dots describe another, and a write is addressed by id so
     * it lands on the first regardless of which one the panel displayed.
     *
     * Asserted on BOTH halves: the refusal is shown AND no control is drawn, so
     * a panel that rendered the note above a live field would fail this.
     */
    register({ color: true });
    const editor = editorFor({
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "a", type: "acme/box", version: 1, props: {} },
        { id: "a", type: "acme/box", version: 1, props: {} },
      ],
    } as never);

    const { container } = render(<StyleInspectorPanel editor={editor} />);

    expect(
      container.querySelector('[data-empty="duplicate-id"]')
    ).not.toBeNull();
    expect(container.querySelector("[data-property]")).toBeNull();
  });

  it("still styles a block whose id is unique, which is the control", () => {
    // Without this, refusing EVERY block would satisfy the case above and take
    // the whole panel with it.
    register({ color: true });
    const editor = editorFor(documentOf());

    const { container } = render(<StyleInspectorPanel editor={editor} />);

    expect(container.querySelector('[data-empty="duplicate-id"]')).toBeNull();
    expect(container.querySelector("[data-property]")).not.toBeNull();
  });

  it("resolves the selected node in the CASCADE's tree, not the stored one", () => {
    /*
     * The two trees are not always the same document. Read-time repair changes
     * which node owns an id — most sharply on a duplicated id, where gating can
     * remove the first node and leave a later one rendering under it — and then
     * the stored lookup returns a node whose classes, type and ancestors belong
     * to something that is not on the page. A class the canvas visibly applies
     * reads as set by nobody, or is attributed to the wrong tier.
     *
     * Modelled directly rather than through a repair fixture: the stored node
     * applies NO class and the cascade's node applies `cls-1`, so the origin can
     * only land if the subject was built from the cascade's tree. A repair
     * fixture would test the preparation pipeline, which has its own suite, and
     * would leave this wiring inferred rather than asserted.
     */
    register({ color: true });
    const stored = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "a", type: "acme/box", version: 1, props: {} }],
    } as never;
    const rendered = [
      {
        id: "a",
        type: "acme/box",
        version: 1,
        props: {},
        classes: ["cls-1"],
      },
    ];

    render(
      <StyleInspectorPanel
        editor={editorFor(stored)}
        cascade={
          {
            nodes: rendered,
            entries: [
              entry({ origin: { kind: "class", id: "cls-1", slug: "card" } }),
            ],
          } as never
        }
      />
    );

    expect(dotIn("color")?.getAttribute("aria-label")).toBe(
      "Inherited from .card"
    );
  });

  it("puts the same sentence in TEXT, for someone who tabs rather than points", () => {
    /*
     * The gap the dot alone leaves. `title` reaches a pointer and `aria-label`
     * reaches assistive technology; a sighted keyboard user sits between them
     * and had a coloured dot with nothing to explain it.
     *
     * Asserted as ONE string shared with the dot rather than as a literal,
     * because two copies of a sentence are two places for it to drift — and a
     * literal here would keep passing after the dot's wording changed.
     *
     * `aria-hidden` is asserted as the other half: without it the same sentence
     * is announced twice, and the fix for one group becomes a regression for
     * another. The VISIBLE reveal is `:focus-within` in the stylesheet, which
     * jsdom does not apply — what is certified here is the DOM contract the
     * reveal depends on.
     */
    register({ color: true });
    const editor = editorFor({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "a",
          type: "acme/box",
          version: 1,
          props: {},
          classes: ["cls-1"],
        },
      ],
    } as never);
    render(
      <StyleInspectorPanel
        editor={editor}
        cascade={
          {
            nodes: editor.document.nodes,
            entries: [
              entry({
                origin: { kind: "class", id: "cls-1", slug: "card" },
              }),
            ] as never,
          } as never
        }
      />
    );

    const text = document.querySelector(
      '[data-property="color"] .nx-style-inspector__provenance-text'
    );

    // The POPULATION first. Both sides of the comparison below read through
    // `?.`, so a query that found nothing would compare `undefined` with
    // `undefined` and pass while nothing was rendered at all.
    expect(dotIn("color")).not.toBeNull();
    expect(text).not.toBeNull();
    expect(text?.textContent).toBe(dotIn("color")?.getAttribute("aria-label"));
    expect(text?.textContent).not.toBe("");
    expect(text?.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws NOTHING while previewing and nobody has said which tier is live", () => {
    /*
     * Silence in this API is a CLAIM, which is what makes the obvious fix wrong.
     *
     * Under a preview compile the viewport tiers are container queries and a
     * `matchMedia` caller cannot evaluate them, so the window-derived answer is
     * the base context alone. Passed on, `liveBreakpoints: ["base"]` asserts
     * that base is what the browser is applying — and a narrow preview box
     * showing the mobile tier would have every mobile declaration excluded and
     * the base value reported as the visible winner.
     *
     * No dot means "not asked", which is true until a caller observes the box.
     */
    register({ color: true });
    const editor = editorFor(documentOf());

    render(
      <StyleInspectorPanel
        editor={editor}
        breakpoints={
          {
            viewport: [{ id: "mobile", label: "Mobile", maxWidth: 575 }],
            container: [],
          } as never
        }
        previewContainer="nx-preview-viewport"
        cascade={
          {
            nodes: editor.document.nodes,
            entries: [entry()],
          } as never
        }
      />
    );

    expect(dotIn("color")).toBeNull();
  });

  it("draws one once the host SAYS which tier is live, which is the control", () => {
    /*
     * Without this, a panel that never drew a dot while previewing would satisfy
     * the case above and the affordance would simply be gone rather than
     * withheld — an absence proving nothing about the gate.
     */
    register({ color: true });
    const editor = editorFor(documentOf());

    render(
      <StyleInspectorPanel
        editor={editor}
        breakpoints={
          {
            viewport: [{ id: "mobile", label: "Mobile", maxWidth: 575 }],
            container: [],
          } as never
        }
        previewContainer="nx-preview-viewport"
        liveBreakpoints={["base"]}
        cascade={
          {
            nodes: editor.document.nodes,
            entries: [entry()],
          } as never
        }
      />
    );

    expect(dotIn("color")).not.toBeNull();
  });

  it("still draws one when the compiler REFUSED the stated container name", () => {
    /*
     * A stated name is not an active preview, and the two must not be conflated
     * because the compile does not conflate them either.
     *
     * `previewContainerName` refuses an empty, reserved, malformed or oversized
     * string, and a refused name makes the compile PUBLISHED — viewport tiers
     * emit ordinary `@media`, which `matchMedia` can evaluate. So the window's
     * answer is authoritative here, and withholding the indicator would remove
     * a correct affordance from every surface that passed a name the compiler
     * threw away.
     *
     * Driven through the refusals the compiler actually enumerates rather than
     * one representative, because each reaches a different branch of it: a
     * length bound read before trimming, a reserved CSS-wide keyword, and a
     * character the identifier grammar excludes.
     */
    // Registered ONCE: the block registry outlives `cleanup`, which unmounts
    // the tree and leaves registrations in place, so a second call inside the
    // loop is a redefinition and the registry refuses it.
    register({ color: true });

    for (const refused of ["", "   ", "none", "has space"]) {
      cleanup();
      const editor = editorFor(documentOf());

      render(
        <StyleInspectorPanel
          editor={editor}
          breakpoints={
            {
              viewport: [{ id: "mobile", label: "Mobile", maxWidth: 575 }],
              container: [],
            } as never
          }
          previewContainer={refused}
          cascade={
            {
              nodes: editor.document.nodes,
              entries: [entry()],
            } as never
          }
        />
      );

      expect(dotIn("color")).not.toBeNull();
    }
  });

  it("IGNORES a host's live set when the compiler refused the container name", () => {
    /*
     * The two halves of one question, which were briefly two answers.
     *
     * A refused name makes the compile PUBLISHED — viewport tiers emit ordinary
     * `@media`, which the window decides. A host that forwards both canvas
     * props unconditionally then supplies a box-derived set for a sheet the box
     * is not deciding, and provenance gets judged against a tier the browser is
     * not displaying.
     *
     * `liveBreakpoints` is deliberately a set that would change the verdict if
     * it were consulted: the entry writes at `mobile`, so believing the host
     * would report the control as set, while the window here matches nothing
     * beyond the base context and the honest answer is that it is not.
     */
    register({ color: true });
    const editor = editorFor(documentOf());

    render(
      <StyleInspectorPanel
        editor={editor}
        breakpoints={
          {
            viewport: [{ id: "mobile", label: "Mobile", maxWidth: 575 }],
            container: [],
          } as never
        }
        previewContainer="none"
        liveBreakpoints={["base", "mobile"]}
        cascade={
          {
            nodes: editor.document.nodes,
            entries: [entry({ breakpoint: "mobile" })],
          } as never
        }
      />
    );

    expect(dotIn("color")).toBeNull();
  });

  it("USES the host's live set when the name was accepted, which is the control", () => {
    /*
     * Without this, a panel that ignored `liveBreakpoints` under every
     * circumstance would satisfy the case above — the assertion there is
     * satisfied by absence, so its meaning depends on this one.
     *
     * Same entry, same host set; only the container name differs, and it is the
     * difference between a compile the window decides and one the box does.
     */
    register({ color: true });
    const editor = editorFor(documentOf());

    render(
      <StyleInspectorPanel
        editor={editor}
        breakpoints={
          {
            viewport: [{ id: "mobile", label: "Mobile", maxWidth: 575 }],
            container: [],
          } as never
        }
        previewContainer="nx-preview-viewport"
        liveBreakpoints={["base", "mobile"]}
        cascade={
          {
            nodes: editor.document.nodes,
            entries: [entry({ breakpoint: "mobile" })],
          } as never
        }
      />
    );

    expect(dotIn("color")).not.toBeNull();
  });

  it("draws NOTHING for a property no tier set", () => {
    // Eight empty dots per section is the shape that trains an author to stop
    // reading the panel.
    register({ color: true });
    const editor = editorFor(documentOf());
    render(
      <StyleInspectorPanel
        editor={editor}
        cascade={{ entries: [], nodes: editor.document.nodes } as never}
      />
    );
    expect(dotIn("color")).toBeNull();
  });

  it("draws nothing at all when the host supplies no trace", () => {
    /*
     * Absent means the question was never asked, which is NOT "nothing is
     * inherited". A host that cannot compile gets no indicators rather than a
     * panel confidently reporting every control as unset.
     *
     * The control itself still renders, which is the separating half: a panel
     * that had thrown would also show no dots.
     */
    mountWithTrace(undefined);
    expect(dotIn("color")).toBeNull();
    expect(fieldsOf("color").getByLabelText("Color")).toBeTruthy();
  });

  it("draws nothing when the trace cannot say WHICH control wrote it", () => {
    /*
     * The case the record reports rather than guesses, and the one a dot must
     * not claim. `background-image` is written by TWO catalog controls —
     * `background.url` and `backgroundGradient` — and the trace identifies a
     * declaration by its CSS property and selector, which does not separate
     * them. With one of the pair stored, treating the winner as this control's
     * would light the dot on a control the author never touched.
     *
     * Reported as ambiguous by `styleProvenance`; drawn as nothing here, which
     * is the same judgement one level up.
     */
    register({ background: { image: true } });
    const editor = editorFor(
      documentOf({
        base: { [BASE_BREAKPOINT]: { background: { url: "/a.png" } } },
      })
    );
    render(
      <StyleInspectorPanel
        editor={editor}
        cascade={
          {
            nodes: editor.document.nodes,
            entries: [
              entry({
                property: "background-image",
                value: 'url("/a.png")',
              }),
            ] as never,
          } as never
        }
      />
    );

    /*
     * The separating half: the control IS on screen and IS showing the stored
     * value, so the absent dot is the ambiguity being respected rather than the
     * panel having failed to render the field at all.
     */
    expect(fieldsOf("background").getByLabelText("Url")).toBeTruthy();
    expect(dotIn("background")).toBeNull();
  });

  it("resolves the subject ONCE however many controls are shown", () => {
    /*
     * The cost this indicator was designed around. Every control asks about the
     * same node, so the document must be walked once per render and not once
     * per control — the panel's own comments call walking it per control the
     * thing that must not happen.
     *
     * Asserted through the rendered result rather than by counting calls: with
     * several controls on screen, all of them answer, which is only possible
     * from one shared subject.
     */
    register({ spacing: true });
    const editor = editorFor(
      documentOf({
        base: {
          [BASE_BREAKPOINT]: {
            padding: { blockStart: "8px", blockEnd: "12px" },
          },
        },
      })
    );
    render(
      <StyleInspectorPanel
        editor={editor}
        cascade={
          {
            nodes: editor.document.nodes,
            entries: [
              entry({ property: "padding-block-start", value: "8px" }),
              entry({ property: "padding-block-end", value: "12px" }),
            ] as never,
          } as never
        }
      />
    );

    // `spacing` draws a field per side, so the panel is answering for several
    // controls at once — which one shared subject is what makes affordable.
    const dots = document.querySelectorAll(
      '[data-property="padding"] .nx-style-inspector__provenance'
    );
    expect(dots.length).toBe(2);
    expect(
      Array.from(dots).map(dot => dot.getAttribute("data-provenance"))
    ).toEqual(["authored", "authored"]);
  });
});

describe("naming the place a value came from", () => {
  /*
   * The four-way `node` answer is pure logic over an origin, an entry and the
   * address being edited, so it is asked directly. Driving it through the panel
   * would need a fixture where an ancestor's descendant rule wins for a
   * descendant-selector control — reachable, but the fixture would be testing
   * the ENGINE's cascade rather than this wording, and the cascade has its own
   * suite.
   */
  const editing = {
    nodeId: "a",
    blockType: "acme/box",
    state: "base" as never,
    breakpoint: BASE_BREAKPOINT,
    labelOf: (id: string) => (id === "md" ? "Medium" : id),
  };
  const at = (over: Record<string, unknown> = {}) =>
    ({
      property: "color",
      value: "#111",
      state: "base",
      breakpoint: BASE_BREAKPOINT,
      ...over,
    }) as never;

  const nameFor = (origin: unknown, entry = at()) =>
    describeProvenance(
      { kind: "inherited", entry, from: origin } as never,
      editing as never
    )?.text;

  it("names a class by its SLUG, never its id", () => {
    // The id is storage and must not reach anything rendered or queried; the
    // slug is what the author typed and what the canvas shows.
    expect(nameFor({ kind: "class", id: "cls-1", slug: "card" })).toBe(
      "Inherited from .card"
    );
  });

  it("names the block's own defaults and the page", () => {
    expect(nameFor({ kind: "blockType", type: "acme/box" })).toBe(
      "Inherited from this block's defaults"
    );
    expect(nameFor({ kind: "page" })).toBe("Inherited from the page");
  });

  it("separates an ENCLOSING block's defaults from this block's", () => {
    /*
     * The same route the `node` case takes: `reachesThroughAncestor` matches a
     * `blockType` origin against the ANCESTOR's type, so a descendant rule from
     * an enclosing block's defaults arrives carrying that block's type. Told
     * "this block's defaults", an author goes looking in the wrong block's
     * definition.
     */
    expect(nameFor({ kind: "blockType", type: "acme/section" })).toBe(
      "Inherited from an enclosing block's defaults"
    );
  });

  it("separates an ENCLOSING block from this one", () => {
    /*
     * The defect this replaced: every `node` origin read as "this block". An
     * ancestor's rule reaches here through a descendant selector and the winning
     * entry then carries the ANCESTOR's id, so an author told "this block" goes
     * looking for a value that is not on the block they selected.
     */
    expect(nameFor({ kind: "node", id: "outer" })).toBe(
      "Inherited from an enclosing block"
    );
    expect(nameFor({ kind: "node", id: "a" })).toBe(
      "Inherited from this block"
    );
  });

  it("names the BREAKPOINT a same-node value came from, by its label", () => {
    expect(nameFor({ kind: "node", id: "a" }, at({ breakpoint: "md" }))).toBe(
      "Inherited from this block at Medium"
    );
  });

  it("names the STATE a same-node value came from", () => {
    expect(nameFor({ kind: "node", id: "a" }, at({ state: "hover" }))).toBe(
      "Inherited from this block in its hover state"
    );
  });

  it("names the DEFINITION the compiler kept, not the first one stored", () => {
    /*
     * The label and the rule have to come from the same row or the tooltip sends
     * an author to a definition that did not produce the value.
     *
     * `breakpointContexts` sorts each axis WIDEST-FIRST and then claims each id
     * once, so of two rows storing `dup` the wider survives and emits the rule.
     * A raw search over the stored axes returns whichever was written first.
     * Stored narrow-then-wide, those two disagree — which is why the fixture is
     * in that order and not the other.
     *
     * The engine is asked for the expectation rather than a literal, so this
     * tracks the compiler if its normalisation ever changes rather than pinning
     * today's answer as a second opinion.
     */
    const set = {
      viewport: [
        { id: "dup", label: "Narrow row", maxWidth: 400 },
        { id: "dup", label: "Wide row", maxWidth: 900 },
      ],
      container: [],
    } as unknown as BreakpointSet;

    const kept = breakpointContexts(set).find(context => context.id === "dup");

    expect(kept?.maxWidth).toBe(900);
    expect(breakpointLabel(set, "dup")).toBe("Wide row");
  });

  it("falls back to the id for a breakpoint the settings no longer define", () => {
    // A value keyed to a removed breakpoint is exactly what an author needs to
    // recognise; a placeholder would tell them nothing they can act on.
    expect(breakpointLabel({ viewport: [], container: [] }, "gone")).toBe(
      "gone"
    );
  });

  it("carries the address on a CLASS origin too, not only on a node", () => {
    /*
     * The same misdirection one tier over, and the reason the qualifiers were
     * moved out of the node branch. A class holds responsive and
     * interaction-state values of its own, so a Mobile declaration on `.card`
     * winning while the panel edits base is answered by ".card" alone — and the
     * author opens the class editor at base, sees a different value, and has no
     * way to learn the one on screen came from another row.
     *
     * Asserted on the qualifier specifically, not just the whole string, so a
     * regression that drops it cannot pass by matching the slug.
     */
    const label = nameFor(
      { kind: "class", id: "cls-1", slug: "card" },
      at({ breakpoint: "md" })
    );

    expect(label).toContain("at Medium");
    expect(label).toBe("Inherited from .card at Medium");
  });

  it("says which control a non-node rule came THROUGH, without moving the place", () => {
    /*
     * The control is the subject only for a value on this block, where it is the
     * field to open. On a class it is a qualifier: the rule came through that
     * field, and the place to go is still the class. Told only "the Link color
     * control", an author would look on the block and find nothing.
     */
    const label = nameFor(
      { kind: "class", id: "cls-1", slug: "card" },
      at({ property: "color", descendant: " a" })
    );

    expect(label).toContain(".card");
    expect(label).toContain("via");
  });

  it("names BOTH axes when both differ, not just the first", () => {
    /*
     * The defect a first-match answer produces, and it needs no unusual document
     * to reach: editing hover at Tablet, a value arriving from base at Mobile.
     * Labelled "this block at Mobile", the author goes to hover at Mobile —
     * a real address that does not hold the value — finds nothing, and the
     * indicator has misdirected rather than merely under-informed them.
     *
     * The separating property is asserted directly: the state has to APPEAR, so
     * a label that merely happens to name the breakpoint cannot satisfy this.
     */
    const label = nameFor(
      { kind: "node", id: "a" },
      at({ breakpoint: "md", state: "hover" })
    );

    expect(label).toContain("Medium");
    expect(label).toContain("hover");
    expect(label).toBe(
      "Inherited from this block at Medium in its hover state"
    );
  });

  it("names the CONTROL a descendant rule came from, not just the block", () => {
    /*
     * A rule reaches a control whose descendant selector is more specific than
     * its own: with no hover value stored, `linkColorHover` displays the plain
     * `a` declaration. Same node, same breakpoint, same state — so what differs
     * is WHICH CONTROL wrote it, and "this block" leaves the author unable to
     * find the field that actually holds the value.
     *
     * Named from the catalog rather than from the selector: ` a` is not a name
     * an author has seen anywhere.
     */
    expect(
      describeProvenance(
        {
          kind: "inherited",
          entry: at({ property: "color", descendant: " a" }),
          from: { kind: "node", id: "a" },
        } as never,
        editing as never,
        "a:hover"
      )?.text
    ).toBe("Inherited from the Link color control");
  });

  it("still says 'this block' when the control's OWN rule won", () => {
    /*
     * The control. Naming a source whenever a descendant exists would relabel
     * every link control on the page, including the ones displaying exactly what
     * they wrote.
     */
    expect(
      describeProvenance(
        {
          kind: "inherited",
          entry: at({ property: "color", descendant: " a", breakpoint: "md" }),
          from: { kind: "node", id: "a" },
        } as never,
        editing as never,
        "a"
      )?.text
    ).toBe("Inherited from this block at Medium");
  });

  it("says nothing at all for unset and for ambiguous", () => {
    // Both are cases where a dot would claim something the record does not say.
    expect(
      describeProvenance({ kind: "unset" } as never, editing as never)
    ).toBeNull();
    expect(
      describeProvenance(
        { kind: "ambiguous", entry: at(), sharedWith: ["a", "b"] } as never,
        editing as never
      )
    ).toBeNull();
    expect(describeProvenance(undefined, editing as never)).toBeNull();
  });
});

describe("the action a control's breakpoint provenance earns", () => {
  const SITE = {
    viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
    container: [],
  } as never;

  const action = (kind: "reset" | "jump") =>
    document.querySelector(
      `[data-property="color"] [data-action="${kind}"]`
    ) as HTMLElement | null;

  const entryAt = (breakpoint: string) =>
    ({
      origin: { kind: "node", id: "a" },
      property: "color",
      value: "#111",
      state: "base",
      breakpoint,
    }) as never;

  function mount(opts: {
    stored: string;
    entries: readonly unknown[];
    onJump?: (breakpoint: string) => void;
    /** Which tier the panel is editing; base unless a case needs otherwise. */
    editing?: string;
  }) {
    register({ color: true });
    const editor = editorFor(
      documentOf({ base: { [opts.stored]: { color: "#111" } } })
    );
    render(
      <StyleInspectorPanel
        editor={editor}
        breakpoints={SITE}
        {...(opts.editing === undefined
          ? {}
          : { breakpoint: opts.editing as never })}
        /*
         * PREVIEWING, which is what makes the host's live set authoritative.
         * Published, the window decides and a supplied set is ignored — so
         * without this the panel asks jsdom's absent `matchMedia`, gets the
         * base context alone, and every control reads as unset. The real mount
         * previews whenever the site defines a viewport tier.
         */
        previewContainer="nx-preview-viewport"
        liveBreakpoints={[BASE_BREAKPOINT, "tablet"] as never}
        cascade={
          { entries: opts.entries, nodes: editor.document.nodes } as never
        }
        {...(opts.onJump === undefined
          ? {}
          : { onJumpToBreakpoint: opts.onJump as never })}
      />
    );
    return editor;
  }

  it("offers NOTHING on a control the author has not touched", () => {
    /*
     * The bound the whole design rests on. `ProvenanceDot` refuses to be
     * focusable because a stop per control would double the presses to cross a
     * section of eight or more, and a button on every control would spend that
     * same cost. Unset controls are the large majority of a panel, and they
     * earn no action.
     */
    /*
     * The jump handler IS supplied, so this asserts the absence for the reason
     * it claims: the control earns no action, rather than the host merely being
     * unable to honour one.
     *
     * Measured while break-verifying: the `none` early exit cannot be
     * distinguished by any test, because the jump handler is bound per leaf and
     * only for an `inherited` badge — so a `none` badge reaches the jump branch
     * with nothing to call and returns anyway. The guard is a readable exit
     * rather than a load-bearing one, and this case does not pretend to cover
     * it.
     */
    mount({ stored: BASE_BREAKPOINT, entries: [], onJump: () => {} });

    expect(action("reset")).toBeNull();
    expect(action("jump")).toBeNull();
  });

  it("offers a RESET for a value authored at the tier being edited", () => {
    mount({ stored: BASE_BREAKPOINT, entries: [entryAt(BASE_BREAKPOINT)] });

    expect(action("reset")).not.toBeNull();
    expect(action("jump")).toBeNull();
  });

  it("names what the reset will REVEAL, rather than only that it clears", () => {
    /*
     * "Reset" alone asks an author to guess whether the control becomes unset
     * or falls back to a wider tier's value. In a desktop-first cascade it is
     * usually the second, and not always base.
     */
    /*
     * Editing the NARROW tier, which is the only arrangement where a control is
     * authored here AND something wider shows through. At base the narrower
     * entry wins the cascade instead, so the control reads as inherited and
     * earns a jump rather than a reset.
     */
    mount({
      stored: "tablet",
      editing: "tablet",
      entries: [entryAt(BASE_BREAKPOINT), entryAt("tablet")],
    });

    const label = action("reset")?.getAttribute("aria-label");
    /*
     * Named by the PROPERTY, not the leaf alone. `margin` and `padding` both
     * have a block start, so two controls would offer buttons called "Reset
     * Block start" and a screen-reader user could not tell which style each
     * removes — the same reason the panel computes an action name for `Clear`.
     */
    expect(label).toContain("Color");
    /*
     * The tier a reset falls back to is NAMED, not left to be guessed. The
     * unconditional tier has no authored definition to take a label from, so it
     * is called by its id here — the same name every other sentence in this
     * panel gives it, which is the point: one naming, not a second one invented
     * for this button.
     */
    expect(label).toContain("from base");
  });

  it("names the action by its PROPERTY, not by the leaf alone", () => {
    /*
     * `margin` and `padding` both have a block start, so a button named from
     * the leaf alone reads "Reset Block start" on both and a screen-reader user
     * cannot tell which style each removes. The panel already computes an
     * action name for exactly this — `Clear` on a token value uses it — and a
     * simple property like `color` cannot show the difference, because there
     * the property label and the leaf label are the same word.
     */
    register({ spacing: true });
    const editor = editorFor(
      documentOf({
        base: { [BASE_BREAKPOINT]: { padding: { blockStart: "8px" } } },
      })
    );
    render(
      <StyleInspectorPanel
        editor={editor}
        breakpoints={SITE}
        previewContainer="nx-preview-viewport"
        liveBreakpoints={[BASE_BREAKPOINT] as never}
        cascade={
          {
            entries: [
              {
                origin: { kind: "node", id: "a" },
                property: "padding-block-start",
                value: "8px",
                state: "base",
                breakpoint: BASE_BREAKPOINT,
              },
            ],
            nodes: editor.document.nodes,
          } as never
        }
      />
    );

    const label = document
      .querySelector('[data-property="padding"] [data-action="reset"]')
      ?.getAttribute("aria-label");

    expect(label).toContain("Padding");
    expect(label).toContain("Reset");
  });

  it("declares WHICH field it writes, so a picker does not write twice", () => {
    /*
     * The colour picker commits its draft when the popover closes, and pressing
     * anything outside it closes the popover first. Without this declaration
     * one Reset gesture writes twice — the draft the author was discarding,
     * then the clear — and the first undo restores the very colour they pressed
     * Reset to be rid of.
     *
     * The field is NAMED rather than the promise being made bare, because a
     * bare one is made to every picker in the panel: a Reset on one control
     * would then discard an unfinished gesture on another that it replaces
     * nothing of.
     *
     * The MECHANISM is covered behaviourally in `style-colour-panel.test.tsx`,
     * which drives a real picker against both a Reset on its own control and a
     * Reset on a different one. What is only true here is that Reset names the
     * control it is drawn beside.
     */
    mount({ stored: BASE_BREAKPOINT, entries: [entryAt(BASE_BREAKPOINT)] });

    const field = document.querySelector(
      '[data-property="color"] input'
    ) as HTMLInputElement | null;
    expect(field?.id).toBeTruthy();
    expect(action("reset")?.getAttribute("data-nx-commits-for")).toBe(
      field?.id
    );
  });

  it("names the AXIS in the reset fallback, as the jump does", () => {
    /*
     * A container tier can share a label with a viewport one, which is why
     * `BreakpointSource` carries the axis at all. A reset saying "showing the
     * value from Tablet" beside a jump saying "Tablet (container)" leaves the
     * author to work out that the two Tablets are different tiers.
     */
    register({ color: true });
    const editor = editorFor(
      documentOf({ base: { [BASE_BREAKPOINT]: { color: "#111" } } })
    );
    render(
      <StyleInspectorPanel
        editor={editor}
        breakpoints={
          {
            viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
            container: [{ id: "card", label: "Tablet", maxWidth: 400 }],
          } as never
        }
        previewContainer="nx-preview-viewport"
        liveBreakpoints={[BASE_BREAKPOINT, "card"] as never}
        cascade={
          {
            /*
             * The container entry FIRST and the base entry after it, so base
             * wins the cascade and the control reads as authored here — which
             * is the only state that offers a reset. Reversed, the container
             * declaration wins, the control reads as inherited, and this case
             * would assert against a button that is not drawn.
             */
            entries: [entryAt("card"), entryAt(BASE_BREAKPOINT)],
            nodes: editor.document.nodes,
          } as never
        }
      />
    );

    const label = action("reset")?.getAttribute("aria-label") ?? "";
    /*
     * Asserted unconditionally. A guard like `if (label.includes("Tablet"))`
     * would pass whenever the reveal came out empty, which is the failure this
     * case is meant to catch dressed as a pass.
     */
    expect(label).toContain("Tablet (container)");
  });

  it("offers a JUMP for a value that came from another tier", () => {
    mount({
      stored: BASE_BREAKPOINT,
      entries: [entryAt("tablet")],
      onJump: () => {},
    });

    expect(action("jump")).not.toBeNull();
  });

  it("withholds the jump for a tier the canvas cannot be taken to", () => {
    /*
     * Two ids can carry one bound, and only the winner is offered as a choice —
     * but a declaration stored under the loser can still be what a control is
     * showing. A jump there cannot be honoured: the width lookup answers
     * `undefined`, which the host reads as the unconditional tier and RELEASES
     * the canvas, so the value the author was chasing can disappear.
     *
     * Naming the tier stays right; travelling to it does not.
     */
    register({ color: true });
    const editor = editorFor(
      documentOf({ base: { [BASE_BREAKPOINT]: { color: "#111" } } })
    );
    render(
      <StyleInspectorPanel
        editor={editor}
        breakpoints={
          {
            viewport: [
              { id: "alpha", label: "Alpha", maxWidth: 991 },
              { id: "beta", label: "Beta", maxWidth: 991 },
            ],
            container: [],
          } as never
        }
        previewContainer="nx-preview-viewport"
        liveBreakpoints={[BASE_BREAKPOINT, "alpha"] as never}
        cascade={
          {
            entries: [
              {
                origin: { kind: "node", id: "a" },
                property: "color",
                value: "#111",
                state: "base",
                breakpoint: "alpha",
              },
            ],
            nodes: editor.document.nodes,
          } as never
        }
        onJumpToBreakpoint={(() => {}) as never}
      />
    );

    // `beta` is the tier the compiler kept for 991, so `alpha` is unreachable.
    expect(
      document.querySelector('[data-property="color"] [data-action="jump"]')
    ).toBeNull();
  });

  it("withholds the jump when the host cannot move the canvas", () => {
    /*
     * A button that does nothing reads as broken rather than as absent, and a
     * host with no canvas width to move has no way to honour it.
     */
    mount({ stored: BASE_BREAKPOINT, entries: [entryAt("tablet")] });

    expect(action("jump")).toBeNull();
  });

  it("jumps to the tier the VALUE came from, not to a fixed one", () => {
    /*
     * The target is this control's own source: a different control on the same
     * panel jumps somewhere else, which is why the handler is bound per leaf
     * rather than threaded as one prop.
     */
    const jumped: string[] = [];
    mount({
      stored: BASE_BREAKPOINT,
      entries: [entryAt("tablet")],
      onJump: id => jumped.push(id),
    });

    fireEvent.click(action("jump") as HTMLElement);

    expect(jumped).toEqual(["tablet"]);
  });
});

/**
 * The segmented control, exercised as a control rather than as a rendering.
 *
 * These four assertions could not be written until a catalog property reached
 * the toggle: it draws only where the whole keyword vocabulary fits, and until
 * that admitted three options no supported property produced one. `fontStyle`
 * does now, so the behaviours below are reachable — and each of them has been
 * wrong once already, found by reading rather than by any test, because there
 * was nothing that could render the control to ask.
 */
describe("a segmented keyword control behaves as a toggle", () => {
  /** The buttons of the `fontStyle` toggle, by their option name. */
  const optionButton = (name: string) =>
    fieldsOf("fontStyle").getByRole("button", { name });

  /**
   * Every option button, found through the group BY ITS ACCESSIBLE NAME.
   *
   * Named rather than merely located, because the name is what makes the group
   * mean anything to a screen reader: without `aria-labelledby` the buttons are
   * three unattached options with no property attached to them, and a query
   * asking only for a group cannot tell those two states apart.
   */
  const allOptions = () =>
    within(
      fieldsOf("fontStyle").getByRole("group", { name: "Font style" })
    ).getAllByRole("button") as HTMLButtonElement[];

  /**
   * The node's styles AFTER the recorded ops are applied to the document.
   *
   * Applied rather than read out of the patch, because reading the patch cannot
   * tell a removal from an operation that does nothing: an update carrying no
   * `styles` key at all answers `undefined` exactly as a clear does, so every
   * clear assertion below would pass against a handler that submits an empty
   * edit and leaves the value on the page. `applyOps` also REFUSES an update
   * that changes nothing, so a no-op cannot even reach a document to be read.
   */
  const styleAfter = (
    editor: ReturnType<typeof editorFor>
  ): string | undefined => {
    const ops = editor.applyAll.mock.calls[0]?.[0] as
      | readonly BuilderOp[]
      | undefined;
    if (ops === undefined) throw new Error("no ops were applied");
    const applied = applyOps(editor.document, ops);
    if (applied.document === null) {
      throw new Error("the ops were refused, so nothing was applied");
    }
    const node = applied.document.nodes[0] as { styles?: NodeStyles };
    return node.styles?.base?.[BASE_BREAKPOINT]?.fontStyle as
      | string
      | undefined;
  };

  /** The panel with one `fontStyle` value already stored, or none. */
  const mountWith = (stored?: string | undefined) =>
    mount(
      { typography: true },
      stored === undefined
        ? undefined
        : ({ base: { [BASE_BREAKPOINT]: { fontStyle: stored } } } as NodeStyles)
    );

  /*
   * Every case below is driven from MORE THAN ONE option, and that is the point
   * rather than thoroughness for its own sake. `fontStyle` offers three, so an
   * implementation special-cased to whichever one a fixture happens to store —
   * pressing `italic` whenever anything is set, committing `oblique` for every
   * unpressed button, clearing only when `italic` is the pressed one — passes a
   * suite that only ever exercises that value, and passes it while being wrong
   * about the other two.
   */
  it.each(["normal", "italic", "oblique"])(
    "shows %s as the pressed option when it is the stored value",
    stored => {
      mountWith(stored);

      for (const button of allOptions()) {
        expect(button.getAttribute("aria-pressed")).toBe(
          String(button.textContent?.trim() === stored)
        );
      }
    }
  );

  it.each(["normal", "italic", "oblique"])(
    "CLEARS when the pressed option %s is pressed again",
    stored => {
      /*
       * The only route to unset that does not spend a button on "neither".
       *
       * BOTH assertions are load-bearing. Re-writing a value the document
       * already holds produces NO ops — the write path treats "the document
       * already says this" as nothing to do — so `applyAll` is never reached
       * and the styles it would have left read as absent. Absent is also what a
       * clear leaves, so the value assertion alone passes for the very
       * implementation it exists to reject.
       */
      const editor = mountWith(stored);

      fireEvent.click(optionButton(stored));

      // Exactly once: a handler committing twice would satisfy "was called" and
      // spend two history entries on one gesture.
      expect(editor.applyAll).toHaveBeenCalledTimes(1);
      expect(styleAfter(editor)).toBeUndefined();
    }
  );

  it.each([
    ["italic", "normal"],
    ["italic", "oblique"],
    ["normal", "oblique"],
    // `italic` as a DESTINATION, which the rows above never make it: they only
    // ever click it while it is already pressed. Without this a handler reading
    // `pressed || option === "italic" ? null : option` clears instead of
    // storing it, and every row still passes.
    ["normal", "italic"],
    // And from UNSET, which is the state a newly styled node is in. A handler
    // treating an absent value as nothing-to-do would make the first click on
    // any option do nothing, with only this row to say so.
    [undefined, "italic"],
  ])("writes %s -> %s when a different option is pressed", (stored, next) => {
    /*
     * The positive control for the clear case, and the option-to-value mapping
     * with it: a handler that committed one constant for every unpressed button
     * would leave the clear assertions green while storing the wrong style.
     */
    const editor = mountWith(stored);

    fireEvent.click(optionButton(next));

    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(styleAfter(editor)).toBe(next);
  });

  it("marks EVERY button invalid when the store refuses the edit", () => {
    /*
     * A control described by a refusal and not marked invalid announces the
     * message as a HINT rather than as a failure. `aria-invalid` sits on the
     * buttons rather than on the group because `role="group"` does not support
     * the state, so setting it there is an attribute a reader may ignore.
     *
     * Asserted across the whole control: one refused control has one state, and
     * marking only the button that was clicked would leave the other two
     * reading as valid parts of a control that is not.
     */
    const editor = mount({ typography: true });

    // The positive control, BEFORE the refusal. Without it an implementation
    // that marks every button invalid unconditionally passes — and that
    // regression announces untouched, perfectly editable controls as erroneous.
    for (const button of allOptions()) {
      expect(button.getAttribute("aria-invalid")).toBeNull();
    }

    editor.applyAll.mockReturnValue(null);
    fireEvent.click(optionButton("italic"));

    for (const button of allOptions()) {
      expect(button.getAttribute("aria-invalid")).toBe("true");
    }
    /*
     * Both identifiers are required to EXIST before they are compared. Omitting
     * the alert's id and the group's `aria-describedby` leaves both reads
     * `null`, and `null === null` would report the message as associated with
     * the control while nothing connects them.
     */
    const messageId = screen.getByRole("alert").getAttribute("id");
    const describedBy = fieldsOf("fontStyle")
      .getByRole("group")
      .getAttribute("aria-describedby");
    expect(messageId).toBeTruthy();
    expect(describedBy).toBeTruthy();
    expect(describedBy).toBe(messageId);
  });

  it("does not submit the entry it is mounted inside", () => {
    /*
     * The builder mounts inside the entry's `<form>` — `inspector-panel.test`
     * states it, and guards the same hazard for Enter in a text field. A button
     * with no explicit `type` defaults to `submit` there, so clicking a style
     * option would SAVE THE WHOLE ENTRY as well as applying the style.
     *
     * Rendered under a form deliberately: every other case here mounts at the
     * document root, where a missing `type` costs nothing and the defect is
     * invisible. The host context is part of the behaviour.
     */
    const submitted = vi.fn((event: React.FormEvent) => event.preventDefault());
    register({ typography: true });
    const editor = editorFor(documentOf());
    render(
      <form onSubmit={submitted}>
        <StyleInspectorPanel editor={editor} />
      </form>
    );

    fireEvent.click(optionButton("italic"));

    expect(submitted).not.toHaveBeenCalled();
    // The positive control: the click still did its own job, so this does not
    // pass merely because nothing happened at all.
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
  });

  it("does not write anything when the field's LABEL is clicked", () => {
    /*
     * The defect this guards is a click that edits the document without the
     * author touching a control: a `<label>` with `htmlFor` forwards its click
     * to the named element, so naming a button there would press it — or clear
     * it, when already pressed. The group's id sits on a `div`, which is not
     * labelable, so the association is inert by construction.
     */
    const editor = mountWith("italic");

    fireEvent.click(fieldsOf("fontStyle").getByText("Font style"));

    expect(editor.applyAll).not.toHaveBeenCalled();
 * A per-side property drawn as the box it describes.
 *
 * Two things are asserted here that no CSS file can state: that the box is
 * drawn ONLY when the edited element's axes are known, and that each side is
 * marked with WHICH side it is so the stylesheet can place it by identity
 * rather than by counting siblings.
 *
 * The orientation is supplied rather than measured in most of these, because
 * jsdom computes neither `writing-mode` nor `direction` — which is the same
 * reason the panel treats an unreadable orientation as a reason to draw rows.
 * The last test does the measuring, through the wrapper that owns the canvas.
 */
describe("a per-side property is drawn as a box", () => {
  const LTR = { writingMode: "horizontal-tb", direction: "ltr" } as const;

  /** The Style panel with an orientation already resolved, or deliberately not. */
  function mountWithOrientation(
    orientation: { writingMode: string; direction: string } | undefined
  ) {
    register({ spacing: true });
    const editor = editorFor(documentOf());
    render(
      <StyleInspectorPanel
        editor={editor}
        {...(orientation === undefined ? {} : { sideOrientation: orientation })}
      />
    );
    return document.querySelector(
      '[data-property="padding"]'
    ) as HTMLElement | null;
  }

  it("marks each side with WHICH side it is, not with its position", () => {
    /*
     * The property the stylesheet places on. The heading, a form selector and
     * the notice for a withdrawn property are all siblings of the four sides,
     * so a rule counting elements moves every side the moment one appears.
     */
    const box = mountWithOrientation(LTR);

    expect(box?.getAttribute("data-sides")).toBe("logical");
    expect(
      Array.from(box?.querySelectorAll("[data-side]") ?? [], field =>
        field.getAttribute("data-side")
      )
    ).toEqual(["blockStart", "inlineStart", "inlineEnd", "blockEnd"]);
  });

  it("carries the EDITED ELEMENT's axes, so its grid resolves in them", () => {
    /*
     * Grid columns run along the inline axis, so putting the element's own
     * writing mode on the box is what makes column one the inline START edge in
     * a right-to-left page as well as a left-to-right one. Read from the style
     * attribute because that is the whole mechanism — there is no map from
     * logical side to physical edge anywhere to assert instead.
     */
    const box = mountWithOrientation({
      writingMode: "vertical-rl",
      direction: "rtl",
    });

    expect(box?.style.writingMode).toBe("vertical-rl");
    expect(box?.style.direction).toBe("rtl");
  });

  it("draws ROWS, not a box, when the element's axes are unknown", () => {
    /*
     * The whole reason the reading is allowed to fail. A box is a positional
     * claim — this control is the leading edge — and an unknown orientation
     * cannot support one. Four labelled rows name their side in words instead,
     * which is true whichever way the element runs.
     *
     * `undefined` here is the ordinary state, not an error: the canvas mounts
     * after styles load, and a block whose render returns a promise shows a
     * fallback first.
     */
    const box = mountWithOrientation(undefined);

    expect(box?.getAttribute("data-sides")).toBeNull();
    expect(box?.querySelectorAll("[data-side]").length).toBe(0);
    // The sides are still all there and still named — the fallback is a layout
    // change, never a control that goes missing.
    expect(
      within(box as HTMLElement).getByLabelText("Block start")
    ).toBeDefined();
    expect(
      within(box as HTMLElement).getByLabelText("Inline start")
    ).toBeDefined();
  });

  it("resolves the axes from the CANVAS, through the panel that owns it", () => {
    /*
     * The forwarding hop, and the only test here that measures rather than is
     * told. `StyleInspectorPanel` taking an orientation proves nothing about
     * `InspectorPanel` reading one, and that is the component the page-builder
     * plugin mounts.
     */
    const canvasRoot = document.createElement("div");
    const drawn = document.createElement("div");
    drawn.setAttribute("data-nx-node", "a");
    canvasRoot.append(drawn);
    document.body.append(canvasRoot);

    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(((
      element: Element,
      pseudo?: string | null
    ) =>
      element === drawn
        ? ({
            writingMode: "horizontal-tb",
            direction: "rtl",
          } as unknown as CSSStyleDeclaration)
        : real(element, pseudo)) as typeof window.getComputedStyle);

    register({ spacing: true });
    render(
      <InspectorPanel
        editor={editorFor(documentOf())}
        canvasRoot={canvasRoot}
      />
    );
    // The Inspector opens on Content, and the box lives in the Style tab.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    const box = document.querySelector(
      '[data-property="padding"]'
    ) as HTMLElement | null;
    expect(box?.getAttribute("data-sides")).toBe("logical");
    expect(box?.style.direction).toBe("rtl");  });
});
