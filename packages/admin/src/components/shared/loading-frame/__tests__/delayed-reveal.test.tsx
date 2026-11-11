/**
 * The admin frame's one wait timer, through the parts that read it: a
 * screen's outline from 0.4 s, the line under the bar from 0.5 s, and the
 * slow-start message from 5 s, none of them when the data arrives first.
 *
 * Timed with fake timers, so "just before" and "at" each step are exact. The
 * separating property is the THRESHOLD, not the eventual appearance: an
 * implementation that showed everything at once, or each part on its own
 * timer from its own mount, would still show all three eventually, so each
 * step is asserted absent just before its time and present at it.
 */
import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOADING_FRAME_TIMES, WaitClockContext } from "../delayed-reveal";
import { ScreenOutline } from "../outlines";
import { ScreenWaitProvider, ScreenWaitSigns } from "../screen-wait";

/** A frame with a screen that waits for as long as `waiting` is true. */
function Frame({ waiting, openedAt }: { waiting: boolean; openedAt?: number }) {
  return (
    <WaitClockContext.Provider value={openedAt ?? null}>
      <ScreenWaitProvider>
        <ScreenWaitSigns />
        {waiting ? (
          <ScreenOutline>
            <span>outline</span>
          </ScreenOutline>
        ) : (
          <span>the screen</span>
        )}
      </ScreenWaitProvider>
    </WaitClockContext.Provider>
  );
}

const outline = () => screen.queryByText("outline");
const line = () => screen.queryByTestId("screen-wait-line");
const status = () => screen.queryByRole("status");

/** Moves the clock on to `ms` after the start of the test. */
let elapsed = 0;
function at(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms - elapsed);
  });
  elapsed = ms;
}

beforeEach(() => {
  vi.useFakeTimers();
  elapsed = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the frame's wait signs", () => {
  it("shows nothing at first, then the outline, the line and the message, each at its time", () => {
    render(<Frame waiting />);

    at(LOADING_FRAME_TIMES.outline - 10);
    expect(outline()).toBeNull();
    expect(line()).toBeNull();
    expect(status()).toBeNull();

    at(LOADING_FRAME_TIMES.outline);
    expect(outline()).not.toBeNull();
    expect(line()).toBeNull();

    at(LOADING_FRAME_TIMES.line - 1);
    expect(line()).toBeNull();
    at(LOADING_FRAME_TIMES.line);
    // The line is decoration: hidden from assistive technology.
    expect(line()).toHaveAttribute("aria-hidden", "true");
    expect(status()).toBeNull();

    at(LOADING_FRAME_TIMES.status - 1);
    expect(status()).toBeNull();
    at(LOADING_FRAME_TIMES.status);
    expect(status()).toHaveTextContent(
      "Starting the server. The first visit after a quiet spell takes a little longer."
    );
    // ONE status line, however the screen waits.
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("shows none of them when the data arrives first", () => {
    const view = render(<Frame waiting />);
    at(300);
    view.rerender(<Frame waiting={false} />);

    at(LOADING_FRAME_TIMES.status + 1_000);
    expect(screen.getByText("the screen")).toBeInTheDocument();
    expect(outline()).toBeNull();
    expect(line()).toBeNull();
    expect(status()).toBeNull();
  });

  it("takes the signs away as soon as the data arrives, mid-wait", () => {
    const view = render(<Frame waiting />);
    at(LOADING_FRAME_TIMES.status);
    expect(status()).not.toBeNull();

    view.rerender(<Frame waiting={false} />);
    expect(outline()).toBeNull();
    expect(line()).toBeNull();
    expect(status()).toBeNull();
  });

  it("times a part mounted late from when the screen was opened, not from its own mount", () => {
    // The screen's outline mounting after the session's: the wait has already
    // run 2 s, so the outline and the line are due at once, the message 3 s on.
    const openedAt = Date.now() - 2_000;
    render(<Frame waiting openedAt={openedAt} />);
    expect(outline()).not.toBeNull();
    expect(line()).not.toBeNull();
    expect(status()).toBeNull();

    at(LOADING_FRAME_TIMES.status - 2_000);
    expect(status()).not.toBeNull();
  });

  it("starts a new wait when a new screen is opened", () => {
    function Navigating() {
      const [openedAt, setOpenedAt] = useState(() => Date.now());
      return (
        <>
          <button type="button" onClick={() => setOpenedAt(Date.now())}>
            open another screen
          </button>
          <Frame waiting openedAt={openedAt} />
        </>
      );
    }
    render(<Navigating />);
    at(LOADING_FRAME_TIMES.status);
    expect(status()).not.toBeNull();

    act(() => {
      screen.getByRole("button", { name: "open another screen" }).click();
    });
    expect(outline()).toBeNull();
    expect(status()).toBeNull();
    at(LOADING_FRAME_TIMES.status + LOADING_FRAME_TIMES.outline);
    expect(outline()).not.toBeNull();
  });
});
