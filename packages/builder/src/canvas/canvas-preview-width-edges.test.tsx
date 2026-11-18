// @vitest-environment jsdom
/**
 * The handles at the canvas frame's edges: dragged or keyed, they preview the
 * page at another width without a render of the page per pixel, snap to the
 * ruler's marks, say which device is still being edited, and announce the
 * width once when it settles.
 *
 * @module canvas-preview-width-edges.test
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { BASE_BREAKPOINT, type BreakpointSet } from "@nextlyhq/blocks-engine";

import {
  ANNOUNCE_AFTER_KEYS_MS,
  PreviewWidthEdges,
} from "./canvas-preview-width-edges";
import { CANVAS_FRAME_BOX_ATTRIBUTE } from "./geometry-dom";

beforeAll(() => {
  // Absent from jsdom; a drag captures the pointer on its handle.
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const SITE: BreakpointSet = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1023 },
    { id: "mobile", label: "Mobile", maxWidth: 767 },
  ],
  container: [],
};

/** Every width the host was told, in order. */
let told: Array<number | null>;

beforeEach(() => {
  told = [];
});

/**
 * The frame box the handles are drawn in, holding its page, with the host's
 * state: the override the handles report, and the layout width from it.
 */
function Host({
  scale = 1,
  start = null,
}: {
  scale?: number;
  start?: number | null;
}): React.JSX.Element {
  const [override, setOverride] = React.useState<number | null>(start);
  const width = override ?? 1280;
  return (
    <div
      {...{ [CANVAS_FRAME_BOX_ATTRIBUTE]: "" }}
      style={{ width: width * scale }}
    >
      <iframe className="nx-canvas-frame__page" title="Page" />
      <PreviewWidthEdges
        width={width}
        scale={scale}
        control={{
          breakpoints: SITE,
          edited: BASE_BREAKPOINT,
          deviceWidth: 1280,
          override,
          onChange: next => {
            told.push(next);
            setOverride(next);
          },
        }}
      />
    </div>
  );
}

function handle(side: "left" | "right"): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[role="slider"][data-side="${side}"]`
  );
  if (found === null) throw new Error(`no ${side} handle`);
  return found;
}

/** Press a handle, move it through the given x positions, and let go. */
function drag(element: HTMLElement, xs: readonly number[]): void {
  act(() => {
    fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: 0 });
  });
  for (const x of xs) {
    act(() => {
      fireEvent.pointerMove(element, { pointerId: 1, clientX: x });
    });
  }
  act(() => {
    fireEvent.pointerUp(element, { pointerId: 1, clientX: xs.at(-1) ?? 0 });
  });
}

function liveRegion(): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    "[data-nx-preview-width-announcer]"
  );
  if (found === null) throw new Error("no live region");
  return found;
}

describe("the handles are sliders", () => {
  it("draws one at each side, named Preview width, valued in pixels", () => {
    render(<Host />);
    const sliders = screen.getAllByRole("slider", { name: "Preview width" });
    expect(sliders).toHaveLength(2);
    for (const slider of sliders) {
      expect(slider.getAttribute("aria-valuemin")).toBe("320");
      expect(slider.getAttribute("aria-valuemax")).toBe("1280");
      expect(slider.getAttribute("aria-valuenow")).toBe("1280");
      expect(slider.getAttribute("aria-valuetext")).toBe(
        "1280 pixels, Desktop range"
      );
      expect(slider.tabIndex).toBe(0);
    }
  });
});

describe("dragging a handle", () => {
  it("lays the page out at the dragged width, telling the host once, on release", () => {
    render(<Host />);
    const right = handle("right");
    act(() => {
      fireEvent.pointerDown(right, { button: 0, pointerId: 1, clientX: 0 });
    });
    // Both sides move together: the right edge 190px in is 380px narrower.
    for (const x of [-50, -120, -190]) {
      act(() => {
        fireEvent.pointerMove(right, { pointerId: 1, clientX: x });
      });
    }
    // Nothing reported while dragging, so the page is not rendered per pixel.
    expect(told).toEqual([]);
    act(() => {
      fireEvent.pointerUp(right, { pointerId: 1, clientX: -190 });
    });
    expect(told).toEqual([900]);
    expect(handle("right").getAttribute("aria-valuenow")).toBe("900");
  });

  it("widens when the left handle moves left, at the frame's scale", () => {
    render(<Host scale={0.5} start={600} />);
    // 50 screen pixels at half scale is 100px of width a side.
    drag(handle("left"), [-25, -50]);
    expect(told).toEqual([800]);
  });

  it("snaps to a ruler mark within 6 screen pixels", () => {
    render(<Host />);
    // To 780 as dragged, 6 screen pixels from the Tablet mark at 768.
    drag(handle("right"), [-250]);
    expect(told).toEqual([768]);
  });

  it("stays inside the range", () => {
    render(<Host />);
    drag(handle("right"), [-2000]);
    expect(told).toEqual([320]);
  });

  it("writes the dragged width to the frame and its page each frame, mid-drag", () => {
    // Each animation frame runs at once, so the write is seen before release.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(step => {
      step(0);
      return 1;
    });
    render(<Host start={1000} scale={0.5} />);
    const box = document.querySelector<HTMLElement>(
      `[${CANVAS_FRAME_BOX_ATTRIBUTE}]`
    );
    const page = document.querySelector<HTMLElement>(".nx-canvas-frame__page");
    const right = handle("right");
    act(() => {
      fireEvent.pointerDown(right, { button: 0, pointerId: 1, clientX: 0 });
    });
    act(() => {
      fireEvent.pointerMove(right, { pointerId: 1, clientX: -25 });
    });
    // 25 screen pixels at half scale is 50px of width a side: 900 wide,
    // painted at the scale the drag started with.
    expect(page?.style.width).toBe("900px");
    expect(box?.style.width).toBe("450px");
    expect(told).toEqual([]);
    act(() => {
      fireEvent.pointerUp(right, { pointerId: 1, clientX: -25 });
    });
    expect(told).toEqual([900]);
    vi.restoreAllMocks();
  });

  it("goes back to the device's own width when dragged there", () => {
    render(<Host start={1200} />);
    drag(handle("right"), [100]);
    expect(told).toEqual([null]);
  });
});

describe("handing the frame back on release", () => {
  it("leaves the frame's box as the host draws it, when the host's width for it is unchanged", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(step => {
      step(0);
      return 1;
    });
    // A fitted frame: its box fills the region at any width, so the host
    // draws it 800px wide before the drag and after.
    function Fitted(): React.JSX.Element {
      const [override, setOverride] = React.useState<number | null>(null);
      const width = override ?? 1280;
      const scale = 800 / width;
      return (
        <div {...{ [CANVAS_FRAME_BOX_ATTRIBUTE]: "" }} style={{ width: 800 }}>
          <iframe
            className="nx-canvas-frame__page"
            title="Page"
            style={{ width }}
          />
          <PreviewWidthEdges
            width={width}
            scale={scale}
            control={{
              breakpoints: SITE,
              edited: BASE_BREAKPOINT,
              deviceWidth: 1280,
              override,
              onChange: next => {
                told.push(next);
                setOverride(next);
              },
            }}
          />
        </div>
      );
    }
    render(<Fitted />);
    const box = document.querySelector<HTMLElement>(
      `[${CANVAS_FRAME_BOX_ATTRIBUTE}]`
    );
    const page = document.querySelector<HTMLElement>(".nx-canvas-frame__page");
    // 118.75 screen pixels at 800/1280 is 190px of width a side: 900.
    drag(handle("right"), [-118.75]);
    expect(told).toEqual([900]);
    expect(box?.style.width).toBe("800px");
    expect(page?.style.width).toBe("900px");
    vi.restoreAllMocks();
  });
});

describe("a drag that ends without a release", () => {
  it("gives the page its pointer back when the frame goes mid-drag", () => {
    const { unmount } = render(<Host />);
    const page = document.querySelector<HTMLElement>(".nx-canvas-frame__page");
    act(() => {
      fireEvent.pointerDown(handle("right"), {
        button: 0,
        pointerId: 1,
        clientX: 0,
      });
    });
    expect(page?.style.pointerEvents).toBe("none");
    // The page element outlives the handles here, as the frame's does when
    // the host stops previewing widths.
    const kept = page;
    unmount();
    expect(kept?.style.pointerEvents).toBe("");
  });

  it("settles when the pointer capture is lost", () => {
    render(<Host />);
    const right = handle("right");
    act(() => {
      fireEvent.pointerDown(right, { button: 0, pointerId: 1, clientX: 0 });
    });
    act(() => {
      fireEvent.pointerMove(right, { pointerId: 1, clientX: -190 });
    });
    act(() => {
      fireEvent.lostPointerCapture(right, { pointerId: 1 });
    });
    expect(told).toEqual([900]);
  });
});

describe("the keys on a handle", () => {
  it("move the width as the slider's keys do", () => {
    render(<Host start={900} />);
    const right = handle("right");
    fireEvent.keyDown(right, { key: "ArrowLeft" });
    fireEvent.keyDown(right, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(right, { key: "PageDown" });
    fireEvent.keyDown(right, { key: "Home" });
    fireEvent.keyDown(right, { key: "PageUp" });
    expect(told).toEqual([890, 889, 768, 320, 768]);
    fireEvent.keyDown(right, { key: "End" });
    // The widest is the device's own width, so the override goes.
    expect(told.at(-1)).toBeNull();
  });
});

describe("what the canvas says", () => {
  it("names the device still being edited, under the frame", () => {
    render(<Host start={900} />);
    expect(
      screen.getByText("Previewing at 900px · still editing Desktop styles")
    ).toBeTruthy();
  });

  it("says nothing at the device's own width", () => {
    render(<Host />);
    expect(document.body.textContent).not.toContain("Previewing at");
  });

  it("draws the ruler only while a width of its own is shown", () => {
    const { unmount } = render(<Host />);
    expect(document.querySelector("[data-nx-preview-ruler]")).toBeNull();
    unmount();
    render(<Host start={900} />);
    const ruler = document.querySelector("[data-nx-preview-ruler]");
    expect(ruler?.textContent).toContain("768 Tablet");
    expect(ruler?.textContent).toContain("1024 Desktop");
  });
});

describe("an announcement overtaken", () => {
  it("is not made for keys pressed before another device was chosen", () => {
    vi.useFakeTimers();
    const control = (edited: string) => ({
      breakpoints: SITE,
      edited,
      deviceWidth: edited === BASE_BREAKPOINT ? 1280 : 1023,
      override: null,
      onChange: () => {},
    });
    const { rerender } = render(
      <PreviewWidthEdges
        width={1280}
        scale={1}
        control={control(BASE_BREAKPOINT)}
      />
    );
    fireEvent.keyDown(handle("right"), { key: "ArrowLeft" });
    rerender(
      <PreviewWidthEdges width={1023} scale={1} control={control("tablet")} />
    );
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_AFTER_KEYS_MS);
    });
    expect(liveRegion().textContent).toBe("");
  });

  it("is not made for keys pressed before a drag began", () => {
    vi.useFakeTimers();
    render(<Host start={900} />);
    const right = handle("right");
    fireEvent.keyDown(right, { key: "ArrowLeft" });
    act(() => {
      fireEvent.pointerDown(right, { button: 0, pointerId: 1, clientX: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_AFTER_KEYS_MS);
    });
    expect(liveRegion().textContent).toBe("");
  });
});

describe("the announcement", () => {
  it("is made once, when a drag ends", () => {
    render(<Host />);
    drag(handle("right"), [-60, -120, -190]);
    expect(liveRegion().textContent).toBe(
      "Previewing at 900 pixels, still editing Desktop styles"
    );
  });

  it("waits for the keys to stop, then is made once", () => {
    vi.useFakeTimers();
    render(<Host start={900} />);
    const right = handle("right");
    fireEvent.keyDown(right, { key: "ArrowLeft" });
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_AFTER_KEYS_MS - 100);
    });
    fireEvent.keyDown(right, { key: "ArrowLeft" });
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_AFTER_KEYS_MS - 100);
    });
    // Not yet: a key came within the wait.
    expect(liveRegion().textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(liveRegion().textContent).toBe(
      "Previewing at 880 pixels, still editing Desktop styles"
    );
  });
});
