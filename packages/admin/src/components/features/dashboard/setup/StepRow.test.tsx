/**
 * The setup card's row of steps while it scrolls: a keyboard stop named as scrolling, which the
 * arrow keys scroll, with a fade and a scroll button on each side that has more; and none of it
 * while its tiles fit.
 *
 * jsdom lays nothing out, so the row's widths and scroll position are given to it here, as a
 * narrow card's row measures them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen } from "@admin/__tests__/utils";

import { StepRow } from "./StepRow";

/** What the row measures: its content's width, its own, and how far it is scrolled. */
const measured = { scrollWidth: 0, clientWidth: 0, scrollLeft: 0 };
const scrollBy = vi.fn();
const restores: Array<() => void> = [];

/** Gives every `<ol>` the measures above, as a browser would lay the row out. */
function measureRows(): void {
  for (const key of ["scrollWidth", "clientWidth", "scrollLeft"] as const) {
    const spy = vi
      .spyOn(HTMLElement.prototype, key, "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.tagName === "OL" ? measured[key] : 0;
      });
    restores.push(() => spy.mockRestore());
  }
  const before = HTMLElement.prototype.scrollBy;
  HTMLElement.prototype.scrollBy = scrollBy as unknown as typeof before;
  restores.push(() => {
    HTMLElement.prototype.scrollBy = before;
  });
}

function drawRow() {
  return render(
    <StepRow label="Setup steps">
      <li>
        One <button type="button">Open</button>
      </li>
      <li>Two</li>
      <li>Three</li>
    </StepRow>
  );
}

const row = () => screen.getByRole("list");
const cue = (side: "before" | "after") =>
  document.querySelector(`[data-setup-row-cue="${side}"]`);

beforeEach(() => {
  Object.assign(measured, {
    scrollWidth: 300,
    clientWidth: 300,
    scrollLeft: 0,
  });
  scrollBy.mockClear();
  measureRows();
});

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

describe("the setup card's row of steps", () => {
  it("is no keyboard stop, and draws no fade or scroll button, while its tiles fit", () => {
    drawRow();
    expect(row()).not.toHaveAttribute("tabindex");
    expect(row()).toHaveAccessibleName("Setup steps");
    expect(cue("before")).toBeNull();
    expect(cue("after")).toBeNull();
  });

  it("is a keyboard stop named as scrolling, with a fade and button on the side that has more, while it overflows", () => {
    measured.scrollWidth = 773;
    measured.clientWidth = 308;
    drawRow();
    expect(row()).toHaveAttribute("tabindex", "0");
    expect(row()).toHaveAccessibleName("Setup steps, scrolls sideways");
    // Drawn with the focus ring, as a stop is.
    expect(row()).toHaveClass("focus-visible:ring-2");
    // At the start: more after, nothing before.
    expect(cue("after")).not.toBeNull();
    expect(cue("before")).toBeNull();
    // Scrolled to the middle: more on both sides.
    measured.scrollLeft = 200;
    fireEvent.scroll(row());
    expect(cue("before")).not.toBeNull();
    expect(cue("after")).not.toBeNull();
    // Scrolled to the end: more before only.
    measured.scrollLeft = 773 - 308;
    fireEvent.scroll(row());
    expect(cue("before")).not.toBeNull();
    expect(cue("after")).toBeNull();
  });

  it("scrolls a tile at a time from its buttons and its arrow keys, never from a tile's own keys", () => {
    measured.scrollWidth = 773;
    measured.clientWidth = 308;
    drawRow();
    fireEvent.click(
      screen.getByRole("button", { name: "Scroll setup steps on" })
    );
    expect(scrollBy).toHaveBeenLastCalledWith({
      left: expect.any(Number) as number,
    });
    const forward = (scrollBy.mock.lastCall?.[0] as { left: number }).left;
    expect(forward).toBeGreaterThan(0);

    row().focus();
    fireEvent.keyDown(row(), { key: "ArrowLeft" });
    expect((scrollBy.mock.lastCall?.[0] as { left: number }).left).toBeLessThan(
      0
    );
    fireEvent.keyDown(row(), { key: "ArrowRight" });
    expect(
      (scrollBy.mock.lastCall?.[0] as { left: number }).left
    ).toBeGreaterThan(0);

    // A tile's own button keeps its keys.
    const calls = scrollBy.mock.calls.length;
    fireEvent.keyDown(screen.getByRole("button", { name: "Open" }), {
      key: "ArrowRight",
    });
    expect(scrollBy.mock.calls.length).toBe(calls);
  });
});
