// @vitest-environment jsdom

/**
 * What a spacing gesture WRITES.
 *
 * `spacing-drag.test.ts` decides the arithmetic and the side mapping given
 * numbers. What is only true here is what reaches the document: that a drag of
 * many moves costs ONE entry in the history, that the value lands in the stored
 * node rather than only on the canvas, that the keyboard reaches the same value
 * the pointer does, and that a multi-side gesture does not lose three of its
 * four sides to the envelope the fourth carries.
 *
 * The editor is REAL — `useEditorState`, with its own history — because every
 * claim above is about the document and the undo stack. A fake `apply` would
 * turn "one undo entry" into an assertion about a spy's call count, which is
 * the same number arrived at without the mechanism that has to produce it.
 *
 * GEOMETRY is not asserted. jsdom reports every element as zero-sized, so a
 * rectangle here would describe jsdom rather than a canvas an author sees.
 *
 * @module spacing-handles.test
 */

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { CANVAS_ROOT_CLASS } from "./canvas";
import { useEditorState, type EditorState } from "./editor-state";
import type { SpacingBand } from "./spacing-bands";
import {
  SpacingHandles,
  type SpacingScrubContext,
  type SpacingSubject,
} from "./spacing-handles";
import { readStyleValue } from "./style-values";

beforeAll(() => {
  // Absent from jsdom entirely, as `canvas-drag.test.tsx` records. Without them
  // the first pointerdown throws and every case fails on the harness.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.setPointerCapture = function setPointerCapture(): void {};
  element.releasePointerCapture = function releasePointerCapture(): void {};
  element.hasPointerCapture = function hasPointerCapture(): boolean {
    return true;
  };
});

/*
 * Real registrations, because a handle now asks the registry what the block's
 * author allows. `getBlock` answering `undefined` withholds every handle — which
 * is the right answer for an unknown block and would make every case below pass
 * for the wrong reason.
 */
beforeAll(() => {
  registerBlocks(
    [
      {
        name: "acme/spaced",
        version: 1,
        description: "Offers both spacing boxes.",
        example: { props: {} },
        supports: { spacing: { margin: true, padding: true } },
        render: () => React.createElement("div"),
      },
      {
        name: "acme/margin-only",
        version: 1,
        description: "Offers margin and withholds padding.",
        example: { props: {} },
        supports: { spacing: { margin: true } },
        render: () => React.createElement("div"),
      },
      {
        name: "acme/plain",
        version: 1,
        description: "Declares no spacing capability at all.",
        example: { props: {} },
        render: () => React.createElement("div"),
      },
    ] as never,
    { source: "spacing-handles-test" }
  );
});

afterEach(cleanup);
afterAll(clearBlocks);

const NODE_ID = "a";

function documentWith(
  styles?: BlockNode["styles"],
  type = "acme/spaced"
): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: NODE_ID,
        type,
        version: 1,
        props: {},
        ...(styles === undefined ? {} : { styles }),
      },
    ],
  } as unknown as BlockDocument;
}

/** A band as `spacingBands` would emit it; the rectangle is never asserted. */
function band(
  box: SpacingBand["box"],
  side: SpacingBand["side"],
  label: string
): SpacingBand {
  return {
    box,
    side,
    rect: { x: 0, y: 0, width: 10, height: 10 },
    label,
    negative: false,
  };
}

const UNSCALED = {
  scale: { x: 1, y: 1 },
  marginScale: { x: 1, y: 1 },
};

function subjectWith(overrides: Partial<SpacingSubject> = {}): SpacingSubject {
  return {
    nodeId: NODE_ID,
    margin: { top: 10, right: 10, bottom: 10, left: 10 },
    padding: { top: 4, right: 4, bottom: 4, left: 4 },
    scales: UNSCALED,
    orientation: { writingMode: "horizontal-tb", direction: "ltr" },
    ...overrides,
  };
}

const BASE: SpacingScrubContext = {
  address: { state: "base", breakpoint: "base" },
};

/** The live editor, so a test can read the document and the history depth. */
let live: EditorState | null = null;

function Harness({
  bands,
  subject,
  context = BASE,
  initial,
}: {
  bands: readonly SpacingBand[];
  subject: SpacingSubject;
  context?: SpacingScrubContext;
  initial: BlockDocument;
}): React.JSX.Element {
  const editor = useEditorState({ initialDocument: initial });
  live = editor;
  return (
    <SpacingHandles
      editor={editor}
      bands={bands}
      subject={subject}
      context={context}
    />
  );
}

function mount(
  bands: readonly SpacingBand[],
  subject: SpacingSubject = subjectWith(),
  initial: BlockDocument = documentWith(),
  context: SpacingScrubContext = BASE
): void {
  render(
    <Harness
      bands={bands}
      subject={subject}
      context={context}
      initial={initial}
    />
  );
}

/**
 * One handle, addressed by its accessible NAME.
 *
 * The name carries the value, because the control has no honest ARIA range to
 * put one in: a slider's bounds default to 0 and 100, and this control admits
 * negative margins and values well above a hundred.
 */
/**
 * The scrub preview's rules, if any.
 *
 * Scoped to the rendered tree and to the node class the compiler emits. The
 * document at large is not empty of stylesheets — an empty `<style>` from the
 * environment, and a whole toast library's sheet in `head` — so a bare count of
 * `style` elements is never zero and an assertion of "no preview" could not
 * fail. Matching the emitted class is what makes this the preview's own output
 * rather than anything that happens to be a stylesheet.
 */
function previewRules(): string[] {
  return Array.from(document.body.querySelectorAll("style"))
    .map(element => element.textContent ?? "")
    .filter(text => text.includes("nx-pb-"));
}

/** The harness with a spy on the re-measure request. */
function HarnessWithPreviewSpy({
  onPreviewChange,
}: {
  onPreviewChange: () => void;
}): React.JSX.Element {
  const editor = useEditorState({ initialDocument: documentWith() });
  live = editor;
  return (
    <SpacingHandles
      editor={editor}
      bands={[band("margin", "top", "10")]}
      subject={subjectWith()}
      context={BASE}
      onPreviewChange={onPreviewChange}
    />
  );
}

/** A harness whose editor refuses every op, as a document limit would. */
function RefusingHarness({
  bands,
}: {
  bands: readonly SpacingBand[];
}): React.JSX.Element {
  const editor = useEditorState({ initialDocument: documentWith() });
  live = editor;
  const refusing = React.useMemo(
    () => ({ ...editor, apply: () => null }) as EditorState,
    [editor]
  );
  return (
    <SpacingHandles
      editor={refusing}
      bands={bands}
      subject={subjectWith()}
      context={BASE}
    />
  );
}

/** A harness that can change which node the handles are about, mid-gesture. */
function TwoNodeHarness({ selected }: { selected: string }): React.JSX.Element {
  const initial = React.useMemo(
    () =>
      ({
        formatVersion: 1,
        kind: "page",
        nodes: [
          { id: "a", type: "acme/spaced", version: 1, props: {} },
          { id: "b", type: "acme/spaced", version: 1, props: {} },
        ],
      }) as unknown as BlockDocument,
    []
  );
  const editor = useEditorState({ initialDocument: initial });
  live = editor;
  return (
    <SpacingHandles
      editor={editor}
      bands={[band("margin", "top", "10")]}
      subject={subjectWith({ nodeId: selected })}
      context={BASE}
    />
  );
}

/** One handle, addressed the way assistive technology finds it. */
function handle(label: string): HTMLElement {
  return screen.getByRole("spinbutton", { name: label });
}

/** The node as the editor currently holds it. */
function storedNode(): BlockNode {
  const node = live?.document.nodes[0];
  if (node === undefined) throw new Error("no node in the document");
  return node;
}

/** What the document stores at one logical side, or `undefined`. */
function stored(property: string, side: string): unknown {
  return readStyleValue(storedNode().styles, {
    state: "base",
    breakpoint: "base",
    property,
    path: [side],
  });
}

/** Press, move through several positions, and release. */
function drag(
  element: HTMLElement,
  moves: readonly { x: number; y: number }[],
  modifiers: { shiftKey?: boolean; altKey?: boolean } = {}
): void {
  act(() => {
    fireEvent.pointerDown(element, {
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    });
  });
  for (const move of moves) {
    act(() => {
      fireEvent.pointerMove(element, {
        pointerId: 1,
        clientX: move.x,
        clientY: move.y,
        ...modifiers,
      });
    });
  }
  const last = moves.at(-1) ?? { x: 0, y: 0 };
  act(() => {
    fireEvent.pointerUp(element, {
      pointerId: 1,
      clientX: last.x,
      clientY: last.y,
      ...modifiers,
    });
  });
}

describe("one drag, one entry in the history", () => {
  /*
   * The acceptance criterion, asserted as a COUNT rather than as "an op
   * exists". A scrub that wrote the document on every pointer move produces
   * exactly the same final value and gives the author eleven presses of undo to
   * take one gesture back, so a test that only checked the value would pass on
   * the implementation this criterion exists to forbid.
   */
  it("costs ONE undo entry however many moves the pointer made", () => {
    mount([band("margin", "top", "10")]);
    expect(live?.undoDepth).toBe(0);

    drag(handle("top margin"), [
      { x: 0, y: -6 },
      { x: 0, y: -10 },
      { x: 0, y: -14 },
      { x: 0, y: -18 },
      { x: 0, y: -22 },
      { x: 0, y: -26 },
      { x: 0, y: -30 },
    ]);

    expect(live?.undoDepth).toBe(1);
  });

  it("writes nothing at all while the pointer is still down", () => {
    mount([band("margin", "top", "10")]);
    act(() => {
      fireEvent.pointerDown(handle("top margin"), {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
      });
    });
    act(() => {
      fireEvent.pointerMove(handle("top margin"), {
        pointerId: 1,
        clientX: 0,
        clientY: -30,
      });
    });

    expect(live?.undoDepth).toBe(0);
    expect(stored("margin", "blockStart")).toBeUndefined();
  });

  it("takes the whole gesture back in one undo", () => {
    mount([band("margin", "top", "10")]);
    drag(handle("top margin"), [
      { x: 0, y: -10 },
      { x: 0, y: -30 },
    ]);
    expect(stored("margin", "blockStart")).toBe("40px");

    act(() => {
      live?.undo();
    });
    expect(stored("margin", "blockStart")).toBeUndefined();
  });

  /*
   * A gesture that travels and comes back writes nothing. Without the value
   * layer's own comparison this would be an op that changes nothing, and undo
   * would then need a press to reverse an edit with no visible effect.
   */
  it("costs no entry when the drag ends where it began", () => {
    mount([band("margin", "top", "10")]);
    drag(handle("top margin"), [
      { x: 0, y: -30 },
      { x: 0, y: 0 },
    ]);
    expect(live?.undoDepth).toBe(0);
  });
});

describe("the stored document carries the value", () => {
  /*
   * Asserted against the DOCUMENT, never against the preview. A canvas-only
   * scrub looks identical in the editor and publishes an empty page, which is
   * the failure that cannot be seen by looking at the editor.
   */
  it("stores the dragged value at the logical side", () => {
    mount([band("margin", "top", "10")]);
    drag(handle("top margin"), [{ x: 0, y: -15 }]);
    expect(stored("margin", "blockStart")).toBe("25px");
  });

  it("stores a padding under the opposite sign, since its edge moves inward", () => {
    mount([band("padding", "top", "4")]);
    drag(handle("top padding"), [{ x: 0, y: 12 }]);
    expect(stored("padding", "blockStart")).toBe("16px");
  });

  it("keeps the other sides of the property untouched", () => {
    mount(
      [band("margin", "top", "10")],
      subjectWith(),
      documentWith({ base: { base: { margin: { inlineStart: "7px" } } } })
    );
    drag(handle("top margin"), [{ x: 0, y: -15 }]);
    expect(stored("margin", "blockStart")).toBe("25px");
    expect(stored("margin", "inlineStart")).toBe("7px");
  });
});

describe("the logical side a physical edge writes", () => {
  /*
   * The RTL case, at the level that matters: not that the mapping function
   * answers `inlineStart`, but that the DOCUMENT ends up with it. An overlay
   * that mapped correctly and then wrote the physical name would pass every
   * assertion in `spacing-drag.test.ts`.
   */
  it("writes the inline END when the left edge is dragged in a right-to-left block", () => {
    mount(
      [band("margin", "left", "10")],
      subjectWith({
        orientation: { writingMode: "horizontal-tb", direction: "rtl" },
      })
    );
    drag(handle("left margin"), [{ x: -5, y: 0 }]);

    expect(stored("margin", "inlineEnd")).toBe("15px");
    expect(stored("margin", "inlineStart")).toBeUndefined();
  });

  it("writes the inline START for the same edge in a left-to-right block", () => {
    mount([band("margin", "left", "10")]);
    drag(handle("left margin"), [{ x: -5, y: 0 }]);

    expect(stored("margin", "inlineStart")).toBe("15px");
    expect(stored("margin", "inlineEnd")).toBeUndefined();
  });

  /*
   * An unread orientation removes the handles rather than assuming
   * left-to-right. The live region survives, because it must be mounted before
   * it can ever announce anything.
   */
  it("offers no handle at all when the element's orientation cannot be read", () => {
    mount(
      [band("margin", "top", "10")],
      subjectWith({ orientation: undefined })
    );
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});

describe("Shift and Alt", () => {
  /*
   * The clobbering case. Four `styleWriteOp` calls built from one node each
   * carry a COMPLETE styles envelope, so applying them in sequence leaves only
   * the last side written — and the undo depth, the op count and the dragged
   * side's own value all look exactly right while three sides are missing. Every
   * side is asserted for that reason.
   */
  it("writes every side on Shift, and loses none of them", () => {
    mount([band("margin", "top", "10")]);
    drag(handle("top margin"), [{ x: 0, y: -20 }], { shiftKey: true });

    expect(stored("margin", "blockStart")).toBe("30px");
    expect(stored("margin", "blockEnd")).toBe("30px");
    expect(stored("margin", "inlineStart")).toBe("30px");
    expect(stored("margin", "inlineEnd")).toBe("30px");
  });

  it("still costs one undo entry with four sides written", () => {
    mount([band("margin", "top", "10")]);
    drag(handle("top margin"), [{ x: 0, y: -20 }], { shiftKey: true });
    expect(live?.undoDepth).toBe(1);
  });

  it("writes only the opposite pair on Alt", () => {
    mount([band("margin", "top", "10")]);
    drag(handle("top margin"), [{ x: 0, y: -20 }], { altKey: true });

    expect(stored("margin", "blockStart")).toBe("30px");
    expect(stored("margin", "blockEnd")).toBe("30px");
    expect(stored("margin", "inlineStart")).toBeUndefined();
    expect(stored("margin", "inlineEnd")).toBeUndefined();
  });

  /*
   * Each side moves by the same DELTA from its own start, rather than every
   * side landing on one value. Sides that began apart stay apart, which is what
   * makes the gesture reversible and what keeps a deliberate asymmetry from
   * being flattened by a modifier.
   */
  it("moves each side from its own start rather than equalising them", () => {
    mount(
      [band("margin", "top", "10")],
      subjectWith({ margin: { top: 10, right: 30, bottom: 10, left: 30 } })
    );
    drag(handle("top margin"), [{ x: 0, y: -20 }], { shiftKey: true });

    expect(stored("margin", "blockStart")).toBe("30px");
    expect(stored("margin", "inlineStart")).toBe("50px");
  });
});

describe("the keyboard path", () => {
  /*
   * WCAG 2.5.7 asks for a non-drag route to anything a drag can do, and the
   * assertion that matters is that it reaches the SAME value — a keyboard path
   * that moved the opposite way, or wrote the other side, satisfies "a path
   * exists" and is useless.
   */
  it("reaches the same value the drag reaches", () => {
    mount([band("margin", "top", "10")]);
    drag(handle("top margin"), [{ x: 0, y: -10 }]);
    const dragged = stored("margin", "blockStart");

    cleanup();
    mount([band("margin", "top", "10")]);
    // Ten presses for the drag's ten pixels. The step is deliberately finer
    // than the pointer can be: a drag cannot register a movement below the
    // activation threshold, so the keyboard reaches values the pointer cannot.
    for (let press = 0; press < 10; press += 1) {
      act(() => {
        fireEvent.keyDown(handle("top margin"), { key: "ArrowUp" });
      });
    }

    expect(stored("margin", "blockStart")).toBe(dragged);
    expect(dragged).toBe("20px");
  });

  /*
   * Up increases a top padding even though DRAGGING it upward decreases it.
   * These are spinbuttons, and the role's own keys have to mean more and less
   * consistently; the spatial reading survives on the horizontal bands, where
   * it agrees with the numeric one.
   */
  it("makes Up increase a padding, whichever way its handle is dragged", () => {
    mount([band("padding", "top", "4")]);
    act(() => {
      fireEvent.keyDown(handle("top padding"), { key: "ArrowUp" });
    });
    expect(stored("padding", "blockStart")).toBe("5px");
  });

  it("takes a coarse step on Page keys, leaving Shift to mean every side", () => {
    mount([band("margin", "top", "10")]);
    act(() => {
      fireEvent.keyDown(handle("top margin"), { key: "PageUp" });
    });
    expect(stored("margin", "blockStart")).toBe("20px");
  });

  it("applies Shift to the sides on the keyboard exactly as on the pointer", () => {
    mount([band("margin", "top", "10")]);
    act(() => {
      fireEvent.keyDown(handle("top margin"), {
        key: "ArrowUp",
        shiftKey: true,
      });
    });
    expect(stored("margin", "blockStart")).toBe("11px");
    expect(stored("margin", "inlineEnd")).toBe("11px");
  });

  it("ignores an arrow across the band's own axis", () => {
    mount([band("margin", "top", "10")]);
    act(() => {
      fireEvent.keyDown(handle("top margin"), { key: "ArrowLeft" });
    });
    expect(live?.undoDepth).toBe(0);
  });

  it("costs one undo entry per press", () => {
    mount([band("margin", "top", "10")]);
    act(() => {
      fireEvent.keyDown(handle("top margin"), { key: "ArrowUp" });
    });
    act(() => {
      fireEvent.keyDown(handle("top margin"), { key: "ArrowUp" });
    });
    expect(live?.undoDepth).toBe(2);
    expect(stored("margin", "blockStart")).toBe("12px");
  });
});

describe("values a pixel drag must not overwrite", () => {
  /*
   * A token is a live link to the design system. Committing the pixels it
   * resolves to today severs it with no visible change at the moment of the
   * drag — the page simply stops tracking the token from then on.
   */
  it("refuses to drag a side that holds a token, and says why", () => {
    mount(
      [band("margin", "top", "10")],
      subjectWith(),
      documentWith({
        base: { base: { margin: { blockStart: { $token: "space-4" } } } },
      })
    );
    drag(handle("top margin"), [{ x: 0, y: -20 }]);

    expect(live?.undoDepth).toBe(0);
    expect(stored("margin", "blockStart")).toEqual({ $token: "space-4" });
    expect(screen.getByRole("status").textContent).toMatch(/token/i);
  });

  it("refuses auto, which is how a block is centred", () => {
    mount(
      [band("margin", "left", "10")],
      subjectWith(),
      documentWith({ base: { base: { margin: { inlineStart: "auto" } } } })
    );
    drag(handle("left margin"), [{ x: -20, y: 0 }]);

    expect(live?.undoDepth).toBe(0);
    expect(stored("margin", "inlineStart")).toBe("auto");
  });

  it("starts from the node's own value rather than the used one", () => {
    mount(
      [band("margin", "top", "99")],
      subjectWith(),
      documentWith({ base: { base: { margin: { blockStart: "5px" } } } })
    );
    drag(handle("top margin"), [{ x: 0, y: -10 }]);
    expect(stored("margin", "blockStart")).toBe("15px");
  });
});

describe("where the pointer goes once the drag starts", () => {
  /*
   * The gesture is followed on the DOCUMENT, and this is the only test that can
   * tell. A handle is nine pixels thick and the activation threshold is four, so
   * by the time a drag means anything the pointer is usually off the strip and
   * the browser is delivering its moves to whatever is underneath. Every other
   * case here fires at the handle, which BUBBLES — so they pass against an
   * implementation that listens on the handle alone and is deadlocked in a real
   * browser: capture would keep the moves coming back, capture waits for
   * activation, and activation needs the moves that stopped arriving.
   *
   * Measured in Chromium before this test existed: the handle hit-tested
   * correctly, took the press, and no drag ever started.
   */
  it("keeps following a pointer that has left the handle", () => {
    mount([band("margin", "top", "10")]);
    const element = handle("top margin");
    act(() => {
      fireEvent.pointerDown(element, {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
      });
    });
    // Everything from here lands on the BODY, which is not inside the handle,
    // so nothing bound to the handle can see it.
    for (const y of [-8, -16, -24]) {
      act(() => {
        fireEvent.pointerMove(document.body, {
          pointerId: 1,
          clientX: 0,
          clientY: y,
        });
      });
    }
    act(() => {
      fireEvent.pointerUp(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -24,
      });
    });

    expect(stored("margin", "blockStart")).toBe("34px");
    expect(live?.undoDepth).toBe(1);
  });

  it("stops listening once the handles are gone", () => {
    mount([band("margin", "top", "10")]);
    act(() => {
      fireEvent.pointerDown(handle("top margin"), {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
      });
    });
    const editor = live;
    cleanup();
    // A gesture whose handles have been unmounted must not go on writing: the
    // overlay drops them on every selection change and at the start of a canvas
    // drag, and a listener left behind would commit against a node nobody is
    // editing.
    act(() => {
      fireEvent.pointerMove(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -40,
      });
      fireEvent.pointerUp(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -40,
      });
    });
    expect(editor?.undoDepth).toBe(0);
  });
});

describe("a side the gesture cannot write", () => {
  /** A document whose LEFT margin is a token, with the others plain. */
  const tokenOnTheLeft = () =>
    documentWith({
      base: { base: { margin: { inlineStart: { $token: "space-4" } } } },
    });

  /*
   * Shift promises every side. Writing the three that happen to be plain pixels
   * honours that partially and silently: the undo depth, the op count and the
   * grabbed side's own value all look right, and nothing says the fourth stayed
   * where it was.
   */
  it("refuses the whole gesture when Shift reaches a side it cannot write", () => {
    mount([band("margin", "top", "10")], subjectWith(), tokenOnTheLeft());
    drag(handle("top margin"), [{ x: 0, y: -20 }], { shiftKey: true });

    expect(live?.undoDepth).toBe(0);
    expect(stored("margin", "blockStart")).toBeUndefined();
    expect(stored("margin", "inlineStart")).toEqual({ $token: "space-4" });
    expect(screen.getByRole("status").textContent).toMatch(/token/i);
  });

  /*
   * And still allows the gesture that does not reach it. The refusal is about
   * the sides ASKED for, not about the box carrying an awkward value somewhere.
   */
  it("allows a gesture whose sides it can all write", () => {
    mount([band("margin", "top", "10")], subjectWith(), tokenOnTheLeft());
    drag(handle("top margin"), [{ x: 0, y: -20 }], { altKey: true });

    expect(stored("margin", "blockStart")).toBe("30px");
    expect(stored("margin", "blockEnd")).toBe("30px");
    expect(stored("margin", "inlineStart")).toEqual({ $token: "space-4" });
  });

  it("refuses on the keyboard for the same reason", () => {
    mount([band("margin", "top", "10")], subjectWith(), tokenOnTheLeft());
    act(() => {
      fireEvent.keyDown(handle("top margin"), {
        key: "ArrowUp",
        shiftKey: true,
      });
    });
    expect(live?.undoDepth).toBe(0);
  });
});

describe("the gesture's edges", () => {
  it("does nothing for a press that never passes the threshold", () => {
    mount([band("margin", "top", "10")]);
    drag(handle("top margin"), [
      { x: 0, y: -1 },
      { x: 0, y: -2 },
    ]);
    expect(live?.undoDepth).toBe(0);
  });

  it("abandons a drag on Escape without writing anything", () => {
    mount([band("margin", "top", "10")]);
    const element = handle("top margin");
    act(() => {
      fireEvent.pointerDown(element, {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
      });
    });
    act(() => {
      fireEvent.pointerMove(element, {
        pointerId: 1,
        clientX: 0,
        clientY: -30,
      });
    });
    act(() => {
      fireEvent.keyDown(element, { key: "Escape" });
    });
    act(() => {
      fireEvent.pointerUp(element, { pointerId: 1, clientX: 0, clientY: -30 });
    });

    expect(live?.undoDepth).toBe(0);
    expect(stored("margin", "blockStart")).toBeUndefined();
  });

  it("ignores a press that is not the primary button", () => {
    mount([band("margin", "top", "10")]);
    drag(handle("top margin"), [{ x: 0, y: -30 }]);
    const withPrimary = live?.undoDepth;

    cleanup();
    mount([band("margin", "top", "10")]);
    act(() => {
      fireEvent.pointerDown(handle("top margin"), {
        button: 2,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
      });
    });
    act(() => {
      fireEvent.pointerUp(handle("top margin"), {
        pointerId: 1,
        clientX: 0,
        clientY: -30,
      });
    });

    expect(withPrimary).toBe(1);
    expect(live?.undoDepth).toBe(0);
  });

  it("clamps a padding at zero rather than refusing a negative value", () => {
    mount([band("padding", "top", "4")]);
    drag(handle("top padding"), [{ x: 0, y: -50 }]);
    expect(stored("padding", "blockStart")).toBe("0px");
  });
});

describe("the gesture, when the pointer is not the only thing happening", () => {
  /*
   * The press calls `preventDefault`, which suppresses the browser's focus
   * action — so a drag begun on a handle that was not already focused leaves
   * focus elsewhere, and Escape never reaches the handle's own key handler.
   * Dispatched on the BODY here, which is where it would land.
   */
  it("cancels on Escape even when the handle never took focus", () => {
    mount([band("margin", "top", "10")]);
    act(() => {
      fireEvent.pointerDown(handle("top margin"), {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
      });
    });
    act(() => {
      fireEvent.pointerMove(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -30,
      });
    });
    expect(document.activeElement).not.toBe(handle("top margin"));

    act(() => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    act(() => {
      fireEvent.pointerUp(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -30,
      });
    });

    expect(live?.undoDepth).toBe(0);
    expect(stored("margin", "blockStart")).toBeUndefined();
  });

  /*
   * A second finger, or a pen beside a touch, also arrives with `button === 0`.
   * Accepted, it would replace the live gesture's band and starts while the
   * first pointer's listeners stayed installed — so the first pointer would go
   * on driving, writing the second gesture's side.
   */
  it("ignores a second pointer while one gesture is live", () => {
    mount([band("margin", "top", "10"), band("padding", "left", "4")]);
    act(() => {
      fireEvent.pointerDown(handle("top margin"), {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
      });
    });
    act(() => {
      fireEvent.pointerDown(handle("left padding"), {
        button: 0,
        pointerId: 2,
        clientX: 0,
        clientY: 0,
      });
    });
    // The FIRST pointer finishes its own gesture, on its own side.
    act(() => {
      fireEvent.pointerMove(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -20,
      });
    });
    act(() => {
      fireEvent.pointerUp(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -20,
      });
    });

    expect(stored("margin", "blockStart")).toBe("30px");
    expect(stored("padding", "inlineStart")).toBeUndefined();
    expect(live?.undoDepth).toBe(1);
  });
});

describe("a canvas painted at a zoom", () => {
  /**
   * Mount the handles inside a canvas root painted at half size.
   *
   * `paintedScale` reads `offsetWidth` against the measured rectangle, and jsdom
   * supplies neither — so both are stubbed. That makes this a test about the
   * CONVERSION rather than about layout: what is asserted is that pointer travel
   * is put through the canvas's own mapping before it becomes a value, not that
   * jsdom laid anything out.
   */
  function mountScaled(bands: readonly SpacingBand[]): void {
    const { container } = render(
      <div className={CANVAS_ROOT_CLASS}>
        <Harness
          bands={bands}
          subject={subjectWith()}
          context={BASE}
          initial={documentWith()}
        />
      </div>
    );
    const root = container.querySelector(`.${CANVAS_ROOT_CLASS}`);
    if (root === null) throw new Error("no canvas root");
    Object.defineProperty(root, "offsetWidth", { value: 1000 });
    Object.defineProperty(root, "offsetHeight", { value: 1000 });
    root.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 500, height: 500, top: 0, left: 0 }) as DOMRect;
  }

  /*
   * The band rectangles need no zoom factor — they are children of the root and
   * are drawn through its transform already, which is why `renderedScale` stops
   * below it. The POINTER does: its coordinates come from the screen. Left
   * unconverted a half-size canvas moves the value half as far as the handle
   * under the hand, and it is invisible at 100% zoom, which is where a drag is
   * usually tried.
   */
  it("moves the value by the canvas distance, not the screen distance", () => {
    mountScaled([band("margin", "top", "10")]);
    drag(handle("top margin"), [{ x: 0, y: -10 }]);
    // Ten pixels of hand on a half-size canvas is twenty pixels of page.
    expect(stored("margin", "blockStart")).toBe("30px");
  });

  /*
   * The THRESHOLD stays in client pixels. Whether a press was meant as a drag is
   * a property of the hand; converted into canvas pixels it would shrink with
   * the zoom, and a zoomed-out editor would start drags on a click.
   */
  it("still measures the activation threshold against the hand", () => {
    mountScaled([band("margin", "top", "10")]);
    // Three client pixels is below the four-pixel threshold, and would be six
    // canvas pixels if the threshold were measured after the conversion.
    drag(handle("top margin"), [{ x: 0, y: -3 }]);
    expect(live?.undoDepth).toBe(0);
  });
});

describe("the preview and the commit agree about what is possible", () => {
  /*
   * The preview honours the same refusal the commit does. Without it the canvas
   * shows three sides moving under Shift and takes them all back on release —
   * an edit that was never available, withdrawn at the moment the author lets
   * go, with the reason arriving only afterwards.
   */
  it("previews nothing when the gesture reaches a side it cannot write", () => {
    mount(
      [band("margin", "top", "10")],
      subjectWith(),
      documentWith({
        base: { base: { margin: { inlineStart: { $token: "space-4" } } } },
      })
    );
    const element = handle("top margin");
    act(() => {
      fireEvent.pointerDown(element, {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
      });
    });
    act(() => {
      fireEvent.pointerMove(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -20,
        shiftKey: true,
      });
    });
    expect(previewRules()).toHaveLength(0);

    // And still previews the gesture it CAN commit.
    act(() => {
      fireEvent.pointerMove(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -24,
      });
    });
    expect(previewRules().length).toBeGreaterThan(0);
  });
});

describe("re-measuring while a preview is applied", () => {
  /*
   * The overlay's style watcher ignores every mutation inside its own layer, so
   * that drawing the bands cannot schedule the next measurement. The scrub
   * preview is a `<style>` in that layer and is invisible to it by the same
   * rule, and `ResizeObserver` reports size rather than position — so nothing
   * would re-measure, and a block would slide out from under a band and a value
   * chip left at the coordinates the gesture began with.
   */
  it("asks for a measurement when the preview changes, and again when it clears", () => {
    const asked: number[] = [];
    render(<HarnessWithPreviewSpy onPreviewChange={() => asked.push(1)} />);
    const element = screen.getByRole("spinbutton", { name: "top margin" });
    const before = asked.length;
    act(() => {
      fireEvent.pointerDown(element, {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
      });
    });
    act(() => {
      fireEvent.pointerMove(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -20,
      });
    });
    const withPreview = asked.length;
    expect(withPreview).toBeGreaterThan(before);

    act(() => {
      fireEvent.pointerUp(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -20,
      });
    });
    expect(asked.length).toBeGreaterThan(withPreview);
  });
});

describe("where the handle sits on its band", () => {
  /*
   * Geometry, but not LAYOUT: these are the inline coordinates the component
   * writes, which jsdom reports faithfully because they were never measured. The
   * rendered result is a browser question and is checked there.
   */
  function positioned(band: SpacingBand): { top: string; height: string } {
    mount([band]);
    const style = handle(`${band.side} ${band.box}`).style;
    return { top: style.top, height: style.height };
  }

  const rect = { x: 0, y: 100, width: 50, height: 20 };

  it("puts a positive top margin's handle on the outer edge", () => {
    // The band spans 100..120 and grows upward, so its moving edge is y=100.
    const { top, height } = positioned({
      box: "margin",
      side: "top",
      rect,
      label: "20",
      negative: false,
    });
    expect(height).toBe("9px");
    expect(top).toBe("95.5px");
  });

  /*
   * A negative margin's band is laid INSIDE the border edge, because that is
   * where the space it removes is — so the edge that moves is the opposite one.
   * Ignoring `band.negative` puts the control on the one edge of that band which
   * never moves.
   */
  it("puts a negative top margin's handle on the inward edge instead", () => {
    const { top } = positioned({
      box: "margin",
      side: "top",
      rect,
      label: "-20",
      negative: true,
    });
    expect(top).toBe("115.5px");
  });

  it("puts a padding's handle on its inward edge", () => {
    const { top } = positioned({
      box: "padding",
      side: "top",
      rect,
      label: "20",
      negative: false,
    });
    expect(top).toBe("115.5px");
  });
});

describe("a gesture that outlives its own band", () => {
  /*
   * `spacingBands` draws nothing for a side reporting `0`. Dragging a padding to
   * its floor therefore makes the re-measure drop that band and unmount the very
   * handle the pointer is captured on — the browser releases capture, the later
   * moves and the release stop arriving, and the gesture is stranded with a live
   * preview and nothing committed.
   */
  it("keeps the handle mounted after its band stops being drawn", () => {
    const bands = [band("padding", "top", "4")];
    const { rerender } = render(
      <Harness
        bands={bands}
        subject={subjectWith()}
        context={BASE}
        initial={documentWith()}
      />
    );
    act(() => {
      fireEvent.pointerDown(handle("top padding"), {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
      });
    });
    // The measurement that follows a preview finds nothing to draw.
    rerender(
      <Harness
        bands={[]}
        subject={subjectWith()}
        context={BASE}
        initial={documentWith()}
      />
    );
    const kept = screen.queryByRole("spinbutton", { name: "top padding" });
    expect(kept).not.toBeNull();
    /*
     * At the edge it collapsed TO, not the one it started from. The band is
     * missing precisely because the drag took it to zero, so its old rectangle
     * describes a value that no longer exists — for a large padding the handle
     * would sit visibly far from the pointer while reporting the old number to
     * assistive technology for the rest of the gesture.
     */
    expect(kept?.getAttribute("aria-valuenow")).toBe("0");
    // The band spans y=0..10 and grows downward, so collapsed it sits at y=0.
    expect(kept?.style.top).toBe("-4.5px");

    // And the gesture still finishes.
    act(() => {
      fireEvent.pointerMove(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: 20,
      });
    });
    act(() => {
      fireEvent.pointerUp(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: 20,
      });
    });
    expect(stored("padding", "blockStart")).toBe("24px");

    // Once it is over, an undrawn band takes its handle with it.
    rerender(
      <Harness
        bands={[]}
        subject={subjectWith()}
        context={BASE}
        initial={documentWith()}
      />
    );
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  });

  it("ignores a cancellation belonging to another pointer", () => {
    mount([band("margin", "top", "10")]);
    act(() => {
      fireEvent.pointerDown(handle("top margin"), {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
      });
    });
    act(() => {
      fireEvent.pointerMove(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -20,
      });
    });
    // A second finger is cancelled. It says nothing about this gesture.
    act(() => {
      fireEvent.pointerCancel(document.body, { pointerId: 2 });
    });
    act(() => {
      fireEvent.pointerUp(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -20,
      });
    });
    expect(stored("margin", "blockStart")).toBe("30px");
  });
});

describe("a document that moves while the pointer is down", () => {
  /*
   * A style op patches the WHOLE envelope. Built from the snapshot the gesture
   * began with, releasing would carry every declaration that snapshot held and
   * silently undo whatever happened in between — the editor's own undo shortcut
   * during a drag is enough to reach it.
   */
  it("folds the gesture into the envelope the node holds at release", () => {
    mount([band("margin", "top", "10")]);
    act(() => {
      fireEvent.pointerDown(handle("top margin"), {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
      });
    });
    act(() => {
      fireEvent.pointerMove(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -20,
      });
    });
    // Another edit lands mid-gesture, on a side this drag never touches.
    act(() => {
      live?.apply({
        kind: "update",
        id: NODE_ID,
        patch: {
          styles: { base: { base: { margin: { inlineEnd: "7px" } } } },
        },
      });
    });
    act(() => {
      fireEvent.pointerUp(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -20,
      });
    });

    expect(stored("margin", "blockStart")).toBe("30px");
    // The mid-gesture edit survives rather than being erased by a stale patch.
    expect(stored("margin", "inlineEnd")).toBe("7px");
  });
});

describe("two handles that would land on the same pixels", () => {
  /*
   * A negative margin's band is laid inside the border edge, where padding's
   * band is too — so `margin-top: -16px` beside `padding-top: 16px` produces two
   * identical rectangles. Same stacking, padding drawn later: it takes every
   * press, and the margin's handle is advertised and unreachable by pointer.
   */
  it("separates a negative margin's handle from a coincident padding one", () => {
    const rect = { x: 0, y: 100, width: 50, height: 16 };
    mount([
      { box: "margin", side: "top", rect, label: "-16", negative: true },
      { box: "padding", side: "top", rect, label: "16", negative: false },
    ]);
    const marginTop = handle("top margin").style.top;
    const paddingTop = handle("top padding").style.top;
    expect(marginTop).not.toBe(paddingTop);
  });

  it("leaves handles that do not coincide where they were", () => {
    mount([
      {
        box: "margin",
        side: "top",
        rect: { x: 0, y: 80, width: 50, height: 20 },
        label: "20",
        negative: false,
      },
      {
        box: "padding",
        side: "top",
        rect: { x: 0, y: 100, width: 50, height: 16 },
        label: "16",
        negative: false,
      },
    ]);
    // The margin's own outer edge, untouched: 80 - 4.5.
    expect(handle("top margin").style.top).toBe("75.5px");
  });
});

describe("an edit the editor will not take", () => {
  /*
   * `editor.apply` answers `null` when the op is refused — a document limit, for
   * instance. Announcing the new value there tells a screen-reader user an edit
   * landed while the canvas snaps back to what it was.
   */
  it("reports a refusal rather than announcing the value", () => {
    render(<RefusingHarness bands={[band("margin", "top", "10")]} />);
    drag(handle("top margin"), [{ x: 0, y: -20 }]);

    expect(stored("margin", "blockStart")).toBeUndefined();
    expect(screen.getByRole("status").textContent).toMatch(/not applied/i);
  });
});

describe("a gesture whose subject changes underneath it", () => {
  /*
   * The component is not keyed on the node, so selecting another block mid-drag
   * re-renders it in place while the listeners installed at the press keep
   * running. The styles read at release would then be the NEW block's whole
   * envelope inside an op naming the OLD one — one block's styling copied over
   * another's.
   */
  it("abandons the gesture rather than committing across blocks", () => {
    const { rerender } = render(<TwoNodeHarness selected="a" />);
    act(() => {
      fireEvent.pointerDown(handle("top margin"), {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
      });
    });
    act(() => {
      fireEvent.pointerMove(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -20,
      });
    });
    rerender(<TwoNodeHarness selected="b" />);
    act(() => {
      fireEvent.pointerUp(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -20,
      });
    });

    expect(live?.undoDepth).toBe(0);
  });
});

describe("what the block's author allows", () => {
  /*
   * `supports` is the block author's capability declaration, and the Style
   * panel derives its writable properties from it. A handle that ignored it
   * would offer on the canvas exactly the edit the panel beside it withholds.
   */
  it("withholds a handle for a box the block does not offer", () => {
    mount(
      [band("margin", "top", "10"), band("padding", "left", "4")],
      subjectWith(),
      documentWith(undefined, "acme/margin-only")
    );
    expect(
      screen.queryByRole("spinbutton", { name: "top margin" })
    ).not.toBeNull();
    expect(
      screen.queryByRole("spinbutton", { name: "left padding" })
    ).toBeNull();
  });

  it("withholds every handle for a block declaring no spacing", () => {
    mount(
      [band("margin", "top", "10"), band("padding", "left", "4")],
      subjectWith(),
      documentWith(undefined, "acme/plain")
    );
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  });
});

describe("the modifiers a commit is judged by", () => {
  /*
   * Letting go of Shift before letting go of the button is an ordinary way to
   * end a gesture. Reading the release event's modifiers commits an edit the
   * canvas never showed — one side after previewing four, or the reverse — and
   * nothing about the result says which the author meant.
   */
  it("commits what the last preview showed, not what the release said", () => {
    mount([band("margin", "top", "10")]);
    const element = handle("top margin");
    act(() => {
      fireEvent.pointerDown(element, {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
      });
    });
    // The last MOVE is the one the author saw: Shift held, four sides.
    act(() => {
      fireEvent.pointerMove(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -20,
        shiftKey: true,
      });
    });
    // Shift released a moment before the button, which the release reports.
    act(() => {
      fireEvent.pointerUp(document.body, {
        pointerId: 1,
        clientX: 0,
        clientY: -20,
        shiftKey: false,
      });
    });

    expect(stored("margin", "blockStart")).toBe("30px");
    expect(stored("margin", "inlineStart")).toBe("30px");
    expect(stored("margin", "inlineEnd")).toBe("30px");
    expect(stored("margin", "blockEnd")).toBe("30px");
  });
});

describe("what the handle exposes", () => {
  it("is focusable and names its side and box", () => {
    mount([band("margin", "top", "10"), band("padding", "left", "4")]);
    expect(handle("top margin").getAttribute("tabindex")).toBe("0");
    expect(handle("left padding").getAttribute("tabindex")).toBe("0");
  });

  /*
   * The bands stay hidden from assistive technology and the handles must not
   * be: a focusable element inside an `aria-hidden` subtree is reachable by
   * keyboard while a screen reader is told it is not there.
   */
  it("is not hidden from assistive technology", () => {
    mount([band("margin", "top", "10")]);
    expect(handle("top margin").closest("[aria-hidden='true']")).toBeNull();
  });

  /*
   * The value is in the NAME, and no ARIA range is claimed. `role="slider"`
   * would default `aria-valuemin`/`aria-valuemax` to 0 and 100 whether or not
   * they are given, so every negative margin and every value over a hundred —
   * both of which the catalog allows — would be reported as outside the
   * control's own bounds. Stating bounds instead would mean inventing two
   * numbers the catalog does not have.
   */
  /*
   * Named AND adjustable. A bare `div` keeps the generic role, for which naming
   * is prohibited, so `aria-label` on one is not exposed and the control reaches
   * a keyboard user unnamed.
   */
  it("is an adjustable control that names itself and its value", () => {
    mount([band("margin", "top", "10"), band("padding", "left", "4")]);
    expect(handle("top margin").getAttribute("aria-valuetext")).toBe(
      "10 pixels"
    );
    expect(handle("left padding").getAttribute("aria-valuenow")).toBe("4");
  });

  /*
   * A spinbutton's bounds are optional and undefined when absent, which is the
   * truth here: the catalog admits a negative margin and neither box has a
   * ceiling. A slider would have defaulted them to 0 and 100 and reported both
   * ends of the real range as invalid.
   */
  it("claims no range it cannot honour", () => {
    mount([band("margin", "top", "-12")]);
    const element = handle("top margin");
    expect(element.getAttribute("aria-valuenow")).toBe("-12");
    for (const attribute of ["aria-valuemin", "aria-valuemax"]) {
      expect(element.getAttribute(attribute), attribute).toBeNull();
    }
  });
});
