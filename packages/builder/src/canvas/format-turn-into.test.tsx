// @vitest-environment jsdom
/**
 * The format bar's "Turn into", for a Text being edited on the canvas: its
 * choices are about the words as typed, and choosing one writes those words
 * first and then turns the block, so nothing typed is lost and the turn is
 * its own undo step.
 *
 * The shared editor is a fake, as in the Text's own canvas tests; the editor
 * state applies ops for real, so what is asserted is what the page becomes.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyOp,
  clearBlocks,
  registerBlocks,
  TEXT_FORMAT,
  type BlockDocument,
  type BlockNode,
  type BuilderOp,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";

import type { EditorState } from "../editor-state";
import { runTurnInto, turnIntoOffers } from "../turn-into-verb";

import { formatBar } from "./format-bar-state";
import { useInlineEditing } from "./use-inline-editing";

afterEach(() => {
  clearBlocks();
  document.body.innerHTML = "";
  formatBar.close(formatBar.get().target?.element ?? document.body);
});

const words = (text: string, format = 0) => ({ type: "text", text, format });
const paragraph = (...children: unknown[]) => ({
  root: { type: "root", children: [{ type: "paragraph", children }] },
});

function pageOf(node: BlockNode): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes: [node] } as BlockDocument;
}

/** An editor state that applies what it is handed, in order. */
function liveEditor(start: BlockDocument) {
  const applied: BuilderOp[] = [];
  const editor = {
    document: start,
    selectedId: "t",
    lockRefusalFor: () => undefined,
    apply: vi.fn((op: BuilderOp) => {
      applied.push(op);
      editor.document = applyOp(editor.document, op).document;
      return editor.document;
    }),
  };
  return { editor: editor as unknown as EditorState, applied };
}

/**
 * A Text on the canvas, opened on its stored "Hello", then its words typed as
 * `typed`.
 */
async function openText(type: string, typed: unknown, version = 2) {
  let words_: unknown = paragraph(words("Hello"));
  document.body.innerHTML = `<div data-nx-node="t"><p data-nx-prop="text">Hello</p></div>`;
  const live = {
    focus: vi.fn(),
    read: vi.fn(() => words_),
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
  const attach = vi.fn(() => ({ status: "attached" as const, session: live }));
  const load = vi.fn(() => Promise.resolve({ attach }));
  const stored = pageOf({
    id: "t",
    type,
    version,
    props: { text: paragraph(words("Hello")) },
  });
  const { editor, applied } = liveEditor(stored);
  const hook = renderHook(() => useInlineEditing(editor, load as never));
  const element = document.querySelector<HTMLElement>("[data-nx-prop]");
  await act(async () => {
    hook.result.current.onDoubleClick({ target: element });
  });
  words_ = typed;
  return { editor, applied };
}

const BOLD_HI = paragraph(words("Hi", TEXT_FORMAT.BOLD));

describe("the format bar's Turn into, for a Text", () => {
  it("is served, judged on the page as the words are typed", async () => {
    registerBlocks(coreBlocks as never, { source: "core" });
    await openText("core/text", BOLD_HI);
    const turnInto = formatBar.get().target?.turnInto;
    expect(turnInto?.nodeId).toBe("t");
    const typed = turnInto?.typedPage();
    // The stored words are "Hello"; the page judged holds the words typed.
    expect(typed?.nodes[0]?.props.text).toEqual(BOLD_HI);
    // So a choice says what it removes from those words.
    const choices = turnIntoOffers(typed as BlockDocument, "t");
    expect(choices.map(choice => [choice.name, choice.note])).toEqual([
      ["Rich text", undefined],
      ["Heading", "Bold and links are removed"],
    ]);
  });

  it("finishes by writing the words typed, and the turn after it is a step of its own", async () => {
    registerBlocks(coreBlocks as never, { source: "core" });
    const { editor, applied } = await openText("core/text", BOLD_HI);
    let page: BlockDocument | null = null;
    act(() => {
      page = formatBar.get().target?.turnInto?.finish() ?? null;
    });
    expect(applied.map(op => op.kind)).toEqual(["update"]);
    expect(page).toBe(editor.document);
    // The edit is finished: the bar serves nothing.
    expect(formatBar.get().target).toBeNull();
    runTurnInto(editor, "t", "core/heading", () => undefined);
    expect(applied.map(op => op.kind)).toEqual(["update", "turnInto"]);
    expect(editor.document.nodes[0]).toMatchObject({
      id: "t",
      type: "core/heading",
      props: { text: "Hi", level: "h2" },
    });
  });

  it("is not served for a block that turns into nothing", async () => {
    registerBlocks(
      [
        {
          name: "acme/caption",
          version: 1,
          description: "A caption.",
          example: { props: {} },
          render: () => null,
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
      { source: "format-turn-into-test" }
    );
    await openText("acme/caption", BOLD_HI, 1);
    expect(formatBar.get().target).not.toBeNull();
    expect(formatBar.get().target?.turnInto).toBeUndefined();
  });
});
