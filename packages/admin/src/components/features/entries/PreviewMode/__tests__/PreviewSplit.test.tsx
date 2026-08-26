/**
 * The divider's own behaviour.
 *
 * `PreviewSplit` replaced a panel library, and what a library supplies without
 * being asked is exactly what a replacement drops silently: the gesture it
 * reserves, the buttons it declines, the keys it swallows. Each case here is
 * one of those, asserted on the split's own state rather than on the handler
 * being wired.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreviewSplit } from "../PreviewSplit";

const MIN_EDITOR_PERCENT = 35;
const DEFAULT_EDITOR_PERCENT = 55;

function renderSplit() {
  render(
    <PreviewSplit open={true} label="Preview" preview={<p>preview</p>}>
      <p data-testid="editor">editor</p>
    </PreviewSplit>
  );
  return screen.getByRole("separator");
}

/**
 * The editor pane carries the split as an inline width, so the rendered
 * percentage is readable without reaching into the component.
 *
 * Derived from the DOM the user gets rather than from a second copy of the
 * state: a test holding its own idea of the percentage would agree with a
 * handler that stopped updating anything.
 */
function editorPercent(): number {
  const pane = screen.getByTestId("editor").closest("[style]");
  const width = (pane as HTMLElement | null)?.style.width ?? "";
  return Number.parseFloat(width);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PreviewSplit keyboard", () => {
  it("cancels a handled key that moves nothing", () => {
    const separator = renderSplit();

    // Home once: the divider goes to the minimum and the key is cancelled.
    expect(fireEvent.keyDown(separator, { key: "Home" })).toBe(false);
    expect(editorPercent()).toBe(MIN_EDITOR_PERCENT);

    /*
     * Home again computes a zero step. The divider is already where the key
     * would put it, and the browser must still not act on it: an uncancelled
     * Home scrolls the page from a control that advertises itself as the
     * resizer, at precisely the position where pressing it twice is likely.
     */
    expect(fireEvent.keyDown(separator, { key: "Home" })).toBe(false);
    expect(editorPercent()).toBe(MIN_EDITOR_PERCENT);
  });

  it("announces the pane its value measures", () => {
    const separator = renderSplit();

    /*
     * `aria-valuenow` on a window splitter reports the PRIMARY pane, which is
     * the editor. A name mentioning only the preview therefore announced the
     * preview at the editor's percentage — inverted at rest, and inverted again
     * on every arrow press, which grows one pane while the number describes the
     * other. The text carries both figures so no number is loose.
     */
    expect(separator).toHaveAttribute("aria-valuenow", "55");
    expect(separator).toHaveAttribute(
      "aria-valuetext",
      "Editor 55%, Preview 45%"
    );

    fireEvent.keyDown(separator, { key: "ArrowRight" });

    // ArrowRight grows the editor, so the number it reports grows with it.
    expect(separator).toHaveAttribute("aria-valuenow", "57");
    expect(separator).toHaveAttribute(
      "aria-valuetext",
      "Editor 57%, Preview 43%"
    );
  });

  it("lets a key it does not handle through", () => {
    const separator = renderSplit();

    /*
     * The control for the pair above. Without it, a handler that cancelled
     * EVERY key would satisfy both assertions there — and would swallow Tab and
     * every shortcut the editor registers whenever the divider holds focus.
     */
    expect(fireEvent.keyDown(separator, { key: "Tab" })).toBe(true);
    expect(editorPercent()).toBe(DEFAULT_EDITOR_PERCENT);
  });
});

describe("PreviewSplit pointer", () => {
  /**
   * jsdom lays nothing out, so the container measures zero and the split
   * declines to move — which would make every assertion below pass by never
   * reaching the code under test.
   */
  function stubMeasure(width: number) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width,
      top: 0,
      right: width,
      bottom: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  }

  /**
   * Built by hand rather than through `fireEvent.pointerDown`, which cannot
   * carry a `pointerId` here: jsdom has no `PointerEvent`, so the helper falls
   * back to a plain event and the id the handler reads arrives `undefined`.
   */
  function pointerEventAt(
    type: string,
    pointerId: number,
    init: MouseEventInit = {}
  ): MouseEvent {
    const event = new MouseEvent(type, { bubbles: true, ...init });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    return event;
  }

  function pressPointer(
    separator: HTMLElement,
    pointerId: number,
    init: MouseEventInit
  ) {
    // Dispatched inside `act` because the window listeners these events reach
    // are plain DOM listeners rather than React's, so their state updates are
    // outside its batching and are not flushed before the next assertion.
    act(() => {
      separator.dispatchEvent(pointerEventAt("pointerdown", pointerId, init));
    });
  }

  function movePointer(pointerId: number, clientX: number) {
    act(() => {
      window.dispatchEvent(
        pointerEventAt("pointermove", pointerId, { clientX })
      );
    });
  }

  it("drags on the primary button", () => {
    stubMeasure(1000);
    const separator = renderSplit();

    pressPointer(separator, 1, { button: 0, clientX: 550 });
    movePointer(1, 700);

    // The positive control for the two refusals below: this pair of events DOES
    // move the divider, so their staying put is a decision rather than a drag
    // that never worked in this environment.
    expect(editorPercent()).toBe(70);
  });

  it("ignores a press that is not the primary button", () => {
    stubMeasure(1000);
    const separator = renderSplit();

    // A right-click opens a context menu. It must not also resize underneath.
    pressPointer(separator, 1, { button: 2, clientX: 550 });
    movePointer(1, 700);

    expect(editorPercent()).toBe(DEFAULT_EDITOR_PERCENT);
  });

  it("ignores a second pointer while one already owns the divider", () => {
    stubMeasure(1000);
    const separator = renderSplit();

    pressPointer(separator, 1, { button: 0, clientX: 550 });
    pressPointer(separator, 2, { button: 0, clientX: 550 });

    // The second finger steers nothing...
    movePointer(2, 300);
    expect(editorPercent()).toBe(DEFAULT_EDITOR_PERCENT);

    // ...and its release does not end the first finger's drag.
    act(() => {
      window.dispatchEvent(pointerEventAt("pointerup", 2));
    });

    movePointer(1, 700);
    expect(editorPercent()).toBe(70);
  });
});
