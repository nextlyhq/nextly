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

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(editor.apply.mock.calls[0]?.[0]).toEqual({
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

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(editor.apply.mock.calls[0]?.[0]).toMatchObject({
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

  it("stores only the numeric grammar CSS accepts, leaving other spellings alone", () => {
    // `Number` reads spellings CSS does not: `0x10` is 16, `0b10` is 2, `0o10`
    // is 8. Converting those would store a number the author never typed and
    // pass validation on the way through.
    const editor = mount({ effects: true });
    const field = screen.getByLabelText("Opacity");

    fireEvent.change(field, { target: { value: "0x10" } });
    fireEvent.blur(field);

    // Left as text, so the catalog refuses it and says why.
    expect(editor.apply).not.toHaveBeenCalled();
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
    expect(editor.apply).toHaveBeenCalledTimes(1);
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

    expect(editor.apply).not.toHaveBeenCalled();
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
    expect(editor.apply).not.toHaveBeenCalled();
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

    expect(editor.apply).not.toHaveBeenCalled();
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
    expect(editor.apply).not.toHaveBeenCalled();

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

    expect(editor.apply).toHaveBeenCalledTimes(1);
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
    expect(editor.apply).not.toHaveBeenCalled();
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

    expect(editor.apply).toHaveBeenCalledTimes(1);
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

    expect(editor.apply).toHaveBeenCalledTimes(1);
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

    expect(editor.apply).not.toHaveBeenCalled();
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

    expect(editor.apply).toHaveBeenCalledTimes(1);
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

    expect(editor.apply).toHaveBeenCalledTimes(1);
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

    expect(editor.apply).toHaveBeenCalledTimes(1);
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

    expect(editor.apply).not.toHaveBeenCalled();
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
