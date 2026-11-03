// @vitest-environment jsdom

/**
 * The frame the canvas is drawn in.
 *
 * jsdom gives an iframe a document and a window of its own, as a browser
 * does, but it never loads a `srcdoc`: the frame keeps the blank page it
 * starts with. So these cases use a source whose page is that blank page once
 * a marker is put on it and `load` is dispatched — which is exactly the step a
 * browser takes when the `srcdoc` arrives — and the default source's own
 * readiness is asked of a blank page and of its page directly.
 *
 * Layout is the browser suite's: nothing here is measured.
 *
 * @module canvas-frame.test
 */
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CanvasFrame,
  canvasFrameTitle,
  SRCDOC_FRAME_SOURCE,
  type CanvasFrameSource,
} from "./canvas-frame";
import { CanvasFrameProvider, useCanvasFrame } from "./canvas-frame-context";
import { CANVAS_FRAME_DEFAULTS } from "./canvas-frame-sheet";
import { FIT_ZOOM } from "./canvas-zoom";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const PAGE_MARKER = "data-test-page";

/** The blank page, taken as the source's once it carries the marker. */
const TEST_SOURCE: CanvasFrameSource = {
  srcDoc: SRCDOC_FRAME_SOURCE.srcDoc,
  ready: doc => doc.documentElement.hasAttribute(PAGE_MARKER),
  mountPoint: doc => doc.body,
};

function frameIn(container: HTMLElement): HTMLIFrameElement {
  const frame = container.querySelector("iframe");
  if (frame === null) throw new Error("no frame drawn");
  return frame;
}

/** What a browser does when the frame's own page arrives. */
function loadPage(frame: HTMLIFrameElement): void {
  const doc = frame.contentDocument;
  if (doc === null) throw new Error("no frame document");
  act(() => {
    doc.documentElement.setAttribute(PAGE_MARKER, "");
    frame.dispatchEvent(new Event("load"));
  });
}

function Page(): React.JSX.Element {
  return <div className="nx-canvas" data-testid="page" />;
}

describe("the canvas frame", () => {
  it("draws the page inside the frame's document once its page has loaded", () => {
    const { container } = render(
      <CanvasFrame width={1280} title="Home" source={TEST_SOURCE}>
        <Page />
      </CanvasFrame>
    );
    const frame = frameIn(container);
    const inside = frame.contentDocument;
    if (inside === null) throw new Error("no frame document");
    // Before the page is the source's, nothing is mounted: the blank page a
    // frame starts with is replaced as it loads, and anything drawn into it
    // would go with it.
    expect(inside.querySelector(".nx-canvas")).toBeNull();

    loadPage(frame);

    expect(inside.querySelector(".nx-canvas")).not.toBeNull();
    // In the frame's document, not the editor's.
    expect(document.querySelector(".nx-canvas")).toBeNull();
    // The frame's own sheet travels with the page, the base reset first.
    const sheet = inside.querySelector("style")?.textContent ?? "";
    expect(sheet).toContain("html, body { margin: 0; padding: 0; }");
  });

  it("keeps one iframe element, and the page in it, across a device change", () => {
    const { container, rerender } = render(
      <CanvasFrame width={1280} title="Home" source={TEST_SOURCE}>
        <Page />
      </CanvasFrame>
    );
    const frame = frameIn(container);
    loadPage(frame);
    const page = frame.contentDocument?.querySelector(".nx-canvas");

    rerender(
      <CanvasFrame width={390} title="Home" source={TEST_SOURCE}>
        <Page />
      </CanvasFrame>
    );

    expect(frameIn(container)).toBe(frame);
    expect(frame.contentDocument?.querySelector(".nx-canvas")).toBe(page);
    expect(frame.style.width).toBe("390px");
  });

  it("is laid out at the device's width and the height its width implies", () => {
    const { container, rerender } = render(
      <CanvasFrame width={1280} title="Home" source={TEST_SOURCE} />
    );
    expect(frameIn(container).style.height).toBe("800px");
    rerender(<CanvasFrame width={991} title="Home" source={TEST_SOURCE} />);
    expect(frameIn(container).style.height).toBe("1024px");
    rerender(<CanvasFrame width={390} title="Home" source={TEST_SOURCE} />);
    expect(frameIn(container).style.height).toBe("844px");
  });

  it("paints a chosen zoom as a transform, inside a box the painted size", () => {
    const reported = vi.fn();
    const { container } = render(
      <CanvasFrame
        width={1280}
        zoom={{ kind: "fixed", scale: 0.5 }}
        onScale={reported}
        title="Home"
        source={TEST_SOURCE}
      />
    );
    const frame = frameIn(container);
    // Laid out at the device's size, so the page's layout is untouched.
    expect(frame.style.width).toBe("1280px");
    expect(frame.style.transform).toBe("scale(0.5)");
    const box = frame.parentElement;
    expect(box?.style.width).toBe("640px");
    expect(box?.style.height).toBe("400px");
    expect(reported).toHaveBeenLastCalledWith(0.5);
  });

  it("fits at full size until the region has been measured", () => {
    const reported = vi.fn();
    const { container } = render(
      <CanvasFrame
        width={1280}
        zoom={FIT_ZOOM}
        onScale={reported}
        title="Home"
        source={TEST_SOURCE}
      />
    );
    expect(frameIn(container).style.transform).toBe("scale(1)");
    expect(reported).toHaveBeenLastCalledWith(1);
  });

  it("is named for the page it shows", () => {
    const { container } = render(
      <CanvasFrame width={1280} title="Pricing" source={TEST_SOURCE} />
    );
    expect(frameIn(container).title).toBe("Page canvas: Pricing");
    expect(canvasFrameTitle(undefined)).toBe("Page canvas: Untitled");
    expect(canvasFrameTitle("   ")).toBe("Page canvas: Untitled");
  });

  it("states the site's theme and the empty-elements preference on the page's root", () => {
    const { container, rerender } = render(
      <CanvasFrame
        width={1280}
        title="Home"
        theme="dark"
        showEmptyElements={false}
        source={TEST_SOURCE}
      />
    );
    const frame = frameIn(container);
    loadPage(frame);
    const root = frame.contentDocument?.documentElement;
    expect(root?.getAttribute("data-nx-theme")).toBe("dark");
    expect(root?.getAttribute("data-nx-empty-elements")).toBe("hidden");

    rerender(<CanvasFrame width={1280} title="Home" source={TEST_SOURCE} />);
    expect(root?.hasAttribute("data-nx-theme")).toBe(false);
    expect(root?.hasAttribute("data-nx-empty-elements")).toBe(false);
  });

  it("hands the page the admin's tokens its in-page chrome reads, and again when the theme changes", async () => {
    /*
     * jsdom does not inherit custom properties into a computed style, so the
     * value where the frame sits is stated for the frame directly, as a
     * browser would compute it from the editor's scope above.
     */
    let border = "rgb(1, 2, 3)";
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) => {
        const style = computed(element, pseudo);
        if (element.tagName !== "IFRAME") return style;
        return {
          ...style,
          getPropertyValue: (name: string) =>
            name === "--nx-builder-border" ? border : "",
        } as CSSStyleDeclaration;
      }
    );
    const { container } = render(
      <CanvasFrame width={1280} title="Home" source={TEST_SOURCE} />
    );
    const frame = frameIn(container);
    loadPage(frame);
    const root = frame.contentDocument?.documentElement;
    expect(root?.style.getPropertyValue("--nx-builder-border")).toBe(
      "rgb(1, 2, 3)"
    );
    // A token the editor does not declare is not invented.
    expect(root?.style.getPropertyValue("--nx-builder-accent")).toBe("");

    // The admin switches its theme on its own root; the page follows.
    border = "rgb(4, 5, 6)";
    await act(async () => {
      document.documentElement.classList.add("dark");
    });
    expect(root?.style.getPropertyValue("--nx-builder-border")).toBe(
      "rgb(4, 5, 6)"
    );
    document.documentElement.classList.remove("dark");
    vi.restoreAllMocks();
  });

  it("hands its frame to the provider above it, for the code around the canvas", () => {
    let seen: ReturnType<typeof useCanvasFrame> | null = null;
    function Beside(): null {
      seen = useCanvasFrame();
      return null;
    }
    const { container } = render(
      <CanvasFrameProvider>
        <Beside />
        <CanvasFrame width={1280} title="Home" source={TEST_SOURCE} />
      </CanvasFrameProvider>
    );
    const frame = frameIn(container);
    loadPage(frame);
    const reading = seen as ReturnType<typeof useCanvasFrame> | null;
    expect(reading?.frame).toBe(frame);
    expect(reading?.document).toBe(frame.contentDocument);
    expect(reading?.document).not.toBe(document);
  });

  it("mounts the page once under Strict Mode", () => {
    const { container } = render(
      <React.StrictMode>
        <CanvasFrame width={1280} title="Home" source={TEST_SOURCE}>
          <Page />
        </CanvasFrame>
      </React.StrictMode>
    );
    const frame = frameIn(container);
    loadPage(frame);
    const inside = frame.contentDocument;
    expect(inside?.querySelectorAll(".nx-canvas")).toHaveLength(1);
    expect(inside?.querySelectorAll("style")).toHaveLength(1);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("draws its overlay in the editor's document, over the frame", () => {
    const { container } = render(
      <CanvasFrame
        width={1280}
        title="Home"
        source={TEST_SOURCE}
        overlay={<div data-testid="chrome" />}
      >
        <Page />
      </CanvasFrame>
    );
    loadPage(frameIn(container));
    const chrome = container.querySelector('[data-testid="chrome"]');
    expect(chrome?.closest("[data-nx-canvas-layer]")).not.toBeNull();
  });
});

describe("the editor's own page source", () => {
  it("takes its own page and not the blank page a frame starts with", () => {
    const blank = document.implementation.createHTMLDocument("");
    expect(SRCDOC_FRAME_SOURCE.ready(blank)).toBe(false);
    const own = new DOMParser().parseFromString(
      SRCDOC_FRAME_SOURCE.srcDoc,
      "text/html"
    );
    expect(SRCDOC_FRAME_SOURCE.ready(own)).toBe(true);
    expect(SRCDOC_FRAME_SOURCE.mountPoint(own)).toBe(own.body);
    // Standards mode: a page without the doctype is laid out in quirks mode.
    expect(own.compatMode).toBe("CSS1Compat");
  });

  it("declares its box-sizing default first, in a layer below anything a site loads later", () => {
    const own = new DOMParser().parseFromString(
      SRCDOC_FRAME_SOURCE.srcDoc,
      "text/html"
    );
    // The first sheet in the page, ahead of anything appended to the head or
    // drawn with the page, so its layer is the first declared and the lowest.
    const first = own.querySelector("style");
    expect(first?.parentElement).toBe(own.head);
    expect(first?.textContent).toBe(CANVAS_FRAME_DEFAULTS);
    expect(CANVAS_FRAME_DEFAULTS).toMatch(
      /^@layer [\w-]+ \{ \*, ::before, ::after \{ box-sizing: border-box; \} \}$/
    );
  });
});
