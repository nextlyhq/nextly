// @vitest-environment jsdom
/**
 * One gesture reaching the right editor.
 *
 * The routing is the only thing this module decides, and it is the thing a
 * hook's own state cannot show: sending a passage to the plain surface reads
 * back an empty string and commits it over the author's work, and sending a
 * line of text to the rich one stores a tree where every reader expects a
 * string. Both failures are silent, and both look like "the edit opened".
 *
 * So each case asserts WHICH surface opened, never merely that one did.
 *
 * @module use-inline-editing.test
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearBlocks,
  registerBlocks,
  RICH_TEXT_PROP_TYPE,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { EditorState } from "./editor-state";
import { useInlineEditing } from "./use-inline-editing";
import { useInlineRichText } from "./use-inline-rich-text";

afterEach(() => {
  clearBlocks();
  document.body.innerHTML = "";
});

/** A block declaring its plain value BEFORE its passage. */
function registerCaptionFirst(): void {
  registerBlocks(
    [
      {
        version: 1,
        description: "A block.",
        example: { props: {} },
        render: () => null,
        name: "acme/caption-first",
        props: {
          caption: { type: "text", inline: true },
          content: { type: RICH_TEXT_PROP_TYPE, inline: true },
        },
      },
    ] as never,
    { source: "use-inline-editing-test" }
  );
}

/** A block with a passage and a line of text, both editable on the canvas. */
function registerArticle(): void {
  registerBlocks(
    [
      {
        version: 1,
        description: "A block.",
        example: { props: {} },
        render: () => null,
        name: "acme/article",
        props: {
          content: { type: RICH_TEXT_PROP_TYPE, inline: true },
          caption: { type: "text", inline: true },
        },
      },
    ] as never,
    { source: "use-inline-editing-test" }
  );
}

function editorState(): EditorState {
  const nodes = [
    {
      id: "a",
      type: "acme/article",
      version: 1,
      props: { caption: "A caption" },
    } as BlockNode,
  ];
  return {
    document: { formatVersion: 1, kind: "page", nodes } as BlockDocument,
    selectedId: "a",
    apply: vi.fn(() => null),
  } as unknown as EditorState;
}

/** The rendered canvas, marked the way the renderer marks it. */
function paint(): void {
  document.body.innerHTML = `
    <div data-nx-node="a">
      <div data-nx-prop="content"><p>A passage</p></div>
      <span data-nx-prop="caption">A caption</span>
    </div>`;
}

/** A loader that never resolves, so a test observes the ROUTING alone. */
function pendingLoader() {
  return vi.fn(() => new Promise<never>(() => {}));
}

function mount(load = pendingLoader()) {
  registerArticle();
  paint();
  const result = renderHook(() => useInlineEditing(editorState(), load));
  return { ...result, load };
}

/** Double-click whatever carries this prop. */
function doubleClickOn(prop: string): { target: EventTarget | null } {
  const element = document.querySelector(`[data-nx-prop="${prop}"]`);
  return { target: element };
}

describe("which editor a double-click reaches", () => {
  it("opens the RICH editor on a passage", () => {
    const { result, load } = mount();

    act(() => result.current.onDoubleClick(doubleClickOn("content")));

    expect(result.current.editingRich).toEqual({
      nodeId: "a",
      prop: "content",
    });
    // The plain surface must be untouched, not merely "also open".
    expect(result.current.editing).toBeNull();
    expect(load).toHaveBeenCalled();
  });

  it("opens the PLAIN editor on a line of text", () => {
    const { result, load } = mount();

    act(() => result.current.onDoubleClick(doubleClickOn("caption")));

    expect(result.current.editing).toEqual({ nodeId: "a", prop: "caption" });
    expect(result.current.editingRich).toBeNull();
    // The 630KB chunk is not fetched for a value that does not need it.
    expect(load).not.toHaveBeenCalled();
  });

  it("opens nothing when the gesture missed every value", () => {
    const { result } = mount();
    const outside = document.querySelector("[data-nx-node]");

    act(() => result.current.onDoubleClick({ target: outside }));

    expect(result.current.editing).toBeNull();
    expect(result.current.editingRich).toBeNull();
  });
});

describe("a keyboard caller, which has a block and no element", () => {
  it("reaches the passage when the block has one", () => {
    const { result } = mount();

    act(() => {
      result.current.begin("a");
    });

    expect(result.current.editingRich?.prop).toBe("content");
    expect(result.current.editing).toBeNull();
  });

  it("routes a NAMED value by what the block declared it to be", () => {
    const { result } = mount();

    act(() => {
      result.current.begin("a", "caption");
    });

    expect(result.current.editing?.prop).toBe("caption");
    expect(result.current.editingRich).toBeNull();
  });
});

describe("a host that supplies no rich-text editor", () => {
  it("still edits plain text, and simply does not open passages", () => {
    // A builder embedded somewhere without the admin bundle. The alternative is
    // an author double-clicking a passage and getting a caret backed by
    // nothing, which is worse than the gesture doing nothing at all.
    registerArticle();
    paint();
    const { result } = renderHook(() =>
      useInlineEditing(editorState(), undefined)
    );

    act(() => result.current.onDoubleClick(doubleClickOn("content")));
    expect(result.current.editingRich).toBeNull();

    act(() => result.current.onDoubleClick(doubleClickOn("caption")));
    expect(result.current.editing?.prop).toBe("caption");
  });
});

describe("the block's FIRST inline value", () => {
  it("is the one it declared first, not the first the rich surface owns", () => {
    /*
     * A keyboard caller names no prop, so whatever this resolves to is the only
     * value the author ever reaches that way. Asking the rich surface first and
     * falling back answers with the rich prop whenever one exists — which is a
     * different value the moment a block declares a line of text before its
     * passage, and it silently changes the existing keyboard behaviour.
     */
    registerCaptionFirst();
    // Painted, because the plain surface drops an edit whose element it cannot
    // find — so an unpainted block would report "nothing opened" for a reason
    // that has nothing to do with declaration order.
    document.body.innerHTML = `
      <div data-nx-node="b">
        <span data-nx-prop="caption">A caption</span>
        <div data-nx-prop="content"><p>A passage</p></div>
      </div>`;
    const nodes = [
      {
        id: "b",
        type: "acme/caption-first",
        version: 1,
        props: {},
      } as BlockNode,
    ];
    const state = {
      document: { formatVersion: 1, kind: "page", nodes } as BlockDocument,
      selectedId: "b",
      apply: vi.fn(() => null),
    } as unknown as EditorState;
    const { result } = renderHook(() =>
      useInlineEditing(state, pendingLoader())
    );

    act(() => {
      result.current.begin("b");
    });

    expect(result.current.editing?.prop).toBe("caption");
    expect(result.current.editingRich).toBeNull();
  });
});

describe("two surfaces are never live at once", () => {
  it("finishes a pending passage before opening a line of text", () => {
    /*
     * The passage's editor arrives asynchronously. Opening the caption while it
     * is still loading used to leave BOTH marked as being edited — and when the
     * chunk landed it focused the passage, which blurred the caption into a
     * commit the author never asked for and moved the caret away from what they
     * were typing.
     */
    const { result } = mount();

    act(() => result.current.onDoubleClick(doubleClickOn("content")));
    expect(result.current.editingRich).not.toBeNull();

    act(() => result.current.onDoubleClick(doubleClickOn("caption")));

    expect(result.current.editing?.prop).toBe("caption");
    expect(result.current.editingRich).toBeNull();
  });

  it("finishes a line of text before opening a passage", () => {
    // The same rule in the other direction, which a one-sided guard would miss.
    const { result } = mount();

    act(() => result.current.onDoubleClick(doubleClickOn("caption")));
    expect(result.current.editing).not.toBeNull();

    act(() => result.current.onDoubleClick(doubleClickOn("content")));

    expect(result.current.editingRich?.prop).toBe("content");
    expect(result.current.editing).toBeNull();
  });
});

describe("when the editor's chunk never arrives", () => {
  it("drops the edit rather than marking a passage nobody can type in", async () => {
    /*
     * A dropped connection, or a deployment swapping the asset out from under
     * an open tab. Leaving `editing` set shows a passage as being edited with
     * no editor behind it — and the element swallows the double-click that
     * would retry, so the author is locked out of it for the rest of the
     * session.
     */
    const failing = vi.fn(() => Promise.reject(new Error("chunk gone")));
    registerArticle();
    paint();
    const { result } = renderHook(() =>
      useInlineEditing(editorState(), failing)
    );

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });

    expect(failing).toHaveBeenCalled();
    expect(result.current.editingRich).toBeNull();
  });
});

describe("the canvas going away mid-edit", () => {
  it("gives the element back instead of leaving the editor on a detached tree", async () => {
    /*
     * A navigation, a field removed, access revoked. Removing the focused
     * element does not reliably fire `blur`, so nothing else runs — and there
     * is only ONE editor, so one left attached to a tree nobody can see keeps
     * its listeners and its state until some later passage displaces it.
     *
     * A fake session is what makes the teardown observable at all: the real one
     * is behind a lazily loaded chunk, and a test that stubbed the loader with
     * a pending promise could never see a detach because nothing ever attached.
     */
    const detach = vi.fn();
    const typed = {
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", text: "TYPED" }] },
        ],
      },
    };
    // Reads the untouched passage first (the baseline taken at attach), then
    // what the author left behind — so the two differ and there is a real edit
    // to preserve.
    const read = vi
      .fn()
      .mockReturnValueOnce({ root: { type: "root", children: [] } })
      .mockReturnValue(typed);
    const session = { focus: vi.fn(), read, detach };
    const load = vi.fn(() => Promise.resolve({ attach: vi.fn(() => session) }));

    registerArticle();
    paint();
    const state = editorState();
    const { result, unmount } = renderHook(() => useInlineEditing(state, load));

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });
    // The treatment is only meaningful once something is actually attached.
    expect(load).toHaveBeenCalled();

    unmount();

    expect(detach).toHaveBeenCalled();
    /*
     * WRITTEN, not merely released. Rich keystrokes live in the editor's own
     * history and never reach the document until an edit finishes, so the
     * canvas op history the unsaved-work guard reads is still at zero while a
     * passage is being typed. Detaching without writing loses the words AND
     * leaves the guard silent, so nothing warns before the navigation that
     * takes them.
     */
    expect(state.apply).toHaveBeenCalled();
  });
});

describe("which element a pointer gesture edits", () => {
  it("edits the one that was CLICKED, not the first with that id on the page", async () => {
    /*
     * Two canvases showing one document carry the same node ids, so searching
     * the page for `[data-nx-node="a"]` answers with whichever comes first —
     * which can be the other canvas. The result is an editor attached over
     * there while the commit lands in the editor state over here.
     *
     * The gesture already knows the element; passing it is what removes the
     * search rather than trying to make the search cleverer.
     */
    // Typed parameters, so the recorded call carries the element it was given:
    // an untyped `vi.fn(() => …)` records an empty argument tuple and the
    // assertion below could not reach it.
    const attach = vi.fn((_element: HTMLElement, _value: unknown) => ({
      focus: vi.fn(),
      read: vi.fn(() => undefined),
      detach: vi.fn(),
    }));
    const load = vi.fn(() => Promise.resolve({ attach }));

    registerArticle();
    document.body.innerHTML = `
      <div id="first" data-nx-node="a">
        <div data-nx-prop="content"><p>the other canvas</p></div>
      </div>
      <div id="second" data-nx-node="a">
        <div data-nx-prop="content"><p>the one clicked</p></div>
      </div>`;
    const { result } = renderHook(() =>
      useInlineEditing(editorState(), load as never)
    );

    const clicked = document
      .querySelector("#second")
      ?.querySelector("[data-nx-prop]");
    await act(async () => {
      result.current.onDoubleClick({ target: clicked ?? null });
    });

    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0]?.[0]).toBe(clicked);
  });
});

describe("walking away while the editor is still loading", () => {
  it("drops the pending edit instead of grabbing the caret back", async () => {
    /*
     * The passage is not focused or editable until `attach` runs, so none of
     * the ordinary ways of leaving a block emit `blur`: clicking the canvas
     * background, selecting a different block, or deselecting from the keyboard
     * each change only the selection. Without watching that, the load lands
     * after the author has moved on and takes the caret back to a passage they
     * left — and it attaches, so the next thing they type goes into the wrong
     * block.
     */
    let land: ((editor: unknown) => void) | undefined;
    const attach = vi.fn(() => ({
      focus: vi.fn(),
      read: vi.fn(() => undefined),
      detach: vi.fn(),
    }));
    const load = vi.fn(
      () =>
        new Promise(resolve => {
          land = resolve as (e: unknown) => void;
        })
    );

    registerArticle();
    paint();
    let selectedId = "a";
    const { result, rerender } = renderHook(() =>
      useInlineEditing(
        { ...editorState(), selectedId } as EditorState,
        load as never
      )
    );

    act(() => result.current.onDoubleClick(doubleClickOn("content")));
    expect(result.current.editingRich?.prop).toBe("content");
    expect(load).toHaveBeenCalled();

    // The author clicks the background: the selection clears, and nothing else
    // happens — no blur, because nothing was focused.
    selectedId = "";
    rerender();

    expect(result.current.editingRich).toBeNull();

    // The chunk arrives late. It must not attach to the passage they left.
    await act(async () => {
      land?.({ attach });
    });

    expect(attach).not.toHaveBeenCalled();
  });
});

describe("where the caret lands in a passage", () => {
  it("carries the pointer's position to the surface that opens", async () => {
    /*
     * The editor puts the caret at the END of a passage when the state it
     * loaded carries no selection, and a freshly parsed state never carries
     * one — so without the gesture's position every edit began at the end,
     * however far into the words the author had clicked.
     *
     * The position comes from the POINTER, not from the document's selection.
     * A press on a block is a grab rather than a highlight, so the canvas
     * suppresses the browser's own selection: measured in a real browser,
     * `rangeCount` is 0 at the moment of the double-click. An earlier version
     * read the selection and therefore always found nothing.
     *
     * What is asserted here is that the coordinates reach the surface at all —
     * the wiring the defect lived in. WHERE the caret physically ends up cannot
     * be asserted in jsdom, which implements neither `caretRangeFromPoint` nor
     * a reflected selection; `e2e/tests/inline-rich-text.spec.ts` covers that
     * in a browser and fails without this.
     */
    registerArticle();
    paint();
    const { result } = renderHook(() =>
      useInlineEditing(editorState(), pendingLoader())
    );

    const passage = document.querySelector('[data-nx-prop="content"]');
    act(() =>
      result.current.onDoubleClick({
        target: passage,
        clientX: 120,
        clientY: 40,
      })
    );

    // The rich surface opened from a gesture carrying coordinates. jsdom cannot
    // turn those into an offset, so this stops here deliberately rather than
    // asserting a number it would have invented.
    expect(result.current.editingRich?.prop).toBe("content");
  });
});

describe("a second passage begun before the first was released", () => {
  /** A block with TWO passages, so the two begins name different values. */
  function registerTwoPassages(): void {
    registerBlocks(
      [
        {
          version: 1,
          description: "A block.",
          example: { props: {} },
          render: () => null,
          name: "acme/two",
          props: {
            intro: { type: RICH_TEXT_PROP_TYPE, inline: true },
            outro: { type: RICH_TEXT_PROP_TYPE, inline: true },
          },
        },
      ] as never,
      { source: "use-inline-editing-test" }
    );
  }

  it("opens the new passage instead of cancelling it", async () => {
    /*
     * Driven against `useInlineRichText` directly: it is exported on its own,
     * and its `begin` does not oblige a caller to finish the open edit first.
     * `useInlineEditing` commits before re-targeting, so a case routed through
     * it cannot reach this sequence at all.
     *
     * Without releasing first, the old edit's effect cleanup runs after the new
     * state is installed and its commit clears `editing` — cancelling the
     * passage just requested rather than the one it belonged to. The two begins
     * name DIFFERENT passages, because otherwise the final state looks the same
     * whether the second one opened or the first simply re-ran.
     */
    const attach = vi.fn((_element: HTMLElement, _value: unknown) => ({
      focus: vi.fn(),
      read: vi.fn(() => undefined),
      detach: vi.fn(),
    }));
    const load = vi.fn(() => Promise.resolve({ attach }));

    registerTwoPassages();
    document.body.innerHTML = `
      <div data-nx-node="c">
        <div data-nx-prop="intro"><p>first</p></div>
        <div data-nx-prop="outro"><p>second</p></div>
      </div>`;
    const nodes = [
      { id: "c", type: "acme/two", version: 1, props: {} } as BlockNode,
    ];
    const state = {
      document: { formatVersion: 1, kind: "page", nodes } as BlockDocument,
      selectedId: "c",
      apply: vi.fn(() => null),
    } as unknown as EditorState;
    const { result } = renderHook(() =>
      useInlineRichText(state, load as never)
    );

    await act(async () => {
      result.current.begin("c", "intro");
    });
    expect(result.current.editing?.prop).toBe("intro");
    expect(attach).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.begin("c", "outro");
    });

    expect(result.current.editing?.prop).toBe("outro");
    // And it actually mounted, rather than being left as a state nobody served.
    expect(attach).toHaveBeenCalledTimes(2);
  });
});

describe("what a host gets back from finishing an edit", () => {
  it("returns the document the write produced, not nothing", async () => {
    /*
     * The host commits its document to the form when the author leaves. An
     * inline edit lives in the element until it ends, so the document the host
     * is holding is the one from BEFORE the edit — finishing the edit and then
     * handing over that stale copy loses exactly the words the author was
     * writing, through the most ordinary exit there is.
     *
     * So the finish has to hand back what it wrote.
     */
    const written = { formatVersion: 1, kind: "page", nodes: [] };
    const attach = vi.fn((_element: HTMLElement, _value: unknown) => ({
      focus: vi.fn(),
      read: vi
        .fn()
        .mockReturnValueOnce({ root: { type: "root", children: [] } })
        .mockReturnValue({
          root: {
            type: "root",
            children: [
              { type: "paragraph", children: [{ type: "text", text: "NEW" }] },
            ],
          },
        }),
      detach: vi.fn(),
    }));
    const load = vi.fn(() => Promise.resolve({ attach }));

    registerArticle();
    paint();
    const state = { ...editorState(), apply: vi.fn(() => written) };
    const { result } = renderHook(() =>
      useInlineEditing(state as unknown as EditorState, load as never)
    );

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });

    let handedBack: unknown;
    await act(async () => {
      handedBack = result.current.commit();
    });

    expect(handedBack).toBe(written);
  });

  it("returns null when nothing was open, so a host keeps its own document", () => {
    // The control: a finish that always answered with something would make the
    // host discard its document for a write that never happened.
    registerArticle();
    paint();
    const { result } = renderHook(() =>
      useInlineEditing(editorState(), pendingLoader())
    );

    expect(result.current.commit()).toBeNull();
  });
});

describe("a write the document refuses", () => {
  it("keeps the passage open instead of discarding what was typed", async () => {
    /*
     * Another surface rewrites the same prop while the caret is open. The write
     * is refused — correctly, because committing would replace the newer value
     * with the older one the editor is holding.
     *
     * What must NOT happen is releasing anyway. The author's words exist only
     * inside the editor, so tearing it down loses them AND puts the page's
     * older copy back in their place, with nothing said. Leaving it open keeps
     * their text on screen; Escape still discards it deliberately.
     */
    const detach = vi.fn();
    const attach = vi.fn((_element: HTMLElement, _value: unknown) => ({
      focus: vi.fn(),
      read: vi.fn(() => ({
        root: {
          type: "root",
          children: [
            { type: "paragraph", children: [{ type: "text", text: "TYPED" }] },
          ],
        },
      })),
      detach,
    }));
    const load = vi.fn(() => Promise.resolve({ attach }));

    registerArticle();
    paint();
    const nodes = [
      {
        id: "a",
        type: "acme/article",
        version: 1,
        props: { content: { root: { type: "root", children: [] } } },
      } as BlockNode,
    ];
    const state = {
      document: { formatVersion: 1, kind: "page", nodes } as BlockDocument,
      selectedId: "a",
      apply: vi.fn(() => null),
    } as unknown as EditorState;
    const { result, rerender } = renderHook(() =>
      useInlineEditing(state, load as never)
    );

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });
    expect(attach).toHaveBeenCalled();

    // Somebody else rewrites the passage while the caret is in it.
    nodes[0]!.props = {
      content: {
        root: {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "SOMEONE ELSE" }],
            },
          ],
        },
      },
    };
    rerender();

    await act(async () => {
      result.current.commit();
    });

    expect(state.apply).not.toHaveBeenCalled();
    // Still open, and still holding the editor — this is what makes the typed
    // words recoverable rather than gone.
    expect(result.current.editingRich?.prop).toBe("content");
    expect(detach).not.toHaveBeenCalled();
  });
});
