// @vitest-environment jsdom
/**
 * A Text edited on the canvas: its one-paragraph value is handed to the shared
 * rich-text editor held to one paragraph, what is written goes through the
 * same restriction the page is drawn by, and the format bar is offered its
 * words.
 *
 * The editor is a fake here, so what is asserted is the builder's half: which
 * editor a Text is routed to, what it is attached with, what a finished edit
 * writes, and the keys the passage answers. The editor's own half (Enter as a
 * line break, a paste restricted) is asserted against Lexical in the admin.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearBlocks,
  registerBlocks,
  TEXT_FORMAT,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { EditorState } from "../editor-state";

import { formatBar } from "./format-bar-state";
import { inlinePropKind } from "./inline-prop-kind";
import { richInlineTarget, richInlineTextOp } from "./inline-rich-text";
import { useInlineEditing } from "./use-inline-editing";

/** A Text, declared as `core/text` declares it. */
function registerText(): void {
  registerBlocks(
    [
      {
        version: 1,
        description: "A paragraph.",
        example: { props: {} },
        render: () => null,
        name: "acme/text",
        props: {
          text: {
            type: "textarea",
            inline: true,
            role: "content",
            oneParagraph: true,
          },
        },
      },
    ] as never,
    { source: "text-inline-marks-test" }
  );
}

afterEach(() => {
  clearBlocks();
  document.body.innerHTML = "";
  formatBar.close(formatBar.get().target?.element ?? document.body);
});

const paragraph = (...children: unknown[]) => ({
  root: { type: "root", children: [{ type: "paragraph", children }] },
});

const words = (text: string, format = 0) => ({ type: "text", text, format });

function documentWith(text: unknown): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "t", type: "acme/text", version: 1, props: { text } } as BlockNode,
    ],
  } as BlockDocument;
}

describe("which editor a Text is handed to", () => {
  it("is a one-paragraph line, not a plain one and not a passage", () => {
    expect(
      inlinePropKind({ type: "textarea", inline: true, oneParagraph: true })
    ).toBe("line");
    expect(inlinePropKind({ type: "textarea", inline: true })).toBe("plain");
    expect(inlinePropKind({ type: "richText", inline: true })).toBe("rich");
  });

  it("opens a string an older Text stored as its words and line breaks", () => {
    registerText();
    const target = richInlineTarget(documentWith("One\nTwo"), "t", "text");
    expect(target?.oneParagraph).toBe(true);
    expect(target?.value).toEqual(
      paragraph(words("One"), { type: "linebreak" }, words("Two"))
    );
  });
});

describe("what a finished Text edit writes", () => {
  it("writes the restricted paragraph, never a heading or a list the editor held", () => {
    registerText();
    const doc = documentWith("Old");
    const before = paragraph(words("Old"));
    const next = {
      root: {
        type: "root",
        children: [
          { type: "heading", tag: "h2", children: [words("Pasted")] },
          {
            type: "list",
            children: [
              {
                type: "listitem",
                children: [words("Item", TEXT_FORMAT.UNDERLINE)],
              },
            ],
          },
        ],
      },
    };
    const op = richInlineTextOp(doc, "t", "text", next, before, "Old");
    expect(op).toEqual({
      kind: "update",
      id: "t",
      patch: {
        props: {
          text: paragraph(
            words("Pasted"),
            { type: "linebreak" },
            words("Item")
          ),
        },
      },
    });
  });

  it("writes nothing for an edit that changed nothing but the editor's own fields", () => {
    registerText();
    const doc = documentWith("Same");
    const before = {
      root: {
        type: "root",
        direction: null,
        children: [
          {
            type: "paragraph",
            direction: null,
            textFormat: 0,
            children: [
              { ...words("Same"), detail: 0, mode: "normal", style: "" },
            ],
          },
        ],
      },
    };
    const next = JSON.parse(JSON.stringify(before)) as unknown;
    next && ((next as { root: { indent?: number } }).root.indent = 0);
    expect(richInlineTextOp(doc, "t", "text", next, before, "Same")).toBeNull();
  });
});

/** A fake session with the format bar's verbs. */
function session() {
  return {
    focus: vi.fn(),
    read: vi.fn(() => paragraph(words("Hello"))),
    detach: vi.fn(),
    hold: vi.fn(),
    format: vi.fn(),
    link: vi.fn(),
    selection: vi.fn(() => ({
      collapsed: false,
      bold: false,
      italic: false,
      link: null,
    })),
  };
}

function editorFor(doc: BlockDocument): EditorState {
  return {
    document: doc,
    selectedId: "t",
    apply: vi.fn(() => doc),
  } as unknown as EditorState;
}

async function openText(options: { live?: ReturnType<typeof session> } = {}) {
  registerText();
  document.body.innerHTML = `<div data-nx-node="t"><p data-nx-prop="text">Hello</p></div>`;
  const live = options.live ?? session();
  const attach = vi.fn(
    (_element: HTMLElement, _value: unknown, _options?: unknown) => ({
      status: "attached" as const,
      session: live,
    })
  );
  const load = vi.fn(() => Promise.resolve({ attach }));
  const editor = editorFor(documentWith("Hello"));
  const hook = renderHook(() => useInlineEditing(editor, load as never));
  const element = document.querySelector<HTMLElement>("[data-nx-prop]");
  await act(async () => {
    hook.result.current.onDoubleClick({ target: element });
  });
  return { hook, attach, live, element, editor };
}

describe("opening a Text on the canvas", () => {
  it("attaches the shared editor held to one paragraph, and serves the format bar", async () => {
    const { attach, element } = await openText();
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0]?.[1]).toEqual(paragraph(words("Hello")));
    const options = attach.mock.calls[0]?.[2] as {
      paragraph?: { restrict: (value: unknown) => { dropped: boolean } };
    };
    // The engine's own restriction, so the editor holds what is saved.
    expect(
      options.paragraph?.restrict({
        root: { type: "root", children: [{ type: "heading", children: [] }] },
      }).dropped
    ).toBe(true);
    expect(formatBar.get().target?.element).toBe(element);
    expect(formatBar.get().target?.actions).toEqual([
      "bold",
      "italic",
      "link",
      "turnInto",
    ]);
  });

  it("opens the address field on ⌘K when words are selected, and keeps it from the page", async () => {
    const { element } = await openText();
    const outer = vi.fn();
    document.body.addEventListener("keydown", outer);
    const press = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      element?.dispatchEvent(press);
    });
    expect(formatBar.get().linking).toBe(true);
    expect(press.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
  });

  it("does the same on Ctrl+K", async () => {
    const { element } = await openText();
    act(() => {
      element?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })
      );
    });
    expect(formatBar.get().linking).toBe(true);
  });

  it("keeps ⌘B and ⌘I for the editor, out of the page's own shortcuts", async () => {
    const { element } = await openText();
    const outer = vi.fn();
    document.body.addEventListener("keydown", outer);
    for (const key of ["b", "i"]) {
      act(() => {
        element?.dispatchEvent(
          new KeyboardEvent("keydown", { key, metaKey: true, bubbles: true })
        );
      });
    }
    expect(outer).not.toHaveBeenCalled();
  });

  it("asks the bar to take the focus on Alt+F10", async () => {
    const { element } = await openText();
    const asked = formatBar.get().focusRequest;
    act(() => {
      element?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F10",
          altKey: true,
          bubbles: true,
        })
      );
    });
    expect(formatBar.get().focusRequest).toBe(asked + 1);
  });

  it("is not finished by a blur to the bar, and is finished by any other", async () => {
    const { element, live } = await openText({
      live: {
        ...session(),
        read: vi.fn(() => paragraph(words("Hello"))),
      },
    });
    formatBar.setHoldsFocus(true);
    act(() => {
      element?.dispatchEvent(new FocusEvent("blur"));
    });
    expect(live.detach).not.toHaveBeenCalled();
    expect(formatBar.get().target).not.toBeNull();

    formatBar.setHoldsFocus(false);
    act(() => {
      element?.dispatchEvent(new FocusEvent("blur"));
    });
    expect(live.detach).toHaveBeenCalled();
    expect(formatBar.get().target).toBeNull();
  });
});
