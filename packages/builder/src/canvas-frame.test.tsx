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
    const sheet =
      inside.querySelector("style:not([data-nx-page-chrome-tokens])")
        ?.textContent ?? "";
    expect(sheet).toContain(
      ":where(:root[data-nx-canvas-frame]), :where(:root[data-nx-canvas-frame]) body { margin: 0; padding: 0; }"
    );
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

  it("states the site's theme on the page's root", () => {
    const { container, rerender } = render(
      <CanvasFrame
        width={1280}
        title="Home"
        theme="dark"
        source={TEST_SOURCE}
      />
    );
    const frame = frameIn(container);
    loadPage(frame);
    const root = frame.contentDocument?.documentElement;
    expect(root?.getAttribute("data-nx-theme")).toBe("dark");

    rerender(<CanvasFrame width={1280} title="Home" source={TEST_SOURCE} />);
    expect(root?.hasAttribute("data-nx-theme")).toBe(false);
  });

  it("states a light or dark theme as the iframe element's own colour scheme, and nothing once it is unset", () => {
    // On the ELEMENT, not the page inside: a frame's prefers-color-scheme
    // follows the scheme of the element embedding it. No page is loaded, so
    // this is the element alone and not the marker on the frame's document.
    const { container, rerender } = render(
      <CanvasFrame
        width={1280}
        title="Home"
        theme="dark"
        source={TEST_SOURCE}
      />
    );
    const frame = frameIn(container);
    expect(frame.style.colorScheme).toBe("dark");

    rerender(
      <CanvasFrame
        width={1280}
        title="Home"
        theme="light"
        source={TEST_SOURCE}
      />
    );
    expect(frame.style.colorScheme).toBe("light");

    // A theme that is no colour scheme states none.
    rerender(
      <CanvasFrame
        width={1280}
        title="Home"
        theme="brand"
        source={TEST_SOURCE}
      />
    );
    expect(frame.style.colorScheme).toBe("");

    rerender(
      <CanvasFrame
        width={1280}
        title="Home"
        theme="dark"
        source={TEST_SOURCE}
      />
    );
    rerender(<CanvasFrame width={1280} title="Home" source={TEST_SOURCE} />);
    expect(frame.style.colorScheme).toBe("");
    // The rest of the element's style is kept as it was.
    expect(frame.style.width).toBe("1280px");
  });

  it("hands the region chrome the admin's tokens, scoped to it, and again when the theme changes", async () => {
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
            name === "--nx-builder-border"
              ? border
              : name === "--font-sans"
                ? "Inter"
                : "",
        } as CSSStyleDeclaration;
      }
    );
    const { container } = render(
      <CanvasFrame width={1280} title="Home" source={TEST_SOURCE} />
    );
    const frame = frameIn(container);
    loadPage(frame);
    const page = frame.contentDocument;
    /** The value a token is handed for elements matching `selector`. */
    const handed = (selector: string, token: string): string | undefined => {
      for (const sheet of Array.from(page?.styleSheets ?? [])) {
        for (const rule of Array.from(sheet.cssRules)) {
          if (!(rule instanceof CSSStyleRule)) continue;
          if (rule.selectorText !== selector) continue;
          const value = rule.style.getPropertyValue(token);
          if (value !== "") return value;
        }
      }
      return undefined;
    };
    const words = ".nx-canvas-region__mark";
    expect(handed(words, "--nx-builder-border")).toBe("rgb(1, 2, 3)");
    expect(handed(words, "--font-sans")).toBe("Inter");
    expect(handed(".nx-canvas-region", "--nx-builder-border")).toBe(
      "rgb(1, 2, 3)"
    );
    // The admin's face stays on its own words: the page's root, and the
    // region's site content, keep the site's own value of a shared name.
    expect(handed(".nx-canvas-region", "--font-sans")).toBe(undefined);
    expect(page?.documentElement.style.getPropertyValue("--font-sans")).toBe(
      ""
    );
    expect(
      page?.documentElement.style.getPropertyValue("--nx-builder-border")
    ).toBe("");
    // A token the editor does not declare is not invented.
    expect(handed(words, "--nx-builder-accent")).toBe(undefined);
    // A list's note to its author holds the admin's words alone, so it takes
    // the admin's face; a list showing its empty state holds the site's
    // content, so it takes none of a name a site may share.
    expect(handed("[data-nx-list-diagnostic]", "--font-sans")).toBe("Inter");
    expect(handed("[data-nx-list-shows]", "--font-sans")).toBe(undefined);

    // The admin switches its theme on its own root; the chrome follows.
    border = "rgb(4, 5, 6)";
    await act(async () => {
      document.documentElement.classList.add("dark");
    });
    expect(handed(words, "--nx-builder-border")).toBe("rgb(4, 5, 6)");
    document.documentElement.classList.remove("dark");
    vi.restoreAllMocks();
  });

  it("follows a theme switched on the admin's own scope around the frame, not only its root", async () => {
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
    // The admin's theme provider toggles `dark` on its own wrapper, which is
    // neither the document's root nor its body.
    const { container } = render(
      <div className="nextly-admin">
        <CanvasFrame width={1280} title="Home" source={TEST_SOURCE} />
      </div>
    );
    const scope = container.querySelector(".nextly-admin");
    const frame = frameIn(container);
    loadPage(frame);
    const sheet = frame.contentDocument?.querySelector(
      "style[data-nx-page-chrome-tokens]"
    ) as HTMLStyleElement | null;
    const borderNow = () =>
      Array.from(sheet?.sheet?.cssRules ?? [])
        .filter(rule => rule instanceof CSSStyleRule)
        .map(rule => rule.style.getPropertyValue("--nx-builder-border"))
        .find(value => value !== "");
    expect(borderNow()).toBe("rgb(1, 2, 3)");

    border = "rgb(4, 5, 6)";
    await act(async () => {
      scope?.classList.add("dark");
    });
    expect(borderNow()).toBe("rgb(4, 5, 6)");
    vi.restoreAllMocks();
  });

  it("states the page's language on the frame's document", () => {
    const { container, rerender } = render(
      <CanvasFrame width={1280} title="Home" source={TEST_SOURCE} lang="de" />
    );
    const frame = frameIn(container);
    loadPage(frame);
    const root = frame.contentDocument?.documentElement;
    expect(root?.getAttribute("lang")).toBe("de");

    // With no language of its own, the editor document's is the nearest.
    document.documentElement.lang = "fr";
    rerender(<CanvasFrame width={1280} title="Home" source={TEST_SOURCE} />);
    expect(root?.getAttribute("lang")).toBe("fr");
    document.documentElement.removeAttribute("lang");
  });

  it("states the page's direction on the frame's document", () => {
    const { container, rerender } = render(
      <CanvasFrame width={1280} title="Home" source={TEST_SOURCE} dir="rtl" />
    );
    const frame = frameIn(container);
    loadPage(frame);
    const root = frame.contentDocument?.documentElement;
    expect(root?.getAttribute("dir")).toBe("rtl");

    // With no direction of its own, the editor document's is the nearest.
    document.documentElement.dir = "ltr";
    rerender(<CanvasFrame width={1280} title="Home" source={TEST_SOURCE} />);
    expect(root?.getAttribute("dir")).toBe("ltr");
    document.documentElement.removeAttribute("dir");
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
    // The frame's sheet, and the one handing the region chrome its tokens.
    expect(
      inside?.querySelectorAll("style:not([data-nx-page-chrome-tokens])")
    ).toHaveLength(1);
    expect(
      inside?.querySelectorAll("style[data-nx-page-chrome-tokens]")
    ).toHaveLength(1);
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

  it("holds its pinned chrome at the viewport, outside the box the page's scroll moves", () => {
    const { container } = render(
      <CanvasFrame
        width={1280}
        title="Home"
        source={TEST_SOURCE}
        overlay={<div data-testid="marks" />}
        pinned={<div data-testid="tags" />}
      >
        <Page />
      </CanvasFrame>
    );
    loadPage(frameIn(container));
    const tags = container.querySelector('[data-testid="tags"]');
    const marks = container.querySelector('[data-testid="marks"]');
    // In the same layer as the overlay, so it takes the layer's colours...
    expect(tags?.closest("[data-nx-canvas-layer]")).not.toBeNull();
    // ...but not in the content box, which is moved with the page's scroll.
    // The control: the overlay is in that box.
    expect(tags?.closest(".nx-canvas-layer__content")).toBeNull();
    expect(marks?.closest(".nx-canvas-layer__content")).not.toBeNull();
    // Inset by the layer's bleed past the viewport, so its edges are the
    // viewport's.
    const pinned = tags?.closest<HTMLElement>(".nx-canvas-layer__pinned");
    expect(pinned?.style.inset).toBe("4px");
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
