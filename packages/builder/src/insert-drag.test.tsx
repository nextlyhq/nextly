// @vitest-environment jsdom

/**
 * Dragging a block from the palette onto the canvas.
 *
 * The property under test is not "a block appears". It is that the palette and
 * the canvas share ONE drag engine, and the observable that separates a shared
 * engine from a second, parallel one is the SHAPE of the edit rather than its
 * result: exactly one op, written at the release, never before it. A fork that
 * inserted a provisional node at drag-start and moved it would look identical
 * on screen and leave two entries on the undo stack.
 *
 * So `undoDepth` is asserted across the whole gesture rather than at the end,
 * and the switch rule and Escape are exercised from a palette-origin drag
 * specifically — each is invisible by default, and a second implementation has
 * no reason to reproduce any of them.
 *
 * **Rectangles are stubbed, as jsdom reports every element as zero-sized.** The
 * geometry itself is pure and asserted in `drop-targets.test.ts`; what is real
 * here is the gesture.
 *
 * @module insert-drag.test
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  registerBlocks,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

import { Canvas, CANVAS_ROOT_CLASS } from "./canvas";
import { DEFAULT_SWITCH_PX, DropIndicator, useCanvasDrag } from "./canvas-drag";
import { useEditorState, type EditorState } from "./editor-state";
import { registrySlotSource } from "./inserter";

afterEach(async () => {
  // Let a pending click-suppression teardown run before the next case starts.
  // The suppressor is installed for ONE task, on purpose, but vitest runs these
  // cases synchronously back to back — so without this, a suppressor armed by
  // one release eats the NEXT case's click and an assertion of `clicks === 0`
  // passes for the wrong reason. That is not hypothetical: it hid a broken fix
  // from its own break-verification.
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  cleanup();
  clearBlocks();
  captured = [];
  built = 0;
  inserted = [];
  clicks = 0;
  buildsType = "test/heading";
});

/** Pointer ids anything took capture of, so a palette drag can assert none. */
let captured: number[] = [];
/** How many times the palette was asked to build its node. */
let built = 0;
/** Node ids the host was notified about, in order. */
let inserted: string[] = [];
/** How many times the row's own click-to-insert handler ran. */
let clicks = 0;
/** What the palette's thunk answers with, so a test can make it disagree. */
let buildsType = "test/heading";

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.setPointerCapture = function setPointerCapture(id: number): void {
    captured.push(id);
  };
  element.releasePointerCapture = function releasePointerCapture(): void {};
  element.hasPointerCapture = function hasPointerCapture(): boolean {
    return true;
  };
  element.scrollIntoView = function scrollIntoView(): void {};
});

const BLOCKS: AnyBlockDefinition[] = [
  {
    name: "test/heading",
    version: 1,
    description: "A heading.",
    example: { props: {} },
    editor: { label: "Heading" },
    render: () => React.createElement("h2", null, "heading"),
  },
];

function node(id: string, type: string): BlockNode {
  return { id, type, version: 1, props: {} };
}

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes };
}

let editorRef: EditorState | null = null;
/** What the hook reported on the last render, for the drag-state assertions. */
let dragState: { draggingId: string | null; draggingBlockName: string | null } =
  { draggingId: null, draggingBlockName: null };

/** The id the palette's thunk gives whatever it builds. */
const INSERTED = "brand-new";

/**
 * A host that mounts the canvas AND a palette row, which is the composition
 * this feature only exists inside.
 *
 * The row is an ordinary button rather than the real `InsertPanel`: what is
 * under test is the engine's entry point, and mounting the panel would drag in
 * cmdk's filtering and the registry catalog to reach the same `beginInsertDrag`
 * call by a longer route.
 */
function Host({ document: doc }: { document: BlockDocument }) {
  const editor = useEditorState({ initialDocument: doc });
  editorRef = editor;
  const shell = React.useRef<HTMLDivElement | null>(null);
  const canvasRoot = React.useRef<HTMLElement | null>(null);

  // Resolved after paint, because the root is rendered by `Canvas` rather than
  // by this component: there is no ref to forward without changing that
  // component's public shape to serve a test.
  React.useEffect(() => {
    canvasRoot.current =
      shell.current?.querySelector<HTMLElement>(`.${CANVAS_ROOT_CLASS}`) ??
      null;
  });

  const drag = useCanvasDrag({
    editor,
    slots: registrySlotSource(),
    nesting: { parentsOf: () => undefined, slotAllowOf: () => undefined },
    canvasRoot,
  });
  dragState = {
    draggingId: drag.draggingId,
    draggingBlockName: drag.draggingBlockName,
  };

  return (
    <div ref={shell}>
      <button
        type="button"
        data-testid="palette-row"
        // The row inserts on click, as the real palette row does. That path is
        // the non-drag alternative and must keep working — and it is what a
        // drag ending on this row would trigger a second time.
        onClick={() => {
          clicks += 1;
        }}
        onPointerDown={event =>
          drag.beginInsertDrag(event, {
            blockName: "test/heading",
            makeNode: () => {
              built += 1;
              return node(INSERTED, buildsType);
            },
            onInserted: n => {
              inserted.push(n.id);
            },
          })
        }
      >
        Heading
      </button>
      <Canvas
        document={editor.document}
        // `false` is the documented way to say a render wants NO site styles.
        // An invented object would be a fixture that does not satisfy the
        // contract it is passed under, which is the shape this file exists to
        // avoid asserting through.
        siteStyles={false}
        selectedId={editor.selectedId}
        onSelect={editor.select}
        dragHandlers={drag.handlers}
        overlay={<DropIndicator target={drag.target} />}
      />
    </div>
  );
}

function layout(container: HTMLElement, heights: Record<string, number>): void {
  const root = container.querySelector<HTMLElement>(`.${CANVAS_ROOT_CLASS}`);
  if (root === null) throw new Error("no canvas root rendered");
  root.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 400, height: 1000, top: 0, left: 0 }) as DOMRect;

  let top = 0;
  root
    .querySelectorAll<HTMLElement>(`[${NODE_ID_ATTRIBUTE}]`)
    .forEach(element => {
      const id = element.getAttribute(NODE_ID_ATTRIBUTE) ?? "";
      const height = heights[id] ?? 100;
      const box = { x: 0, y: top, width: 400, height, top, left: 0 } as DOMRect;
      element.getBoundingClientRect = () => box;
      top += height;
    });
}

/** Two stacked blocks: 0-100 and 100-200. */
function renderTwo() {
  registerBlocks(BLOCKS, { source: "insert-drag-test" });
  const result = render(
    <Host
      document={documentOf([
        node("a", "test/heading"),
        node("b", "test/heading"),
      ])}
    />
  );
  layout(result.container, { a: 100, b: 100 });
  const row = result.getByTestId("palette-row");
  return { ...result, row };
}

/** The canvas root, which carries the drag's OWN React handlers. */
function canvasRootOf(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>(`.${CANVAS_ROOT_CLASS}`);
  if (root === null) throw new Error("no canvas root rendered");
  return root;
}

function pressRow(row: HTMLElement, x: number, y: number): void {
  fireEvent.pointerDown(row, {
    button: 0,
    pointerId: 7,
    clientX: x,
    clientY: y,
  });
}

/**
 * Moves and releases go to the DOCUMENT, which is the point.
 *
 * A palette drag is followed there because the row is not an ancestor of the
 * canvas. Firing these at the canvas root would pass against an engine that
 * never registered a document listener at all, and the gesture would be
 * untestable in the one arrangement it actually runs in.
 */
function moveTo(x: number, y: number, pointerId = 7): void {
  fireEvent.pointerMove(document, { pointerId, clientX: x, clientY: y });
}

function release(x: number, y: number, pointerId = 7): void {
  fireEvent.pointerUp(document, { pointerId, clientX: x, clientY: y });
}

function ids(): string[] {
  return (editorRef?.document.nodes ?? []).map(n => n.id);
}

describe("dragging a block from the palette onto the canvas", () => {
  it("commits ONE insert, at the release, where the line was drawn", () => {
    const { container } = renderTwo();
    expect(editorRef?.undoDepth).toBe(0);

    pressRow(container.ownerDocument.body.querySelector("button")!, 300, 500);
    // Past DEFAULT_ACTIVATION_PX, into the lower half of the first block, which
    // is the position after it.
    moveTo(200, 90);

    // The gesture is live and has NOT touched the document. This is the
    // assertion a provisional-insert implementation fails.
    expect(dragState.draggingBlockName).toBe("test/heading");
    expect(ids()).toEqual(["a", "b"]);
    expect(editorRef?.undoDepth).toBe(0);
    expect(built).toBe(0);

    release(200, 90);

    expect(ids()).toEqual(["a", INSERTED, "b"]);
    // Exactly one, and it is the whole point: two would mean the node was
    // materialised early and moved into place.
    expect(editorRef?.undoDepth).toBe(1);
    expect(built).toBe(1);
  });

  it("selects what it just inserted, against a real editor", () => {
    // The regression this file exists to cover. `select` resolves against the
    // document `apply` has just published, so asserting that select was CALLED
    // — which is all a mocked editor can see — passes whether or not the
    // selection ever lands.
    const { container } = renderTwo();
    pressRow(container.ownerDocument.body.querySelector("button")!, 300, 500);
    moveTo(200, 90);
    release(200, 90);

    expect(editorRef?.selectedId).toBe(INSERTED);
  });

  it("edits nothing when the press never travels far enough to be a drag", () => {
    // The click-to-insert path is the WCAG 2.2 SC 2.5.7 alternative and must
    // survive: a press that stays a click has to reach the row's own handler
    // rather than being consumed as a zero-length drag.
    const { container } = renderTwo();

    pressRow(container.ownerDocument.body.querySelector("button")!, 300, 500);
    moveTo(301, 501);
    release(301, 501);

    expect(ids()).toEqual(["a", "b"]);
    expect(editorRef?.undoDepth).toBe(0);
    expect(built).toBe(0);
  });

  it("never captures the pointer, so the row's own click still resolves", () => {
    // Capture would retarget the click to the capturing element, and the
    // palette row inserts on click — so capturing here would make every release
    // anywhere report a click on the row.
    const { container } = renderTwo();
    pressRow(container.ownerDocument.body.querySelector("button")!, 300, 500);
    moveTo(200, 90);

    expect(captured).toEqual([]);

    release(200, 90);
  });

  it("holds the committed target until the pointer travels past the switch band", () => {
    // Hysteresis, exercised from a palette-origin drag. Nothing about "insert
    // on drop" requires it, so a second engine written for the panel would not
    // have it — which is what makes this a same-engine assertion rather than a
    // behavioural nicety.
    //
    // Asserted through WHAT THE RELEASE COMMITS rather than through the
    // indicator's style attribute. The style is a position in pixels, and two
    // different insertion points can round to one string, so a held target and
    // a switched one are not reliably distinguishable there — an earlier
    // version of this case asserted exactly that and survived deleting the
    // band, proving nothing.
    const { container } = renderTwo();
    pressRow(container.ownerDocument.body.querySelector("button")!, 300, 500);

    // Below the second block's midpoint (150), so the committed target is the
    // position AFTER it.
    moveTo(200, 154);
    expect(dragState.draggingBlockName).toBe("test/heading");

    // Back across that midpoint, but by less than the band. The rival position
    // — before the second block — is what an engine without hysteresis would
    // commit to here.
    const nudge = DEFAULT_SWITCH_PX - 2;
    moveTo(200, 154 - nudge);
    release(200, 154 - nudge);

    // Held: the block lands where the pointer settled, not where it flicked.
    expect(ids()).toEqual(["a", "b", INSERTED]);
  });

  it("Escape abandons the drag without editing the document", () => {
    // Escape is listened for on the document and gated on a drag being in
    // flight. An insert-drag has NO node, so a gate written against the
    // dragged node's id leaves exactly this gesture uncancellable.
    const { container } = renderTwo();
    pressRow(container.ownerDocument.body.querySelector("button")!, 300, 500);
    moveTo(200, 90);
    expect(dragState.draggingBlockName).toBe("test/heading");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(dragState.draggingBlockName).toBeNull();
    expect(ids()).toEqual(["a", "b"]);
    expect(editorRef?.undoDepth).toBe(0);

    // And the abandoned gesture is really over: a release afterwards must not
    // commit the target it had settled on.
    release(200, 90);
    expect(ids()).toEqual(["a", "b"]);
    expect(editorRef?.undoDepth).toBe(0);
  });

  it("reports no dragged NODE id, because an insert has none yet", () => {
    // The discriminating half of the drag state. A block being dragged from the
    // palette addresses nothing in the document, and an id invented to fill
    // this field would be handed to anything drawing the dragged node.
    const { container } = renderTwo();
    pressRow(container.ownerDocument.body.querySelector("button")!, 300, 500);
    moveTo(200, 90);

    expect(dragState.draggingId).toBeNull();
    expect(dragState.draggingBlockName).toBe("test/heading");

    release(200, 90);
  });

  it("is driven only by the pointer that began it", () => {
    // The node-origin path gets this free from pointer capture, which retargets
    // one pointer. A palette drag takes no capture on purpose, so its document
    // listeners see every active pointer on a touch device.
    const { container } = renderTwo();
    const row = container.ownerDocument.body.querySelector("button")!;

    pressRow(row, 300, 500);
    moveTo(200, 154);
    expect(dragState.draggingBlockName).toBe("test/heading");

    // A SECOND finger moves somewhere else and lifts. Neither may touch this
    // gesture: the moves would re-aim it, and the release would commit the
    // first finger's target while that finger is still down.
    //
    // TWO moves, and the second is not padding. The switch rule anchors travel
    // at the moment a rival target first appears, so a single event always has
    // zero travel and can never switch the committed target — a one-move probe
    // passes whether or not the pointer is checked, which is what an earlier
    // version of this case did. A finger that is actually dragging produces a
    // stream, and this is the shortest stream that could do damage.
    moveTo(200, 20, 9);
    moveTo(200, 40, 9);
    release(200, 40, 9);

    expect(ids()).toEqual(["a", "b"]);
    expect(editorRef?.undoDepth).toBe(0);
    expect(dragState.draggingBlockName).toBe("test/heading");

    // The owning pointer still ends it, at the target IT settled on — which is
    // also the control showing the second finger did not silently re-aim.
    release(200, 154);
    expect(ids()).toEqual(["a", "b", INSERTED]);
    expect(editorRef?.undoDepth).toBe(1);
  });

  it("ignores another pointer arriving through the CANVAS, not the document", () => {
    // The other transport, and the one a second finger actually uses when it
    // is over the canvas: those events reach the drag through `Canvas`'s React
    // handlers, never the document listeners. A guard living only in the
    // document closures leaves this route open, and a test that dispatches the
    // rogue pointer at `document` cannot tell the two apart.
    const { container, row } = renderTwo();
    pressRow(row, 300, 500);
    moveTo(200, 154);
    expect(dragState.draggingBlockName).toBe("test/heading");

    const canvas = canvasRootOf(container);
    // Two moves, because the switch rule anchors travel when a rival target
    // first appears — one event always has zero travel and could never move
    // the committed target, whatever the guard did.
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 200, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 200, clientY: 40 });
    fireEvent.pointerUp(canvas, { pointerId: 9, clientX: 200, clientY: 40 });

    expect(ids()).toEqual(["a", "b"]);
    expect(editorRef?.undoDepth).toBe(0);

    // The owning pointer still ends it, at the target IT settled on — the
    // control showing the second finger did not silently re-aim.
    release(200, 154);
    expect(ids()).toEqual(["a", "b", INSERTED]);
  });

  it("keeps the click suppressed until the pointer is released, however late", async () => {
    // Escape is pressed with the finger still down, so the release — and the
    // click the browser builds from that press and release — arrives in a LATER
    // task. A suppressor armed for one task is gone by then, and the row's own
    // handler inserts a block from a drag the author visibly cancelled.
    const { row } = renderTwo();
    pressRow(row, 300, 500);
    moveTo(200, 90);
    fireEvent.keyDown(document, { key: "Escape" });

    // The task boundary is the whole point. Firing keydown, pointerup and click
    // in one task passes whether or not the suppression survives.
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });

    release(300, 500);
    fireEvent.click(row);

    expect(clicks).toBe(0);
    expect(ids()).toEqual(["a", "b"]);
    expect(editorRef?.undoDepth).toBe(0);
  });

  it("tells the host what landed, the same way the click path does", () => {
    const { row } = renderTwo();
    pressRow(row, 300, 500);
    moveTo(200, 90);
    release(200, 90);

    expect(ids()).toEqual(["a", INSERTED, "b"]);
    expect(inserted).toEqual([INSERTED]);
  });

  it("tells the host nothing when the drop was refused", () => {
    // The must-differ half: a notification that fired regardless would report
    // an insert that never happened, which is worse than not reporting.
    const { row } = renderTwo();
    buildsType = "test/some-other-block";
    pressRow(row, 300, 500);
    moveTo(200, 90);
    release(200, 90);

    expect(built).toBe(1);
    expect(ids()).toEqual(["a", "b"]);
    expect(inserted).toEqual([]);
  });

  it("declines a node whose type is not the one the drop was resolved for", () => {
    // The position and the nesting verdict were computed for the ADVERTISED
    // type. A node of some other type was never asked about, and the op layer
    // checks structural shape rather than the nesting rule — so nothing
    // downstream would notice it landing somewhere its type forbids.
    const { container } = renderTwo();
    const row = container.ownerDocument.body.querySelector("button")!;
    buildsType = "test/some-other-block";

    pressRow(row, 300, 500);
    moveTo(200, 90);
    release(200, 90);

    // The thunk WAS called, so the gesture reached the commit and the refusal
    // is the type check rather than the drag failing earlier for some reason.
    expect(built).toBe(1);
    expect(ids()).toEqual(["a", "b"]);
    expect(editorRef?.undoDepth).toBe(0);
  });

  it("swallows the click a drag ending on its own row would otherwise fire", () => {
    // The row inserts on click. A drag that begins and ends on it is still one
    // press and one release on a single element, so the browser reports a
    // click — and the row would add a second block beside the dropped one.
    const { container } = renderTwo();
    const row = container.ownerDocument.body.querySelector("button")!;

    pressRow(row, 300, 500);
    moveTo(200, 90);
    release(200, 90);
    expect(ids()).toEqual(["a", INSERTED, "b"]);

    // The synthesized click, which is the event the suppression exists for.
    fireEvent.click(row);
    expect(clicks).toBe(0);
  });

  it("swallows that click after Escape cancels the drag, too", () => {
    // Escape ends the drag by a different route, and an abandoned drag still
    // ends in a release. With the pointer back on the row it started from,
    // that press and release are a click — so Escape would visibly cancel the
    // drag and add a block anyway.
    const { container } = renderTwo();
    const row = container.ownerDocument.body.querySelector("button")!;

    pressRow(row, 300, 500);
    moveTo(200, 90);
    fireEvent.keyDown(document, { key: "Escape" });
    release(300, 500);
    fireEvent.click(row);

    expect(clicks).toBe(0);
    expect(ids()).toEqual(["a", "b"]);
    expect(editorRef?.undoDepth).toBe(0);
  });

  it("leaves a press that stayed a click able to insert", () => {
    // The control on all of the above, and the one that matters most:
    // suppression must not reach the non-drag path. Click-to-insert is the
    // WCAG 2.2 SC 2.5.7 alternative, and a suppressor that ate every click
    // would remove it while every assertion about drags stayed green.
    const { container } = renderTwo();
    const row = container.ownerDocument.body.querySelector("button")!;

    pressRow(row, 300, 500);
    moveTo(301, 501);
    release(301, 501);
    fireEvent.click(row);

    expect(clicks).toBe(1);
  });

  it("stops its scroll loop when the host unmounts mid-drag", () => {
    // `pump` reschedules itself every frame and stops only when it finds no
    // active gesture. Unmounting removes the listeners but leaves the gesture,
    // so the loop keeps running — holding the editor and the DOM, and still
    // scrolling a canvas whose editor has closed.
    const frames: number[] = [];
    const cancelled: number[] = [];
    const realRaf = window.requestAnimationFrame;
    const realCancel = window.cancelAnimationFrame;
    let next = 1;
    window.requestAnimationFrame = ((): number => {
      const id = next++;
      frames.push(id);
      return id;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((id: number): void => {
      cancelled.push(id);
    }) as typeof window.cancelAnimationFrame;

    try {
      const { container, unmount } = renderTwo();
      const row = container.ownerDocument.body.querySelector("button")!;
      pressRow(row, 300, 500);
      moveTo(200, 90);
      // The instrument's control: activation must actually have scheduled a
      // frame, or "the frame was cancelled" is a statement about nothing.
      expect(frames.length).toBeGreaterThan(0);

      unmount();
      expect(cancelled).toContain(frames[frames.length - 1]);
    } finally {
      window.requestAnimationFrame = realRaf;
      window.cancelAnimationFrame = realCancel;
    }
  });

  it("ignores a second palette press while one drag already owns the pointer", () => {
    // Two fingers, two rows, before the first releases. Taking the drag over
    // would leave the FIRST gesture with no ending of its own: its release
    // goes unheard, its click is never suppressed, and the row it started from
    // inserts through the ordinary click path — a block the author never
    // dropped, while a second drag is still in flight.
    const { container, row } = renderTwo();
    const second = container.ownerDocument.body.querySelectorAll("button")[0]!;

    const POINTER = /^pointer(move|up|cancel)$/;
    const added: string[] = [];
    const removed: string[] = [];
    const realAdd = document.addEventListener;
    const realRemove = document.removeEventListener;
    document.addEventListener = function countedAdd(
      type: string,
      fn: EventListenerOrEventListenerObject,
      opts?: boolean | AddEventListenerOptions
    ): void {
      if (POINTER.test(type)) added.push(type);
      realAdd.call(document, type, fn, opts);
    } as typeof document.addEventListener;
    document.removeEventListener = function countedRemove(
      type: string,
      fn: EventListenerOrEventListenerObject,
      opts?: boolean | EventListenerOptions
    ): void {
      if (POINTER.test(type)) removed.push(type);
      realRemove.call(document, type, fn, opts);
    } as typeof document.removeEventListener;

    /*
     * The RELEASE is inside the counted window too, deliberately.
     *
     * Restoring the real listeners before it would leave the removals
     * uncounted, and `removed` would read zero for a gesture that detached
     * perfectly — an assertion no implementation could satisfy.
     */
    try {
      pressRow(row, 300, 500);
      moveTo(200, 154);
      // The second finger. A different pointer id, on a palette row.
      fireEvent.pointerDown(second, {
        button: 0,
        pointerId: 9,
        clientX: 300,
        clientY: 520,
      });

      // ONE gesture's worth of listeners. Six would mean the second press
      // started its own, which is the takeover this guards.
      expect(added.length).toBe(3);
      // And the first drag is untouched: still in flight, and still ending
      // where ITS pointer settled. A takeover would leave this release
      // unheard, and nothing would be inserted at all.
      expect(dragState.draggingBlockName).toBe("test/heading");

      release(200, 154);
    } finally {
      document.addEventListener = realAdd;
      document.removeEventListener = realRemove;
    }

    expect(ids()).toEqual(["a", "b", INSERTED]);
    // Every listener the one gesture took is given back.
    expect(removed.length).toBe(3);
  });

  it("ignores a press on the CANVAS while a palette drag owns the gesture", () => {
    // The same rule at the other entry point. A finger landing on a block
    // mid-drag would otherwise replace the palette gesture with a move-drag of
    // that block — so the drag the author is performing vanishes, and a block
    // they only touched starts moving instead.
    const { container, row } = renderTwo();
    pressRow(row, 300, 500);
    moveTo(200, 154);
    expect(dragState.draggingBlockName).toBe("test/heading");

    const block = container.querySelector<HTMLElement>(
      `[${NODE_ID_ATTRIBUTE}="a"]`
    );
    expect(block, "no rendered node to press").not.toBeNull();
    fireEvent.pointerDown(block!, {
      button: 0,
      pointerId: 9,
      clientX: 200,
      clientY: 40,
    });

    // Still the palette's gesture, and still reporting no node id — a takeover
    // would put block "a" in flight and set `draggingId`.
    expect(dragState.draggingBlockName).toBe("test/heading");
    expect(dragState.draggingId).toBeNull();

    // And it still ends as its own drag, where its own pointer settled.
    release(200, 154);
    expect(ids()).toEqual(["a", "b", INSERTED]);
    expect(editorRef?.undoDepth).toBe(1);
  });

  it("survives a SECOND pointer being cancelled by the browser", () => {
    // The press guard stops a second contact taking the gesture over, but the
    // browser can still withdraw that contact a moment later — recognising a
    // touch-scroll, say. A cancel is a fact about ONE pointer, so ending the
    // drag on it undoes the very gesture the guard exists to protect: a stray
    // finger on a block, cancelled by the browser, would kill a palette drag
    // the author is mid-way through.
    const { container, row } = renderTwo();
    pressRow(row, 300, 500);
    moveTo(200, 154);
    expect(dragState.draggingBlockName).toBe("test/heading");

    const canvas = canvasRootOf(container);
    fireEvent.pointerCancel(canvas, { pointerId: 9 });

    // Still in flight, and still ending where ITS pointer settled.
    expect(dragState.draggingBlockName).toBe("test/heading");
    release(200, 154);
    expect(ids()).toEqual(["a", "b", INSERTED]);
    expect(editorRef?.undoDepth).toBe(1);
  });

  it("still abandons the drag when the OWNING pointer is cancelled", () => {
    // The must-differ control. A cancel handler that ignored every pointer
    // would satisfy the case above while breaking what cancel is FOR — the
    // browser has taken the gesture away, and continuing to draw a drag it
    // no longer owns leaves an indicator the author cannot dismiss.
    const { container, row } = renderTwo();
    pressRow(row, 300, 500);
    moveTo(200, 154);

    fireEvent.pointerCancel(canvasRootOf(container), { pointerId: 7 });

    expect(dragState.draggingBlockName).toBeNull();
    // And a release afterwards commits nothing, because there is no gesture.
    release(200, 154);
    expect(ids()).toEqual(["a", "b"]);
    expect(editorRef?.undoDepth).toBe(0);
  });

  it("starts no drag at all when the host supplied no canvas", () => {
    // The control on `beginInsertDrag`'s own guard: with no canvas root the
    // press must be left completely alone, so the row's click keeps working.
    registerBlocks(BLOCKS, { source: "insert-drag-test" });
    function NoCanvas() {
      const editor = useEditorState({
        initialDocument: documentOf([node("a", "test/heading")]),
      });
      editorRef = editor;
      const drag = useCanvasDrag({
        editor,
        slots: registrySlotSource(),
        nesting: { parentsOf: () => undefined, slotAllowOf: () => undefined },
      });
      dragState = {
        draggingId: drag.draggingId,
        draggingBlockName: drag.draggingBlockName,
      };
      return (
        <button
          type="button"
          data-testid="palette-row"
          onPointerDown={event =>
            drag.beginInsertDrag(event, {
              blockName: "test/heading",
              makeNode: () => {
                built += 1;
                return node(INSERTED, "test/heading");
              },
            })
          }
        >
          Heading
        </button>
      );
    }
    const result = render(<NoCanvas />);
    // The guard's observable content is that the press is INERT rather than
    // half-started: without it the gesture is built around a null root and the
    // first rectangle read throws inside the handler. Asserting only that no
    // drag began cannot see that, because a crash also leaves no drag — so the
    // failure is caught where an exception inside a listener actually surfaces,
    // which is the window rather than the call.
    const errors: string[] = [];
    const record = (event: ErrorEvent): void => {
      errors.push(String(event.error ?? event.message));
    };
    window.addEventListener("error", record);
    try {
      pressRow(result.getByTestId("palette-row"), 300, 500);
      moveTo(200, 90);
      release(200, 90);
    } finally {
      window.removeEventListener("error", record);
    }

    expect(errors).toEqual([]);
    expect(dragState.draggingBlockName).toBeNull();
    expect(built).toBe(0);
    expect(editorRef?.undoDepth).toBe(0);
  });
});
