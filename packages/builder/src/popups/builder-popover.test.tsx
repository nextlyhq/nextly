// @vitest-environment jsdom

/**
 * The builder's popup holds where it opened, against the general popover in
 * the same place doing what it does: a 1568×737 window, a popup beside a row
 * low on the screen, and content that grows by a row.
 *
 * jsdom lays nothing out, so boxes are stated: the anchor's, the popup's own
 * size, and the window's. The popover library positions from those exactly as
 * it would in a browser, and writes where it put the popup on its wrapper.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Popover, PopoverAnchor, PopoverContent } from "@nextlyhq/ui";
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BuilderPopoverContent } from "./builder-popover";

const WINDOW = { width: 1568, height: 737 };
const TOP_BAR_HEIGHT = 48;

/** The popup's own size, which a test changes as its content would. */
let size = { width: 240, height: 300 };
/** The anchor's box, which a test moves as a scroll would. */
let anchorBox = { left: 1000, top: 600, width: 200, height: 28 };

const rectOf = (box: {
  left: number;
  top: number;
  width: number;
  height: number;
}): DOMRect =>
  ({
    ...box,
    x: box.left,
    y: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => box,
  }) as DOMRect;

const isWrapper = (element: Element): boolean =>
  element.hasAttribute("data-radix-popper-content-wrapper");
const isContent = (element: Element): boolean =>
  element.getAttribute("data-slot") === "popover-content";

/** Where the popover put the popup: the wrapper's `translate(x, y)`. */
function placedAt(wrapper: HTMLElement): { left: number; top: number } {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(
    wrapper.style.transform
  );
  return match === null
    ? { left: 0, top: -9999 }
    : { left: Number(match[1]), top: Number(match[2]) };
}

function setWindow(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: height,
    configurable: true,
  });
  // What the popover library reads the window's room from.
  Object.defineProperty(document.documentElement, "clientWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    value: height,
    configurable: true,
  });
}

beforeAll(() => {
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  const own = (element: HTMLElement, axis: "width" | "height"): number =>
    isWrapper(element) || isContent(element) ? size[axis] : 0;
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return own(this, "width");
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return own(this, "height");
    },
  });
  Element.prototype.getBoundingClientRect = function boxOf(
    this: Element
  ): DOMRect {
    if (isWrapper(this)) {
      return rectOf({ ...placedAt(this as HTMLElement), ...size });
    }
    if (this.classList.contains("nx-builder-topbar")) {
      return rectOf({
        left: 0,
        top: 0,
        width: WINDOW.width,
        height: TOP_BAR_HEIGHT,
      });
    }
    return rectOf({ left: 0, top: 0, width: 0, height: 0 });
  };
});

beforeEach(() => {
  size = { width: 240, height: 300 };
  anchorBox = { left: 1000, top: 600, width: 200, height: 28 };
  setWindow(WINDOW.width, WINDOW.height);
});

afterEach(cleanup);

const anchor = {
  getBoundingClientRect: () => rectOf(anchorBox),
};

type Content = typeof BuilderPopoverContent | typeof PopoverContent;

function Popup({
  as: Content,
  rows,
  side = "right",
  align = "start",
  open = true,
  anchorKey,
}: {
  as: Content;
  rows: number;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  open?: boolean;
  anchorKey?: string;
}): React.JSX.Element {
  return (
    <>
      <header className="nx-builder-topbar" />
      <Popover open={open}>
        <PopoverAnchor virtualRef={{ current: anchor }} />
        <Content
          side={side}
          align={align}
          sideOffset={12}
          collisionPadding={8}
          {...(anchorKey === undefined ? {} : { anchorKey })}
        >
          {Array.from({ length: rows }, (_, row) => (
            <p key={row}>Row {row}</p>
          ))}
        </Content>
      </Popover>
    </>
  );
}

const wrapper = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>(
    "[data-radix-popper-content-wrapper]"
  );
  if (found === null) throw new Error("no popup open");
  return found;
};
const content = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>(
    '[data-slot="popover-content"]'
  );
  if (found === null) throw new Error("no popup open");
  return found;
};

/** Lets the popover position from a scroll of the page, as the anchor's would. */
async function scrolled(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event("scroll"));
    await Promise.resolve();
  });
}

async function opened(as: Content, side?: "top" | "right" | "bottom" | "left") {
  const view = render(<Popup as={as} rows={3} {...(side ? { side } : {})} />);
  await waitFor(() => expect(placedAt(wrapper()).top).toBeGreaterThan(-9999));
  if (as === BuilderPopoverContent) {
    await waitFor(() =>
      expect(content().getAttribute("data-nx-popup")).toBe("held")
    );
  }
  return view;
}

describe("a builder popup when it opens", () => {
  it("opens beside its anchor, raised to fit above the window's bottom", async () => {
    await opened(BuilderPopoverContent);
    const at = placedAt(wrapper());
    expect(content().getAttribute("data-nx-popup-side")).toBe("right");
    expect(at.left).toBe(anchorBox.left + anchorBox.width + 12);
    expect(at.top + size.height).toBe(WINDOW.height - 8);
  });

  it("opens on the other side when its own has no room", async () => {
    anchorBox = { left: 1300, top: 300, width: 200, height: 28 };
    await opened(BuilderPopoverContent);
    expect(content().getAttribute("data-nx-popup-side")).toBe("left");
    expect(placedAt(wrapper()).left).toBe(1300 - 12 - size.width);
  });

  it("opens upward from an anchor at the window's bottom", async () => {
    anchorBox = { left: 400, top: 690, width: 200, height: 28 };
    await opened(BuilderPopoverContent, "bottom");
    expect(content().getAttribute("data-nx-popup-side")).toBe("top");
    expect(placedAt(wrapper()).top + size.height).toBe(690 - 12);
  });

  it("keeps clear of the top bar", async () => {
    anchorBox = { left: 400, top: 20, width: 200, height: 20 };
    await opened(BuilderPopoverContent, "right");
    expect(placedAt(wrapper()).top).toBe(TOP_BAR_HEIGHT + 8);
  });
});

describe("a builder popup while it is open", () => {
  it("stays exactly where it is when its content grows by a row", async () => {
    const view = await opened(BuilderPopoverContent);
    const before = placedAt(wrapper());

    size = { ...size, height: size.height + 48 };
    view.rerender(<Popup as={BuilderPopoverContent} rows={4} />);
    await scrolled();

    expect(placedAt(wrapper())).toEqual(before);
    expect(content().getAttribute("data-nx-popup-side")).toBe("right");
  });

  it("keeps its top where it was when it opened upward and grows", async () => {
    // Opened above its anchor: a row added at its foot must not lift the
    // rows above it out from under the pointer.
    anchorBox = { left: 400, top: 690, width: 200, height: 28 };
    const view = render(
      <Popup as={BuilderPopoverContent} rows={3} side="bottom" />
    );
    await waitFor(() =>
      expect(content().getAttribute("data-nx-popup")).toBe("held")
    );
    expect(content().getAttribute("data-nx-popup-side")).toBe("top");
    const before = placedAt(wrapper());

    size = { ...size, height: size.height + 48 };
    view.rerender(<Popup as={BuilderPopoverContent} rows={4} side="bottom" />);
    await scrolled();

    expect(placedAt(wrapper())).toEqual(before);
  });

  it("is what the general popover, in the same place, does not do", async () => {
    // The control: the same popup, the same row, on the general popover.
    // If this stopped moving, the test above would prove nothing.
    const view = await opened(PopoverContent);
    const before = placedAt(wrapper());

    size = { ...size, height: size.height + 48 };
    view.rerender(<Popup as={PopoverContent} rows={4} />);
    await scrolled();

    expect(placedAt(wrapper()).top).toBe(before.top - 48);
  });

  it("moves with its anchor when what holds the anchor scrolls", async () => {
    await opened(BuilderPopoverContent);
    const before = placedAt(wrapper());

    anchorBox = { ...anchorBox, top: anchorBox.top - 100 };
    await scrolled();

    expect(placedAt(wrapper())).toEqual({
      left: before.left,
      top: before.top - 100,
    });
  });

  it("is placed afresh when it is opened again from somewhere else", async () => {
    // Raised to fit, low in the window: 171 px above its row.
    const view = await opened(BuilderPopoverContent);
    expect(placedAt(wrapper()).top).toBe(anchorBox.top - 171);

    view.rerender(<Popup as={BuilderPopoverContent} rows={3} open={false} />);
    await waitFor(() =>
      expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
    );
    anchorBox = { ...anchorBox, top: 100 };
    view.rerender(<Popup as={BuilderPopoverContent} rows={3} />);

    await waitFor(() =>
      expect(content().getAttribute("data-nx-popup")).toBe("held")
    );
    expect(placedAt(wrapper()).top).toBe(100);
  });

  it("is placed again when reopened before its closing animation ends", async () => {
    // A closing animation keeps the content mounted until it ends, as the
    // popover's presence waits for it: an "enter" animation while open, an
    // "exit" one once closed, and this one never ends.
    const real = window.getComputedStyle.bind(window);
    const kept = globalThis.getComputedStyle;
    const closing = (element: Element, pseudo?: string | null) => {
      const style = real(element, pseudo);
      if (!isContent(element)) return style;
      return new Proxy(style, {
        get: (target, key) =>
          key === "animationName"
            ? element.getAttribute("data-state") === "closed"
              ? "exit"
              : "enter"
            : (Reflect.get(target, key) as unknown),
      });
    };
    // Both: the popover's presence asks the global one.
    window.getComputedStyle = closing;
    globalThis.getComputedStyle = closing;
    try {
      const view = await opened(BuilderPopoverContent);
      expect(placedAt(wrapper()).top).toBe(anchorBox.top - 171);
      const mounted = content();

      view.rerender(<Popup as={BuilderPopoverContent} rows={3} open={false} />);
      await waitFor(() =>
        expect(mounted.getAttribute("data-state")).toBe("closed")
      );
      anchorBox = { ...anchorBox, top: 100 };
      view.rerender(<Popup as={BuilderPopoverContent} rows={3} />);
      await scrolled();

      // The same content, still mounted: placed again, not left 171 px up.
      expect(content()).toBe(mounted);
      await waitFor(() => expect(placedAt(wrapper()).top).toBe(100));
    } finally {
      window.getComputedStyle = real;
      globalThis.getComputedStyle = kept;
    }
  });

  it("is placed again beside a new anchor it is told it moved to", async () => {
    const view = render(
      <Popup as={BuilderPopoverContent} rows={3} anchorKey="first" />
    );
    await waitFor(() =>
      expect(content().getAttribute("data-nx-popup")).toBe("held")
    );
    expect(placedAt(wrapper()).top).toBe(anchorBox.top - 171);

    anchorBox = { ...anchorBox, top: 100 };
    view.rerender(
      <Popup as={BuilderPopoverContent} rows={3} anchorKey="second" />
    );
    await scrolled();
    await act(async () => {
      await new Promise(done => requestAnimationFrame(() => done(null)));
    });

    await waitFor(() => expect(placedAt(wrapper()).top).toBe(100));
  });

  it("is placed again when the window is resized", async () => {
    await opened(BuilderPopoverContent);
    expect(content().getAttribute("data-nx-popup-side")).toBe("right");

    // A narrower window leaves no room on the right.
    setWindow(1300, WINDOW.height);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await new Promise(done => requestAnimationFrame(() => done(null)));
    });

    await waitFor(() =>
      expect(content().getAttribute("data-nx-popup-side")).toBe("left")
    );
    expect(placedAt(wrapper()).left).toBe(anchorBox.left - 12 - size.width);
  });
});
