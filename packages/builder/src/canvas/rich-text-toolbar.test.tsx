// @vitest-environment jsdom
/**
 * A Rich text edited on the canvas, with the floating format bar: clicking it
 * hands its passage to the shared editor (the same one every rich-text field
 * in Nextly uses), the bar offers "B", "I", "Link", "H2", "H3", bullets,
 * numbers, quote and "Turn into", and each button's change is what the page
 * stores once the edit is finished.
 *
 * The editor is a stand-in here that keeps a passage and changes it as each
 * verb is pressed, so what is asserted is the builder's half: the bar a Rich
 * text is served, which verb each button presses, and that the passage the
 * editor holds is what is written. What each verb does to a real passage is
 * asserted against Lexical in the admin (`inline-editor-blocks.test.ts`).
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyOp,
  clearBlocks,
  findNode,
  registerBlocks,
  TEXT_FORMAT,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { coreBlocks } from "@nextlyhq/blocks-react/blocks";

import {
  BlockActionsContext,
  type BlockActions,
} from "../block-actions-context";
import type { EditorState } from "../editor-state";
import { CANVAS_ROOT_CLASS } from "../shell-state";

import { FORMAT_BAR_WORDS, FormatBar } from "./format-bar";
import {
  formatBar,
  RICH_TEXT_FORMAT_ACTIONS,
  type FormatBlockAction,
  type FormatSelection,
} from "./format-bar-state";
import { useInlineEditing } from "./use-inline-editing";

/** The core blocks, so the Rich text is Nextly's own and turns into a Text or Heading. */
function registerRichText(): void {
  registerBlocks(coreBlocks as never, { source: "rich-text-toolbar-test" });
}

afterEach(() => {
  formatBar.close(formatBar.get().target?.element ?? document.body);
  cleanup();
  clearBlocks();
  document.body.innerHTML = "";
});

interface Passage {
  root: { type: "root"; children: Record<string, unknown>[] };
}

const words = (text: string, format = 0) => ({ type: "text", text, format });

const paragraphOf = (text: string): Passage => ({
  root: {
    type: "root",
    children: [{ type: "paragraph", children: [words(text)] }],
  },
});

function documentWith(content: unknown): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "r",
        type: "core/rich-text",
        version: 1,
        props: { content },
      } as BlockNode,
    ],
  } as BlockDocument;
}

/** The block a verb makes, as the stored passage spells it. */
function storedBlock(kind: FormatBlockAction, text: string) {
  const children = [words(text)];
  if (kind === "h2" || kind === "h3")
    return { type: "heading", tag: kind, children };
  if (kind === "quote") return { type: "quote", children };
  return {
    type: "list",
    listType: kind,
    children: [{ type: "listitem", children }],
  };
}

/**
 * A stand-in for the shared editor's session on one passage of one word: it
 * keeps the passage and changes it as a verb is pressed, and tells the bar
 * what the selection holds, as the editor does.
 */
function standInSession(onSelection: (state: FormatSelection) => void) {
  let passage = paragraphOf("Hello");
  let block: FormatSelection["block"] = "paragraph";
  const first = (): Record<string, unknown> =>
    passage.root.children[0] as Record<string, unknown>;
  const selection = (): FormatSelection => ({
    collapsed: false,
    bold: false,
    italic: false,
    link: null,
    block,
  });
  const tell = () => onSelection(selection());
  return {
    focus: vi.fn(),
    read: vi.fn(() => JSON.parse(JSON.stringify(passage)) as unknown),
    detach: vi.fn(),
    hold: vi.fn(),
    selection: vi.fn(selection),
    format: vi.fn((mark: "bold" | "italic") => {
      const text = first().children as Record<string, unknown>[];
      const leaf = text[0] as { format: number };
      leaf.format |= mark === "bold" ? TEXT_FORMAT.BOLD : TEXT_FORMAT.ITALIC;
      tell();
    }),
    link: vi.fn((url: string | null) => {
      const node = first();
      node.children = [
        { type: "link", url, children: node.children as unknown[] },
      ];
      tell();
    }),
    block: vi.fn((kind: FormatBlockAction) => {
      block = kind;
      passage = {
        root: { type: "root", children: [storedBlock(kind, "Hello")] },
      };
      tell();
    }),
  };
}

/**
 * Open the Rich text on the canvas by a click, with the bar drawn in the
 * canvas's overlay, and answer what the edit's write stores.
 */
async function openRichText(turnIntoIn?: BlockActions["turnIntoIn"]) {
  registerRichText();
  document.body.innerHTML = `<div class="${CANVAS_ROOT_CLASS}"><div data-nx-node="r"><div data-nx-prop="content"><p>Hello</p></div></div><div data-layer></div></div>`;
  let doc = documentWith(paragraphOf("Hello"));
  const written: BlockDocument[] = [];
  const editor = {
    get document() {
      return doc;
    },
    selectedId: "r",
    limits: undefined,
    apply: vi.fn((op: unknown) => {
      doc = applyOp(doc, op as never).document;
      written.push(doc);
      return doc;
    }),
  } as unknown as EditorState;
  let live: ReturnType<typeof standInSession> | undefined;
  const attach = vi.fn(
    (
      _element: HTMLElement,
      _value: unknown,
      options?: { onSelection?: (state: FormatSelection) => void }
    ) => {
      live = standInSession(state => options?.onSelection?.(state));
      return { status: "attached" as const, session: live };
    }
  );
  const load = vi.fn(() => Promise.resolve({ attach }));
  const hook = renderHook(() => useInlineEditing(editor, load as never));
  const element = document.querySelector<HTMLElement>("[data-nx-prop]");
  await act(async () => {
    hook.result.current.onDoubleClick({ target: element });
  });
  const layer = document.querySelector<HTMLElement>("[data-layer]");
  render(
    <BlockActionsContext.Provider
      value={
        turnIntoIn === undefined
          ? null
          : ({ turnIntoIn } as unknown as BlockActions)
      }
    >
      <FormatBar />
    </BlockActionsContext.Provider>,
    { container: layer ?? document.body }
  );
  act(() => {
    live?.selection && formatBar.selected(live.selection());
  });
  /** Finish the edit, as leaving the passage does, and answer what it stored. */
  const finish = (): unknown => {
    act(() => {
      element?.dispatchEvent(new FocusEvent("blur"));
    });
    const stored = written.at(-1);
    return stored === undefined
      ? undefined
      : findNode(stored.nodes, "r")?.props.content;
  };
  if (live === undefined) throw new Error("the passage was not opened");
  return { attach, element, finish, session: live };
}

const press = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));

describe("the bar a Rich text is offered", () => {
  it("is served with B, I, Link, H2, H3, bullets, numbers, quote and Turn into", async () => {
    const { attach, element } = await openRichText();
    expect(attach).toHaveBeenCalledTimes(1);
    expect(formatBar.get().target?.element).toBe(element);
    expect(formatBar.get().target?.actions).toEqual(RICH_TEXT_FORMAT_ACTIONS);
    expect(RICH_TEXT_FORMAT_ACTIONS).toEqual([
      "bold",
      "italic",
      "link",
      "h2",
      "h3",
      "bullet",
      "number",
      "quote",
      "turnInto",
    ]);
  });

  it("draws each of them, in that order, under the words they say", async () => {
    const turnIntoIn = { choices: vi.fn(() => []), run: vi.fn() };
    await openRichText(turnIntoIn as never);
    const bar = screen.getByRole("toolbar", { name: FORMAT_BAR_WORDS.bar });
    const said = [...bar.querySelectorAll("button")].map(button => [
      button.textContent,
      button.getAttribute("aria-label") ?? button.textContent,
    ]);
    expect(said).toEqual([
      ["B", "Bold"],
      ["I", "Italic"],
      ["Link", "Link"],
      ["H2", "Heading 2"],
      ["H3", "Heading 3"],
      ["", "Bullets"],
      ["", "Numbers"],
      ["", "Quote"],
      ["Turn into", "Turn into"],
    ]);
  });
});

describe("each button, and what the page stores", () => {
  it("B stores the words bold", async () => {
    const { finish } = await openRichText();
    press("Bold");
    expect(finish()).toEqual({
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [words("Hello", TEXT_FORMAT.BOLD)] },
        ],
      },
    });
  });

  it("I stores the words italic", async () => {
    const { finish } = await openRichText();
    press("Italic");
    expect(finish()).toEqual({
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [words("Hello", TEXT_FORMAT.ITALIC)] },
        ],
      },
    });
  });

  it("Link stores the words as a link to the address given", async () => {
    const { finish, session } = await openRichText();
    press("Link");
    fireEvent.change(
      screen.getByRole("textbox", { name: FORMAT_BAR_WORDS.address }),
      { target: { value: "https://example.com" } }
    );
    press(FORMAT_BAR_WORDS.apply);
    expect(session.link).toHaveBeenCalledWith("https://example.com", {
      newTab: false,
    });
    expect(finish()).toEqual({
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              {
                type: "link",
                url: "https://example.com",
                children: [words("Hello")],
              },
            ],
          },
        ],
      },
    });
  });

  for (const [name, kind] of [
    ["Heading 2", "h2"],
    ["Heading 3", "h3"],
    ["Bullets", "bullet"],
    ["Numbers", "number"],
    ["Quote", "quote"],
  ] as const) {
    it(`${name} makes the caret's block ${kind}, says it is on, and stores it`, async () => {
      const { finish, session } = await openRichText();
      const button = screen.getByRole("button", { name });
      expect(button.getAttribute("aria-pressed")).toBe("false");
      press(name);
      expect(session.block).toHaveBeenCalledWith(kind);
      expect(
        screen.getByRole("button", { name }).getAttribute("aria-pressed")
      ).toBe("true");
      expect(finish()).toEqual({
        root: { type: "root", children: [storedBlock(kind, "Hello")] },
      });
    });
  }

  it("Turn into opens the block's choices", async () => {
    const turnIntoIn = {
      choices: vi.fn(() => [
        { to: "core/heading", name: "Heading", enabled: true },
      ]),
      run: vi.fn(),
    };
    await openRichText(turnIntoIn as never);
    press("Turn into");
    expect(screen.getByRole("menu", { name: "Turn into" })).not.toBeNull();
    expect(turnIntoIn.choices).toHaveBeenCalledWith(expect.anything(), "r");
  });

  it("keeps the caret in the words when a button is pressed", async () => {
    await openRichText();
    const button = screen.getByRole("button", { name: "Heading 2" });
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });
});
