// @vitest-environment jsdom

/**
 * Advanced › HTML, as an author reads it on a core container: the HTML tag
 * menu names each tag once, beside a plain name and its meaning, and the
 * closed menu reads the same; "Anchor (ID)" says what it is for; "CSS classes"
 * keeps the valid names and refuses each other one under the field with its
 * reason; "+ Add attribute" is a button, and `class` typed as an attribute is
 * sent to CSS classes.
 *
 * The editor is the real one (`useEditorState`), so what the panel writes is
 * what the page holds.
 *
 * @module inspector-advanced-html.test
 */
import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  findNode,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { useEditorState, type EditorState } from "../editor-state";
import { InspectorPanel } from "./inspector-panel";

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither.
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

beforeEach(() => registerBlocks(coreBlocks as never, { source: "core" }));
afterEach(() => {
  cleanup();
  clearBlocks();
  refuseWrites = 0;
});

function nodeOf(id: string, type: string, props = {}): BlockNode {
  const block = coreBlocks.find(each => each.name === type);
  if (block === undefined) throw new Error(`${type} is not a core block`);
  return { id, type, version: block.version, props } as BlockNode;
}

const PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    nodeOf("hero", "core/section", { as: "section" }),
    nodeOf("card", "core/card", { as: "div" }),
  ],
} as BlockDocument;

let editorRef: EditorState | null = null;
const editor = (): EditorState => editorRef!;
/** How many of the next writes the editor refuses, as a full page would. */
let refuseWrites = 0;

function Host(): React.JSX.Element {
  const state = useEditorState({ initialDocument: PAGE });
  editorRef = state;
  const refusing: EditorState = {
    ...state,
    apply: op => {
      if (refuseWrites > 0) {
        refuseWrites -= 1;
        return null;
      }
      return state.apply(op);
    },
  };
  return <InspectorPanel editor={refusing} />;
}

/** The panel on `id`'s Advanced tab, and its HTML section. */
function advancedOf(id: string): HTMLElement {
  render(<Host />);
  act(() => editor().select(id));
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Advanced" }));
  const advanced = screen.getByRole("tabpanel", { name: "Advanced" });
  // HTML starts closed on a block whose HTML holds nothing.
  const header = advanced.querySelector<HTMLElement>(
    '[data-section="html"] [data-slot="accordion-trigger"]'
  );
  if (header !== null && header.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(header);
  }
  return within(advanced).getByRole("region", { name: /^HTML/ });
}

const stored = (id: string): BlockNode | undefined =>
  findNode(editor().document.nodes, id);

/** How many times `part` appears in `text`. */
const timesIn = (text: string, part: string): number =>
  text.split(part).length - 1;

describe("the HTML tag menu", () => {
  it("is in Advanced › HTML, and the Section has no Content tab for it", () => {
    const html = advancedOf("hero");
    expect(
      within(html).getByRole("combobox", { name: "HTML tag" })
    ).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Content" })).toBeNull();
  });

  it("names each tag exactly once, after a plain name and its meaning", () => {
    const html = advancedOf("hero");
    fireEvent.click(within(html).getByRole("combobox", { name: "HTML tag" }));
    const options = screen.getAllByRole("option");
    const tags = ["section", "header", "footer", "main"];
    expect(options).toHaveLength(tags.length);
    options.forEach((option, index) => {
      const text = option.textContent ?? "";
      const tag = tags[index]!;
      expect(timesIn(text, `<${tag}>`), text).toBe(1);
      // The tag, in monospace, after the words; never "Section section".
      expect(option.querySelector("code")?.textContent).toBe(`<${tag}>`);
      expect(text).toMatch(/^[A-Z][^—]* — [a-z].*<[a-z]+>$/);
    });
    expect(options[0]?.textContent).toBe(
      "Section — a themed part of the page<section>"
    );
  });

  it("reads the same on the closed menu", () => {
    const html = advancedOf("hero");
    const closed = within(html).getByRole("combobox", { name: "HTML tag" });
    expect(closed.textContent).toContain(
      "Section — a themed part of the page<section>"
    );
    expect(timesIn(closed.textContent ?? "", "<section>")).toBe(1);
  });
});

describe("Anchor (ID)", () => {
  it("is named for what it does, with the hint", () => {
    const html = advancedOf("hero");
    expect(within(html).getByLabelText("Anchor (ID)")).toBeTruthy();
    expect(
      within(html).getByText("Lets a link jump here: #your-id")
    ).toBeTruthy();
    expect(within(html).queryByLabelText("CSS id")).toBeNull();
  });
});

describe("CSS classes", () => {
  /** Types `text` into the field and finishes it, as Enter does. */
  function typeClasses(html: HTMLElement, text: string): HTMLInputElement {
    const field = within(html).getByLabelText(
      "CSS classes"
    ) as HTMLInputElement;
    fireEvent.change(field, { target: { value: text } });
    fireEvent.keyDown(field, { key: "Enter" });
    return field;
  }

  it("sits under the anchor and above the attributes", () => {
    const html = advancedOf("hero");
    const order = [
      within(html).getByLabelText("Anchor (ID)"),
      within(html).getByLabelText("CSS classes"),
      within(html).getByRole("button", { name: "Add attribute" }),
    ];
    for (let at = 1; at < order.length; at += 1) {
      expect(
        order[at - 1]!.compareDocumentPosition(order[at]!) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  });

  it("writes the names it keeps, and refuses each other one under the field", () => {
    const html = advancedOf("hero");
    const field = typeClasses(html, "promo 2col nx-box");
    expect(stored("hero")?.cssClasses).toBe("promo");
    // The author's text stays, so the refused names can be fixed.
    expect(field.value).toBe("promo 2col nx-box");
    const refused = within(
      within(html).getByRole("list", { name: "Names not added" })
    ).getAllByRole("listitem");
    expect(refused.map(each => each.textContent)).toEqual([
      '"2col" starts with a digit, which a class name can\'t.',
      '"nx-box" starts with "nx-", which Nextly keeps for its own classes.',
    ]);
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });

  it.each([
    [".promo", '".promo" starts with ".": write the name without it.'],
    ["#promo", '"#promo" starts with "#": write the name without it.'],
    [
      "NX-promo",
      '"NX-promo" starts with "nx-", which Nextly keeps for its own classes.',
    ],
    [
      "a/b",
      '"a/b" holds "/", which a class name can\'t. Use letters, digits, "-" and "_".',
    ],
  ])("refuses %s with its reason, keeping the valid name", (name, reason) => {
    const html = advancedOf("hero");
    typeClasses(html, `keep ${name}`);
    expect(stored("hero")?.cssClasses).toBe("keep");
    expect(within(html).getByText(reason)).toBeTruthy();
  });

  it("judges a name once it is finished, not halfway through", () => {
    const html = advancedOf("hero");
    const field = within(html).getByLabelText("CSS classes");
    // "nx" is on its way to something; the finished "2col " is not.
    fireEvent.change(field, { target: { value: "2col nx" } });
    expect(
      within(html).getByText(
        '"2col" starts with a digit, which a class name can\'t.'
      )
    ).toBeTruthy();
    expect(within(html).queryByText(/"nx"/)).toBeNull();
    // Nothing is written while typing.
    expect(stored("hero")?.cssClasses).toBeUndefined();
  });

  it("removes the field from the block when emptied", () => {
    const html = advancedOf("hero");
    typeClasses(html, "promo");
    expect(stored("hero")?.cssClasses).toBe("promo");
    typeClasses(html, "  ");
    expect(stored("hero")).not.toHaveProperty("cssClasses");
  });

  it("is saved when the author leaves for Style", () => {
    const html = advancedOf("hero");
    const field = within(html).getByLabelText("CSS classes");
    act(() => (field as HTMLInputElement).focus());
    fireEvent.change(field, { target: { value: "promo wide" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    expect(stored("hero")?.cssClasses).toBe("promo wide");
  });

  it("writes a refused save again when the author finishes the field again", () => {
    const html = advancedOf("hero");
    refuseWrites = 1;
    const field = typeClasses(html, "promo");
    expect(stored("hero")?.cssClasses).toBeUndefined();
    expect(within(html).getByRole("alert").textContent).toContain(
      "could not be saved"
    );
    // Nothing typed since: finishing the field again tries the save again.
    fireEvent.keyDown(field, { key: "Enter" });
    expect(stored("hero")?.cssClasses).toBe("promo");
    expect(within(html).queryByRole("alert")).toBeNull();
  });

  it("drops a refused save's message once the field is put back as stored", () => {
    const html = advancedOf("hero");
    refuseWrites = 1;
    typeClasses(html, "promo");
    expect(within(html).getByRole("alert")).toBeTruthy();
    // Cleared back to what the block holds: nothing is pending, so nothing
    // failed.
    typeClasses(html, "");
    expect(within(html).queryByRole("alert")).toBeNull();
    expect(stored("hero")).not.toHaveProperty("cssClasses");
  });

  it("shows what an undo puts back", async () => {
    const html = advancedOf("hero");
    typeClasses(html, "promo");
    await act(async () => {
      await editor().undo();
    });
    expect(
      (within(html).getByLabelText("CSS classes") as HTMLInputElement).value
    ).toBe("");
  });
});

describe("Attributes", () => {
  it('are added with a "+ Add attribute" button', () => {
    const html = advancedOf("card");
    const add = within(html).getByRole("button", { name: "Add attribute" });
    expect(add.tagName).toBe("BUTTON");
    expect(add.querySelector("svg.lucide-plus")).not.toBeNull();
    // Drawn as a button, with an edge, not as indented text.
    expect(add.getAttribute("data-slot")).toBe("button.outline");
  });

  it("send a class to CSS classes", () => {
    const html = advancedOf("card");
    fireEvent.click(
      within(html).getByRole("button", { name: "Add attribute" })
    );
    const name = within(html).getByLabelText("Name of attribute 1");
    fireEvent.change(name, { target: { value: "class" } });
    fireEvent.blur(name);
    expect(within(html).getByText("Use CSS classes above.")).toBeTruthy();
    expect(stored("card")).not.toHaveProperty("attributes");
  });
});
