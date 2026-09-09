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

import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

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

afterEach(cleanup);

const NODE_ID = "a";

function documentWith(styles?: BlockNode["styles"]): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: NODE_ID,
        type: "core/box",
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

function handle(label: string): HTMLElement {
  return screen.getByRole("slider", { name: label });
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
    expect(screen.queryAllByRole("slider")).toHaveLength(0);
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

  it("runs the padding key the same way the padding drag runs", () => {
    mount([band("padding", "top", "4")]);
    act(() => {
      fireEvent.keyDown(handle("top padding"), { key: "ArrowDown" });
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

  it("reports the current value, and a floor only where one exists", () => {
    mount([band("margin", "top", "10"), band("padding", "left", "4")]);
    expect(handle("top margin").getAttribute("aria-valuenow")).toBe("10");
    expect(handle("top margin").getAttribute("aria-valuemin")).toBeNull();
    expect(handle("left padding").getAttribute("aria-valuemin")).toBe("0");
  });
});
