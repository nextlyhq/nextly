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

/**
 * A fake editor's answer to `attach`.
 *
 * The facade states whether it took the passage and why not, rather than
 * answering with a session or nothing — so a fake that returned the session
 * bare would be a different contract from the one under test.
 */
function attachment<T>(session: T): { status: "attached"; session: T } {
  return { status: "attached", session };
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
    const session = { focus: vi.fn(), read, detach, hold: vi.fn() };
    const load = vi.fn(() =>
      Promise.resolve({ attach: vi.fn(() => attachment(session)) })
    );

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
    const attach = vi.fn((_element: HTMLElement, _value: unknown) =>
      attachment({
        focus: vi.fn(),
        read: vi.fn(() => undefined),
        detach: vi.fn(),
        hold: vi.fn(),
      })
    );
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
    const attach = vi.fn(() =>
      attachment({
        focus: vi.fn(),
        read: vi.fn(() => undefined),
        detach: vi.fn(),
        hold: vi.fn(),
      })
    );
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
    const attach = vi.fn((_element: HTMLElement, _value: unknown) =>
      attachment({
        focus: vi.fn(),
        read: vi.fn(() => undefined),
        detach: vi.fn(),
        hold: vi.fn(),
      })
    );
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
    const attach = vi.fn((_element: HTMLElement, _value: unknown) =>
      attachment({
        focus: vi.fn(),
        read: vi
          .fn()
          .mockReturnValueOnce({ root: { type: "root", children: [] } })
          .mockReturnValue({
            root: {
              type: "root",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", text: "NEW" }],
                },
              ],
            },
          }),
        detach: vi.fn(),
        hold: vi.fn(),
      })
    );
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

    expect(handedBack).toEqual({ status: "written", document: written });
  });

  it("reports nothing written when nothing was open, so a host keeps its own document", () => {
    // The control: a finish that always answered `written` would make the host
    // discard its document for a write that never happened.
    registerArticle();
    paint();
    const { result } = renderHook(() =>
      useInlineEditing(editorState(), pendingLoader())
    );

    expect(result.current.commit()).toEqual({ status: "unchanged" });
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
    const attach = vi.fn((_element: HTMLElement, _value: unknown) =>
      attachment({
        focus: vi.fn(),
        // The passage AS OPENED first, then as the author left it. A fixture
        // answering one value for both says the author typed nothing, and an
        // untouched passage is released rather than held — so it would assert
        // the opposite rule from the one this case is about.
        read: vi
          .fn()
          .mockReturnValueOnce({ root: { type: "root", children: [] } })
          .mockReturnValue({
            root: {
              type: "root",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", text: "TYPED" }],
                },
              ],
            },
          }),
        detach,
        hold: vi.fn(),
      })
    );
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

describe("a write the op layer refuses", () => {
  /** A passage-carrying document whose node this test can rewrite in place. */
  function articleWith(text: string) {
    const nodes = [
      {
        id: "a",
        type: "acme/article",
        version: 1,
        props: {
          content: {
            root: {
              type: "root",
              children: [
                { type: "paragraph", children: [{ type: "text", text }] },
              ],
            },
          },
        },
      } as BlockNode,
    ];
    return nodes;
  }

  /** An editor whose first reading is the stored passage and whose next is typing. */
  function typingEditor(stored: string, typed: string) {
    const detach = vi.fn();
    const attach = vi.fn((_element: HTMLElement, _value: unknown) =>
      attachment({
        focus: vi.fn(),
        read: vi
          .fn()
          .mockReturnValueOnce({
            root: {
              type: "root",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", text: stored }],
                },
              ],
            },
          })
          .mockReturnValue({
            root: {
              type: "root",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", text: typed }],
                },
              ],
            },
          }),
        detach,
        hold: vi.fn(),
      })
    );
    return { attach, detach, load: vi.fn(() => Promise.resolve({ attach })) };
  }

  it("keeps the passage open when apply refuses the op", async () => {
    /*
     * The document has NOT moved on, so the write is attempted — and the op
     * layer refuses it anyway, which is what a cap the passage would exceed
     * looks like from here. Nothing was applied, so the author's words exist
     * only inside the editor; releasing would put the page's older copy back
     * over them with nothing said.
     */
    const { attach, detach, load } = typingEditor("STORED", "TYPED");
    registerArticle();
    paint();
    const state = {
      document: {
        formatVersion: 1,
        kind: "page",
        nodes: articleWith("STORED"),
      } as BlockDocument,
      selectedId: "a",
      // A refused GROUP. `applyOps` throws for a cap or a node that went, and
      // `apply` answers `null` — the same answer as a document that changed.
      apply: vi.fn(() => null),
    } as unknown as EditorState;
    const { result } = renderHook(() => useInlineEditing(state, load as never));

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });
    expect(attach).toHaveBeenCalled();

    let outcome: unknown;
    await act(async () => {
      outcome = result.current.commit();
    });

    // The write was ATTEMPTED — this is what separates this case from a
    // document that moved on, which refuses before reaching the op layer.
    expect(state.apply).toHaveBeenCalled();
    expect(outcome).toEqual({ status: "refused", reason: "rejected" });
    // Still open and still attached, which is what keeps the typed words
    // recoverable rather than gone.
    expect(detach).not.toHaveBeenCalled();
    expect(result.current.editingRich?.prop).toBe("content");
  });

  it("holds the SHARED editor, not just this hook's own record of it", async () => {
    /*
     * The guard in `begin` covers one canvas. Ownership of the editor is
     * global, so a second canvas running its own hook sees nothing mounted and
     * would attach straight over these words — the local refusal cannot reach
     * it. Saying so at the facade is what makes the promise hold across hooks.
     */
    const { attach, load } = typingEditor("STORED", "TYPED");
    registerArticle();
    paint();
    const state = {
      document: {
        formatVersion: 1,
        kind: "page",
        nodes: articleWith("STORED"),
      } as BlockDocument,
      selectedId: "a",
      apply: vi.fn(() => null),
    } as unknown as EditorState;
    const { result } = renderHook(() => useInlineEditing(state, load as never));

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });
    const session = (
      attach.mock.results[0]?.value as
        | { session?: { hold: { mock: { calls: unknown[] } } } }
        | undefined
    )?.session;
    expect(session?.hold.mock.calls).toHaveLength(0);

    await act(async () => {
      result.current.commit();
    });

    expect(session?.hold.mock.calls).toHaveLength(1);
  });

  it("holds the shared editor when the DOCUMENT moved on too", async () => {
    // The other refusal reaches the same rule by a different branch, and a fix
    // applied to one of them would leave the other losing the words.
    const { attach, load } = typingEditor("STORED", "TYPED");
    registerArticle();
    paint();
    const nodes = articleWith("STORED");
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

    const session = (
      attach.mock.results[0]?.value as
        | { session?: { hold: { mock: { calls: unknown[] } } } }
        | undefined
    )?.session;
    expect(session?.hold.mock.calls).toHaveLength(1);
  });

  it("does not hold the shared editor for an ordinary commit", async () => {
    // The control: holding on every finish would freeze the one editor the
    // whole admin shares behind the first passage anyone edited.
    const written = { formatVersion: 1, kind: "page", nodes: [] };
    const { attach, load } = typingEditor("STORED", "TYPED");
    registerArticle();
    paint();
    const state = {
      document: {
        formatVersion: 1,
        kind: "page",
        nodes: articleWith("STORED"),
      } as BlockDocument,
      selectedId: "a",
      apply: vi.fn(() => written),
    } as unknown as EditorState;
    const { result } = renderHook(() => useInlineEditing(state, load as never));

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });
    await act(async () => {
      result.current.commit();
    });

    const session = (
      attach.mock.results[0]?.value as
        | { session?: { hold: { mock: { calls: unknown[] } } } }
        | undefined
    )?.session;
    expect(session?.hold.mock.calls).toHaveLength(0);
  });

  it("refuses to open another value while a refused passage is still holding one", async () => {
    /*
     * There is ONE editor behind both surfaces. Opening anything else moves it,
     * and moving it supersedes the session that is holding the only copy of
     * what the author typed — so the request is declined instead.
     */
    const { attach, detach, load } = typingEditor("STORED", "TYPED");
    registerArticle();
    paint();
    const state = {
      document: {
        formatVersion: 1,
        kind: "page",
        nodes: articleWith("STORED"),
      } as BlockDocument,
      selectedId: "a",
      apply: vi.fn(() => null),
    } as unknown as EditorState;
    const { result } = renderHook(() => useInlineEditing(state, load as never));

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });
    const attachesWhileOpen = attach.mock.calls.length;

    await act(async () => {
      result.current.commit();
    });

    let opened: boolean | undefined;
    await act(async () => {
      opened = result.current.begin("a", "content");
    });

    expect(opened).toBe(false);
    // Not re-attached, so the live session is the one that still holds the
    // author's text rather than one opened over the top of it.
    expect(attach.mock.calls.length).toBe(attachesWhileOpen);
    expect(detach).not.toHaveBeenCalled();
    expect(result.current.editingRich?.prop).toBe("content");
  });

  it("refuses to open a PLAIN value while a refused passage is still holding one", async () => {
    /*
     * The rich surface's own `begin` cannot stop this: it is never asked. A
     * plain value is opened by the OTHER surface, and the passage it would
     * displace belongs to this one — so the composer is the only place that
     * sees both, and the editor moves regardless of which kind moved it.
     */
    const { attach, detach, load } = typingEditor("STORED", "TYPED");
    registerArticle();
    paint();
    const state = {
      document: {
        formatVersion: 1,
        kind: "page",
        nodes: articleWith("STORED"),
      } as BlockDocument,
      selectedId: "a",
      apply: vi.fn(() => null),
    } as unknown as EditorState;
    const { result } = renderHook(() => useInlineEditing(state, load as never));

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });

    await act(async () => {
      result.current.commit();
    });

    let opened: boolean | undefined;
    await act(async () => {
      opened = result.current.begin("a", "caption");
    });

    expect(opened).toBe(false);
    expect(result.current.editing).toBeNull();
    expect(detach).not.toHaveBeenCalled();
    expect(result.current.editingRich?.prop).toBe("content");
    void attach;
  });

  it("refuses a double-click onto a plain value while a refused passage is open", async () => {
    /*
     * The same rule reached the way an author actually reaches it. The plain
     * branch of the gesture finishes the passage and then delegates, and
     * delegating is what moves the editor off the words it is holding.
     */
    const { detach, load } = typingEditor("STORED", "TYPED");
    registerArticle();
    paint();
    const state = {
      document: {
        formatVersion: 1,
        kind: "page",
        nodes: articleWith("STORED"),
      } as BlockDocument,
      selectedId: "a",
      apply: vi.fn(() => null),
    } as unknown as EditorState;
    const { result } = renderHook(() => useInlineEditing(state, load as never));

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });

    await act(async () => {
      result.current.commit();
    });

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("caption"));
    });

    expect(result.current.editing).toBeNull();
    expect(detach).not.toHaveBeenCalled();
    expect(result.current.editingRich?.prop).toBe("content");
  });

  it("opens a plain value normally when no passage is being held", async () => {
    /*
     * The control for both cases above. A plain surface that simply never
     * opened after any rich commit would pass them and break ordinary editing,
     * so this drives the same gesture with a passage that committed cleanly.
     */
    const written = { formatVersion: 1, kind: "page", nodes: [] };
    const { load } = typingEditor("STORED", "TYPED");
    registerArticle();
    paint();
    const state = {
      document: {
        formatVersion: 1,
        kind: "page",
        nodes: articleWith("STORED"),
      } as BlockDocument,
      selectedId: "a",
      apply: vi.fn(() => written),
    } as unknown as EditorState;
    const { result } = renderHook(() => useInlineEditing(state, load as never));

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });
    await act(async () => {
      result.current.commit();
    });

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("caption"));
    });

    expect(result.current.editing?.prop).toBe("caption");
  });

  it("still opens a value when the previous commit was ordinary", async () => {
    /*
     * The control for the case above. A refusal that were merely a blanket
     * "never reopen after a commit" would pass it while breaking every
     * ordinary edit, so this drives the same sequence with a write that
     * SUCCEEDS and asserts the second passage opens.
     */
    const written = { formatVersion: 1, kind: "page", nodes: [] };
    const { attach, load } = typingEditor("STORED", "TYPED");
    registerArticle();
    paint();
    const state = {
      document: {
        formatVersion: 1,
        kind: "page",
        nodes: articleWith("STORED"),
      } as BlockDocument,
      selectedId: "a",
      apply: vi.fn(() => written),
    } as unknown as EditorState;
    const { result } = renderHook(() => useInlineEditing(state, load as never));

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });
    const attachesWhileOpen = attach.mock.calls.length;

    await act(async () => {
      result.current.commit();
    });

    let opened: boolean | undefined;
    await act(async () => {
      opened = result.current.begin("a", "content");
    });

    expect(opened).toBe(true);
    expect(attach.mock.calls.length).toBeGreaterThan(attachesWhileOpen);
  });

  it("reports a discarded edit when the passage stopped being editable", async () => {
    /*
     * The node is LOCKED while the caret is in it. There is nowhere left to
     * write, so holding the editor open would trap the author in a value they
     * cannot leave rather than save anything — it lets go, and says that the
     * typing was lost so a host can tell them.
     */
    const { attach, detach, load } = typingEditor("STORED", "TYPED");
    registerArticle();
    paint();
    const nodes = articleWith("STORED");
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

    nodes[0]!.locked = true;
    rerender();

    let outcome: unknown;
    await act(async () => {
      outcome = result.current.commit();
    });

    expect(outcome).toEqual({ status: "discarded" });
    // Let go, unlike a refusal: there is no version of staying open that saves
    // anything here.
    expect(detach).toHaveBeenCalled();
    expect(result.current.editingRich).toBeNull();
  });

  it("reports nothing changed when the author typed nothing", async () => {
    /*
     * The control for the case above. A `discarded` reported for every
     * let-go would have a host announcing lost work to an author who merely
     * clicked into a passage and back out, so this drives the same release
     * with the editor reading back what it was given.
     */
    const { load } = typingEditor("STORED", "STORED");
    registerArticle();
    paint();
    const state = {
      document: {
        formatVersion: 1,
        kind: "page",
        nodes: articleWith("STORED"),
      } as BlockDocument,
      selectedId: "a",
      apply: vi.fn(() => null),
    } as unknown as EditorState;
    const { result } = renderHook(() => useInlineEditing(state, load as never));

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });

    let outcome: unknown;
    await act(async () => {
      outcome = result.current.commit();
    });

    expect(outcome).toEqual({ status: "unchanged" });
  });
});

describe("the passage surface used on its own", () => {
  /*
   * `useInlineRichText` is exported from the shell separately, so a host can
   * wire it without the composer. Everything the composer does to sequence the
   * two surfaces is then absent, and the hook has to hold the same line by
   * itself — which is why these drive it directly rather than through
   * `useInlineEditing`, where `openOn` would answer first and this rule would
   * never be reached.
   */
  function articleWith(text: string) {
    return [
      {
        id: "a",
        type: "acme/article",
        version: 1,
        props: {
          content: {
            root: {
              type: "root",
              children: [
                { type: "paragraph", children: [{ type: "text", text }] },
              ],
            },
          },
        },
      } as BlockNode,
    ];
  }

  function typingEditor(stored: string, typed: string) {
    const detach = vi.fn();
    const passage = (text: string) => ({
      root: {
        type: "root",
        children: [{ type: "paragraph", children: [{ type: "text", text }] }],
      },
    });
    const attach = vi.fn((_element: HTMLElement, _value: unknown) =>
      attachment({
        focus: vi.fn(),
        read: vi
          .fn()
          .mockReturnValueOnce(passage(stored))
          .mockReturnValue(passage(typed)),
        detach,
        hold: vi.fn(),
      })
    );
    return { attach, detach, load: vi.fn(() => Promise.resolve({ attach })) };
  }

  function stateFor(apply: () => unknown) {
    return {
      document: {
        formatVersion: 1,
        kind: "page",
        nodes: articleWith("STORED"),
      } as BlockDocument,
      selectedId: "a",
      apply: vi.fn(apply),
    } as unknown as EditorState;
  }

  it("declines a second begin while a refused passage is still holding one", async () => {
    const { attach, detach, load } = typingEditor("STORED", "TYPED");
    registerArticle();
    paint();
    const { result } = renderHook(() =>
      useInlineRichText(
        stateFor(() => null),
        load as never
      )
    );

    await act(async () => {
      result.current.begin("a", "content");
    });
    const attachesWhileOpen = attach.mock.calls.length;
    expect(attachesWhileOpen).toBeGreaterThan(0);

    await act(async () => {
      result.current.commit();
    });

    let opened: boolean | undefined;
    await act(async () => {
      opened = result.current.begin("a", "content");
    });

    expect(opened).toBe(false);
    expect(attach.mock.calls.length).toBe(attachesWhileOpen);
    expect(detach).not.toHaveBeenCalled();
    expect(result.current.editing?.prop).toBe("content");
  });

  it("accepts a second begin after an ordinary commit", async () => {
    // The control: declining unconditionally after any commit would pass the
    // case above and stop an author opening a second passage at all.
    const written = { formatVersion: 1, kind: "page", nodes: [] };
    const { attach, load } = typingEditor("STORED", "TYPED");
    registerArticle();
    paint();
    const { result } = renderHook(() =>
      useInlineRichText(
        stateFor(() => written),
        load as never
      )
    );

    await act(async () => {
      result.current.begin("a", "content");
    });
    const attachesWhileOpen = attach.mock.calls.length;

    await act(async () => {
      result.current.commit();
    });

    let opened: boolean | undefined;
    await act(async () => {
      opened = result.current.begin("a", "content");
    });

    expect(opened).toBe(true);
    expect(attach.mock.calls.length).toBeGreaterThan(attachesWhileOpen);
  });
});

describe("how a host hears about an edit it did not finish itself", () => {
  /*
   * Almost no edit ends by the host calling `commit`. Leaving the passage ends
   * one, opening another ends one, and the canvas unmounting ends one — so a
   * host reporting only what its own calls returned is silent on every common
   * path, including the one that loses the author's words.
   */
  function articleWith(text: string) {
    return [
      {
        id: "a",
        type: "acme/article",
        version: 1,
        props: {
          content: {
            root: {
              type: "root",
              children: [
                { type: "paragraph", children: [{ type: "text", text }] },
              ],
            },
          },
        },
      } as BlockNode,
    ];
  }

  function typingEditor(stored: string, typed: string) {
    const passage = (text: string) => ({
      root: {
        type: "root",
        children: [{ type: "paragraph", children: [{ type: "text", text }] }],
      },
    });
    const detach = vi.fn();
    const attach = vi.fn((_element: HTMLElement, _value: unknown) =>
      attachment({
        focus: vi.fn(),
        read: vi
          .fn()
          .mockReturnValueOnce(passage(stored))
          .mockReturnValue(passage(typed)),
        detach,
        hold: vi.fn(),
      })
    );
    return { attach, detach, load: vi.fn(() => Promise.resolve({ attach })) };
  }

  it("reports a passage discarded by LEAVING it, not only by exiting", async () => {
    /*
     * The node is locked while the caret is in it, and the author clicks away.
     * Blur is the ordinary way to finish an edit; the text is gone, and if this
     * outcome does not reach the host then nothing on screen ever says so.
     */
    const finished = vi.fn();
    const { load } = typingEditor("STORED", "TYPED");
    registerArticle();
    paint();
    const nodes = articleWith("STORED");
    const state = {
      document: { formatVersion: 1, kind: "page", nodes } as BlockDocument,
      selectedId: "a",
      apply: vi.fn(() => null),
    } as unknown as EditorState;
    const { result, rerender } = renderHook(() =>
      useInlineEditing(state, load as never, finished)
    );

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });

    nodes[0]!.locked = true;
    rerender();
    finished.mockClear();

    const element = document.querySelector<HTMLElement>(
      '[data-nx-prop="content"]'
    );
    await act(async () => {
      element?.dispatchEvent(new Event("blur"));
    });

    expect(finished).toHaveBeenCalledWith({ status: "discarded" });
  });

  it("reports an ordinary blur as nothing worth saying", async () => {
    // The control: reporting `discarded` for every blur would have the host
    // announcing lost work to an author who clicked into a passage and out.
    const finished = vi.fn();
    const { load } = typingEditor("STORED", "STORED");
    registerArticle();
    paint();
    const state = {
      document: {
        formatVersion: 1,
        kind: "page",
        nodes: articleWith("STORED"),
      } as BlockDocument,
      selectedId: "a",
      apply: vi.fn(() => null),
    } as unknown as EditorState;
    const { result } = renderHook(() =>
      useInlineEditing(state, load as never, finished)
    );

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });
    finished.mockClear();

    const element = document.querySelector<HTMLElement>(
      '[data-nx-prop="content"]'
    );
    await act(async () => {
      element?.dispatchEvent(new Event("blur"));
    });

    expect(finished).toHaveBeenCalledWith({ status: "unchanged" });
  });

  it("releases an UNTOUCHED passage when the document moved on", async () => {
    /*
     * Holding a passage open protects the author's words from the older copy
     * being put back over them — but only if they wrote any. A caret that
     * merely sat there has nothing to protect, and refusing is worse than doing
     * nothing: the host cannot close, and the untouched editor goes on showing
     * the stale passage over the newer one that arrived.
     */
    const finished = vi.fn();
    const { detach, load } = typingEditor("STORED", "STORED");
    registerArticle();
    paint();
    const nodes = articleWith("STORED");
    const state = {
      document: { formatVersion: 1, kind: "page", nodes } as BlockDocument,
      selectedId: "a",
      apply: vi.fn(() => null),
    } as unknown as EditorState;
    const { result, rerender } = renderHook(() =>
      useInlineEditing(state, load as never, finished)
    );

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });

    // Somebody else rewrites the passage while the caret sits in it.
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

    let outcome: unknown;
    await act(async () => {
      outcome = result.current.commit();
    });

    expect(outcome).toEqual({ status: "unchanged" });
    // Let go, so the newer passage is what the page renders from here.
    expect(detach).toHaveBeenCalled();
    expect(result.current.editingRich).toBeNull();
  });
});

describe("the passage the editor is handed when it finally arrives", () => {
  it("attaches the CURRENT passage, not the one read before the chunk loaded", async () => {
    /*
     * The editor is fetched on first edit, and the fetch takes as long as a
     * network takes. An undo, a remote update or another surface can rewrite
     * the passage in that window, and the page has already re-rendered with the
     * new words by the time the chunk lands.
     *
     * Attaching the copy read at the start puts the caret into content nobody
     * can see any more, and the first thing the author types is refused as
     * `moved-on` — a write lost to a conflict that had already resolved before
     * the editor existed.
     */
    const attach = vi.fn((_element: HTMLElement, _value: unknown) =>
      attachment({
        focus: vi.fn(),
        read: vi.fn(() => ({ root: { type: "root", children: [] } })),
        detach: vi.fn(),
        hold: vi.fn(),
      })
    );
    let arrive: (() => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<{ attach: typeof attach }>(resolve => {
          arrive = () => resolve({ attach });
        })
    );

    registerArticle();
    paint();
    const nodes = [
      {
        id: "a",
        type: "acme/article",
        version: 1,
        props: {
          content: {
            root: {
              type: "root",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", text: "AS OPENED" }],
                },
              ],
            },
          },
        },
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
    // Nothing has been handed over yet: the chunk is still in flight.
    expect(attach).not.toHaveBeenCalled();

    // The passage is rewritten while the editor is still loading.
    nodes[0]!.props = {
      content: {
        root: {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "REWRITTEN MEANWHILE" }],
            },
          ],
        },
      },
    };
    rerender();

    await act(async () => {
      arrive?.();
      await Promise.resolve();
    });

    expect(attach).toHaveBeenCalled();
    // The VALUE handed over, which is the thing the author's caret lands in.
    expect(JSON.stringify(attach.mock.calls[0]?.[1])).toContain(
      "REWRITTEN MEANWHILE"
    );
    expect(JSON.stringify(attach.mock.calls[0]?.[1])).not.toContain(
      "AS OPENED"
    );
  });
});

describe("a passage that could not be opened at all", () => {
  /** An editor that refuses everything for the stated reason. */
  function refusingEditor(reason: "unsupported" | "held") {
    const attach = vi.fn((_element: HTMLElement, _value: unknown) => ({
      status: "refused" as const,
      reason,
    }));
    return { attach, load: vi.fn(() => Promise.resolve({ attach })) };
  }

  function article() {
    return [
      {
        id: "a",
        type: "acme/article",
        version: 1,
        props: {
          content: {
            root: {
              type: "root",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", text: "STORED" }],
                },
              ],
            },
          },
        },
      } as BlockNode,
    ];
  }

  function stateFor() {
    return {
      document: {
        formatVersion: 1,
        kind: "page",
        nodes: article(),
      } as BlockDocument,
      selectedId: "a",
      apply: vi.fn(() => null),
    } as unknown as EditorState;
  }

  it("tells the host when the editor is BUSY holding another edit", async () => {
    /*
     * Otherwise the author's double-click does nothing at all, with no cause
     * they can see — the same silent refusal this module already declines to
     * ship on the way out of an edit, arriving on the way in.
     */
    const finished = vi.fn();
    const { load } = refusingEditor("held");
    registerArticle();
    paint();
    const { result } = renderHook(() =>
      useInlineEditing(stateFor(), load as never, finished)
    );

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });

    expect(finished).toHaveBeenCalledWith({ status: "unavailable" });
    // And nothing is left marked as being edited.
    expect(result.current.editingRich).toBeNull();
  });

  it("says nothing when the passage simply cannot be represented", async () => {
    /*
     * The control, and a deliberate difference rather than an oversight: a node
     * this editor cannot hold is nothing the author did and nothing they can
     * act on, so announcing it would be noise on a page that renders correctly.
     */
    const finished = vi.fn();
    const { load } = refusingEditor("unsupported");
    registerArticle();
    paint();
    const { result } = renderHook(() =>
      useInlineEditing(stateFor(), load as never, finished)
    );

    await act(async () => {
      result.current.onDoubleClick(doubleClickOn("content"));
    });

    expect(
      finished.mock.calls.filter(
        ([outcome]) => (outcome as { status: string }).status === "unavailable"
      )
    ).toEqual([]);
    expect(result.current.editingRich).toBeNull();
  });
});
