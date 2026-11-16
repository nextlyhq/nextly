// @vitest-environment jsdom

/**
 * The lock question is asked when an author can act on its answer, and each
 * answer is kept for the document version it was asked of.
 *
 * Whether a slot's lock allows an edit is answered by trying the edit on a
 * copy of the page. Selecting a block asks it of nothing: the toolbar and the
 * keyboard layer decide what they show from the cheap rules alone. Opening a
 * menu asks it of the verbs the menu holds, and pressing a verb asks it of
 * that verb, and every surface reads the one answer the editor keeps for that
 * version of the page.
 *
 * The editor is the real one (`useEditorState`), with a block whose slot is
 * locked, so each refusal here is the lock's own. Trial edits are counted at
 * the op layer the lock question tries them with, passed through.
 *
 * @module lock-answers-on-demand.test
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { ShortcutProvider } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import * as React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const trials = vi.hoisted(() => ({ count: 0 }));

vi.mock("./op-vocabulary", async importOriginal => {
  const real = await importOriginal<typeof import("./op-vocabulary")>();
  return {
    ...real,
    applyOps: (...args: Parameters<typeof real.applyOps>) => {
      trials.count += 1;
      return real.applyOps(...args);
    },
  };
});

import { BlockContextMenu } from "./block-context-menu";
import { BlockToolbar } from "./block-toolbar";
import { Canvas } from "./canvas";
import { useEditorState, type EditorState } from "./editor-state";
import { BlockKeyboardActions } from "./keyboard-actions";
import { lockRefusalWording } from "./lock-refusal";
import type { BuilderOp } from "./op-vocabulary";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
};

beforeAll(() => {
  registerBlocks(
    [
      {
        ...base,
        name: "acme/headline",
        editor: { label: "Headline" },
        props: { text: { type: "text", role: "content" } },
        defaultProps: { text: "Title" },
        render: () => React.createElement("p", null, "headline"),
      },
      {
        ...base,
        name: "acme/fixed-row",
        editor: { label: "Fixed row" },
        slots: {
          items: { defaultBlock: [{ type: "acme/headline" }], lock: "all" },
        },
        render: ({
          renderSlot,
        }: {
          renderSlot: (name: string) => React.ReactNode;
        }) => React.createElement("div", null, renderSlot("items")),
      },
    ] as never,
    { source: "lock-answers-on-demand-test" }
  );
});

afterAll(clearBlocks);
afterEach(cleanup);

function headline(id: string): BlockNode {
  return { id, type: "acme/headline", version: 1, props: { text: "Title" } };
}

/** A row whose slot is locked to the one headline it holds, and a headline. */
const PAGE: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "row",
      type: "acme/fixed-row",
      version: 1,
      props: {},
      slots: { items: [headline("held")] },
    },
    headline("free"),
  ],
} as BlockDocument;

/** Removing the held headline: the edit the row's lock refuses. */
const REMOVE_HELD: readonly BuilderOp[] = [{ kind: "remove", id: "held" }];

/** Whether a recorded ask was about removing the held headline. */
function asksRemoveHeld(): boolean {
  return asked.some(ops =>
    ops.some(op => op.kind === "remove" && op.id === "held")
  );
}

/** The sentence every surface says the row's lock refuses an edit with. */
function lockedSentence(editor: EditorState): string {
  const found = editor.lockRefusalFor(REMOVE_HELD);
  if (found === undefined) throw new Error("the row's lock refuses nothing");
  return lockRefusalWording(found).headline;
}

describe("the editor keeps each lock answer for its document version", () => {
  it("tries an edit once for two asks on one version, and again on a new version", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: PAGE })
    );
    trials.count = 0;
    const first = result.current.lockRefusalFor(REMOVE_HELD);
    const second = result.current.lockRefusalFor(REMOVE_HELD);
    // The control: the lock refuses it, so the answer is a real one.
    expect(first?.code).toBe("locked-slot-altered");
    expect(second).toEqual(first);
    expect(trials.count).toBe(1);

    act(() => {
      result.current.apply({
        kind: "insert",
        node: headline("added"),
        at: { index: 2 },
      });
    });
    trials.count = 0;
    expect(result.current.lockRefusalFor(REMOVE_HELD)?.code).toBe(
      "locked-slot-altered"
    );
    expect(trials.count).toBe(1);
  });
});

let editorRef: EditorState | null = null;
let asked: BuilderOp[][] = [];

function editor(): EditorState {
  if (editorRef === null) throw new Error("no editor rendered");
  return editorRef;
}

/**
 * The editor with its toolbar, keyboard layer and context menu around a real
 * canvas, every lock question it is asked recorded and passed on.
 */
function Host(): React.JSX.Element {
  const state = useEditorState({ initialDocument: PAGE });
  const recording = React.useMemo<EditorState>(
    () => ({
      ...state,
      lockRefusalFor: ops => {
        asked.push([...ops]);
        return state.lockRefusalFor(ops);
      },
    }),
    [state]
  );
  editorRef = recording;
  return (
    <ShortcutProvider>
      <BlockKeyboardActions
        onSaveAsPattern={() => undefined}
        editor={recording}
      >
        <BlockContextMenu editor={recording}>
          <Canvas
            document={recording.document}
            siteStyles={{ css: "", classes: {} } as never}
            selectedId={recording.selectedId}
            onSelect={recording.select}
            overlay={<BlockToolbar editor={recording} />}
          />
        </BlockContextMenu>
      </BlockKeyboardActions>
    </ShortcutProvider>
  );
}

function canvasBlock(id: string): Element {
  const element = document.querySelector(`[${NODE_ID_ATTRIBUTE}="${id}"]`);
  if (element === null) throw new Error(`block ${id} is not drawn`);
  return element;
}

describe("the lock is asked when the author can act on its answer", () => {
  it("selecting a block asks the lock nothing", () => {
    render(<Host />);
    act(() => editor().select("free"));
    asked = [];
    act(() => editor().select("held"));
    // The control: the selection reached the surfaces, which drew the bar.
    expect(editor().selectedId).toBe("held");
    expect(screen.getByRole("toolbar", { name: "Block actions" })).toBeTruthy();
    expect(asked).toEqual([]);
  });

  it("opening the context menu dims what the lock refuses, with the lock's reason", () => {
    render(<Host />);
    act(() => editor().select("held"));
    fireEvent.contextMenu(canvasBlock("held"));

    const item = screen.getByRole("menuitem", { name: /^Delete/ });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.textContent).toContain(lockedSentence(editor()));
  });

  it("a shortcut after the menu reads the menu's answer rather than trying the edit again", () => {
    render(<Host />);
    act(() => editor().select("held"));
    fireEvent.contextMenu(canvasBlock("held"));
    // The control: the menu asked the lock about the delete.
    expect(asksRemoveHeld()).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });

    trials.count = 0;
    asked = [];
    fireEvent.keyDown(document.body, { key: "Delete" });

    // The press asked, and was answered without a trial edit: the block stays.
    expect(asksRemoveHeld()).toBe(true);
    expect(trials.count).toBe(0);
    expect(canvasBlock("held")).toBeTruthy();
  });
});
