// @vitest-environment jsdom

/**
 * The canvas frame showing a page the SITE serves: an empty mount point inside
 * the site's own layout, which the canvas is portalled into.
 *
 * jsdom never loads a frame's `src`, so the site's page is written into the
 * frame's document by hand and `load` dispatched, which is what a browser
 * does when the route's page arrives. The site's hydration is the ready marker
 * being set on the mount point, as the route's own page sets it.
 *
 * @module canvas-frame-site.test
 */
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CanvasFrame,
  isPageAt,
  type CanvasFrameFallback,
  type SiteFrameSource,
} from "./canvas-frame";
import { SITE_CHROME_ATTRIBUTE } from "./canvas-frame-sheet";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const MOUNT = "data-test-mount";
const READY = "data-test-ready";

/** A site's canvas route at `src`, recognised by the test's own markers. */
function siteSource(src = "/canvas"): SiteFrameSource {
  return {
    src,
    served: doc => doc.querySelector(`[${MOUNT}]`) !== null,
    ready: doc => doc.querySelector(`[${MOUNT}][${READY}]`) !== null,
    mountPoint: doc => doc.querySelector<HTMLElement>(`[${MOUNT}][${READY}]`),
    watch: (doc, changed) => {
      const Mutations = doc.defaultView?.MutationObserver;
      if (Mutations === undefined) return () => undefined;
      const watch = new Mutations(changed);
      watch.observe(doc.documentElement, {
        subtree: true,
        attributes: true,
        attributeFilter: [READY],
      });
      return () => watch.disconnect();
    },
  };
}

/** The site's layout around an empty mount point, as its route serves it. */
const SITE_PAGE = `
  <header id="site-header"><a href="/">Home</a><form><input name="q"></form></header>
  <main id="site-main">
    <p id="beside-mount">Above the page</p>
    <div ${MOUNT}=""></div>
  </main>
  <aside id="already-inert" inert="">Kept as the site made it</aside>
  <script id="site-script"></script>
  <footer id="site-footer">Footer</footer>
`;

function frameIn(container: HTMLElement): HTMLIFrameElement {
  const frame = container.querySelector("iframe");
  if (frame === null) throw new Error("no frame drawn");
  return frame;
}

function frameDocument(frame: HTMLIFrameElement): Document {
  const doc = frame.contentDocument;
  if (doc === null) throw new Error("no frame document");
  return doc;
}

/** What a browser does when a page arrives in the frame. */
function arrive(frame: HTMLIFrameElement, body: string): void {
  act(() => {
    // The whole page, root element and all: jsdom gives a frame whose `src`
    // it never loads an empty document.
    const doc = frameDocument(frame);
    doc.replaceChildren(doc.createElement("html"));
    doc.documentElement.innerHTML = `<head></head><body>${body}</body>`;
    frame.dispatchEvent(new Event("load"));
  });
}

/** What the route's page does once the site's React root has hydrated it. */
async function hydrate(frame: HTMLIFrameElement): Promise<void> {
  await act(async () => {
    frameDocument(frame).querySelector(`[${MOUNT}]`)?.setAttribute(READY, "");
    // The readiness watch is a mutation observer, answered as a microtask.
    await Promise.resolve();
  });
}

function Page(): React.JSX.Element {
  return <div className="nx-canvas" data-testid="page" />;
}

describe("the canvas frame on a page the site serves", () => {
  it("loads the route and draws the page in its mount point once the site has hydrated it", async () => {
    const source = siteSource();
    const { container } = render(
      <CanvasFrame width={1280} title="Home" source={source}>
        <Page />
      </CanvasFrame>
    );
    const frame = frameIn(container);
    expect(frame.getAttribute("src")).toBe("/canvas");
    expect(frame.hasAttribute("srcdoc")).toBe(false);

    arrive(frame, SITE_PAGE);
    const doc = frameDocument(frame);
    // Served but not hydrated: an element added now would not match what the
    // server sent, and the site's root would throw its own markup away.
    expect(doc.querySelector(".nx-canvas")).toBeNull();

    await hydrate(frame);
    const mount = doc.querySelector(`[${MOUNT}]`);
    expect(mount?.querySelector(".nx-canvas")).not.toBeNull();
    // The site's own layout is still there around it.
    expect(doc.getElementById("site-header")).not.toBeNull();
  });

  it("makes the site's layout around the mount point inert and quiet, and gives it back", async () => {
    const { container, unmount } = render(
      <CanvasFrame width={1280} title="Home" source={siteSource()}>
        <Page />
      </CanvasFrame>
    );
    const frame = frameIn(container);
    arrive(frame, SITE_PAGE);
    await hydrate(frame);
    const doc = frameDocument(frame);
    const byId = (id: string) => doc.getElementById(id);

    // Beside the mount point, and beside each of its ancestors.
    for (const id of ["beside-mount", "site-header", "site-footer"]) {
      expect(byId(id)?.hasAttribute("inert"), id).toBe(true);
      expect(byId(id)?.hasAttribute(SITE_CHROME_ATTRIBUTE), id).toBe(true);
    }
    // The ancestors hold the canvas, so they stay live; what draws nothing is
    // left alone.
    expect(byId("site-main")?.hasAttribute("inert")).toBe(false);
    expect(byId("site-script")?.hasAttribute(SITE_CHROME_ATTRIBUTE)).toBe(
      false
    );

    // Something the layout draws later is marked too.
    const late = doc.createElement("nav");
    await act(async () => {
      byId("site-main")?.append(late);
      await Promise.resolve();
    });
    expect(late.hasAttribute("inert")).toBe(true);

    // Held before the frame goes, since its document goes with it.
    const header = byId("site-header");
    const alreadyInert = byId("already-inert");
    unmount();
    expect(header?.hasAttribute("inert")).toBe(false);
    expect(header?.hasAttribute(SITE_CHROME_ATTRIBUTE)).toBe(false);
    // What the site made inert itself stays so.
    expect(alreadyInert?.hasAttribute("inert")).toBe(true);
  });

  it("draws a cue over each part of the site's layout, in the editor's document", async () => {
    const { container } = render(
      <CanvasFrame width={1280} title="Home" source={siteSource()}>
        <Page />
      </CanvasFrame>
    );
    const frame = frameIn(container);
    arrive(frame, SITE_PAGE);
    await hydrate(frame);
    const cues = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(".nx-site-chrome-cue")
      );
    // The text beside the mount point, the header, the aside the site made
    // inert itself and the footer; the script draws nothing and gets none.
    expect(cues()).toHaveLength(4);
    for (const cue of cues()) {
      expect(cue.title).toBe(
        "Part of your site’s layout. It comes from your site’s code and can’t be edited here."
      );
      expect(cue.textContent).toBe("Part of your site’s layout");
      // In the editor's document, over the frame, never in the page.
      expect(cue.ownerDocument).toBe(document);
    }
    // A part the layout draws later gets one too.
    await act(async () => {
      frameDocument(frame)
        .getElementById("site-main")
        ?.append(frameDocument(frame).createElement("nav"));
      await Promise.resolve();
    });
    expect(cues()).toHaveLength(5);
  });

  it("moves a cue when the part it covers moves without resizing", async () => {
    const { container } = render(
      <CanvasFrame width={1280} title="Home" source={siteSource()}>
        <Page />
      </CanvasFrame>
    );
    const frame = frameIn(container);
    arrive(frame, SITE_PAGE);
    const doc = frameDocument(frame);
    // What each size watch in the frame observes, and how to tell it a size
    // changed: jsdom lays nothing out, so the test says when.
    const watches: { targets: Element[]; changed: () => void }[] = [];
    class Sizes {
      private readonly targets: Element[] = [];
      constructor(changed: () => void) {
        watches.push({ targets: this.targets, changed });
      }
      observe(target: Element): void {
        this.targets.push(target);
      }
      disconnect(): void {}
    }
    Object.defineProperty(doc.defaultView, "ResizeObserver", {
      value: Sizes,
      configurable: true,
    });
    await hydrate(frame);
    const footer = doc.getElementById("site-footer");
    if (footer === null) throw new Error("no footer");
    const cue = Array.from(
      container.querySelectorAll<HTMLElement>(".nx-site-chrome-cue")
    )[3];
    // The page above the footer grows: the footer moves down, its own size
    // the same, and the page's body is what changes size.
    footer.getBoundingClientRect = () => new DOMRect(0, 500, 1280, 40);
    const body = watches.find(watch => watch.targets.includes(doc.body));
    expect(body, "the page's body is watched").toBeDefined();
    act(() => body?.changed());
    expect(Number.parseFloat(cue?.style.top ?? "0")).toBeGreaterThan(0);
  });

  it("takes a cue away with the part the site's layout removes", async () => {
    const { container } = render(
      <CanvasFrame width={1280} title="Home" source={siteSource()}>
        <Page />
      </CanvasFrame>
    );
    const frame = frameIn(container);
    arrive(frame, SITE_PAGE);
    await hydrate(frame);
    const cues = () => container.querySelectorAll(".nx-site-chrome-cue");
    expect(cues()).toHaveLength(4);
    // The site's own client code drops its header, with no navigation.
    await act(async () => {
      frameDocument(frame).getElementById("site-header")?.remove();
      await Promise.resolve();
    });
    expect(cues()).toHaveLength(3);
  });

  it("falls back to the blank page, and says why, when the page loaded is not the route", () => {
    const onSourceFallback =
      vi.fn<(reason: CanvasFrameFallback | null) => void>();
    const { container } = render(
      <CanvasFrame
        width={1280}
        title="Home"
        source={siteSource()}
        onSourceFallback={onSourceFallback}
      >
        <Page />
      </CanvasFrame>
    );
    const frame = frameIn(container);
    // Before the route arrives, the empty page every frame starts with is
    // waited for, not refused.
    expect(onSourceFallback).toHaveBeenLastCalledWith(null);

    // A "not found" page in the site's layout: no mount point.
    arrive(frame, "<main><h1>Not found</h1></main>");
    expect(onSourceFallback).toHaveBeenLastCalledWith("not-served");
    expect(frame.hasAttribute("src")).toBe(false);
    expect(frame.getAttribute("srcdoc")).toContain("<!doctype html>");
    // The same element: the frame is never re-keyed.
    expect(frameIn(container)).toBe(frame);
  });

  it("never loads a page on another origin", () => {
    const onSourceFallback =
      vi.fn<(reason: CanvasFrameFallback | null) => void>();
    const { container } = render(
      <CanvasFrame
        width={1280}
        title="Home"
        source={siteSource("https://elsewhere.example/canvas")}
        onSourceFallback={onSourceFallback}
      />
    );
    const frame = frameIn(container);
    expect(frame.hasAttribute("src")).toBe(false);
    expect(frame.getAttribute("srcdoc")).toContain("<!doctype html>");
    expect(onSourceFallback).toHaveBeenLastCalledWith("other-origin");
  });

  it("falls back when the route never says it is ready", () => {
    vi.useFakeTimers();
    const onSourceFallback =
      vi.fn<(reason: CanvasFrameFallback | null) => void>();
    const { container } = render(
      <CanvasFrame
        width={1280}
        title="Home"
        source={siteSource()}
        onSourceFallback={onSourceFallback}
      />
    );
    const frame = frameIn(container);
    arrive(frame, SITE_PAGE);
    act(() => {
      vi.advanceTimersByTime(19_000);
    });
    expect(onSourceFallback).toHaveBeenLastCalledWith(null);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(onSourceFallback).toHaveBeenLastCalledWith("not-ready");
    expect(frame.hasAttribute("src")).toBe(false);
  });

  it("tries a new route afresh after an earlier one was refused", () => {
    const onSourceFallback =
      vi.fn<(reason: CanvasFrameFallback | null) => void>();
    const { container, rerender } = render(
      <CanvasFrame
        width={1280}
        title="Home"
        source={siteSource()}
        onSourceFallback={onSourceFallback}
      />
    );
    arrive(frameIn(container), "<main></main>");
    expect(onSourceFallback).toHaveBeenLastCalledWith("not-served");

    rerender(
      <CanvasFrame
        width={1280}
        title="Home"
        source={siteSource("/another-canvas")}
        onSourceFallback={onSourceFallback}
      />
    );
    expect(frameIn(container).getAttribute("src")).toBe("/another-canvas");
    expect(onSourceFallback).toHaveBeenLastCalledWith(null);
  });

  it("keeps the theme the site's own page states, unless the editor names one", async () => {
    const source = siteSource();
    const { container, rerender } = render(
      <CanvasFrame width={1280} title="Home" source={source}>
        <Page />
      </CanvasFrame>
    );
    const frame = frameIn(container);
    act(() => {
      const doc = frameDocument(frame);
      doc.replaceChildren(doc.createElement("html"));
      // The site's layout sets its default mode on its own root.
      doc.documentElement.setAttribute("data-nx-theme", "dark");
      doc.documentElement.innerHTML = `<head></head><body>${SITE_PAGE}</body>`;
      frame.dispatchEvent(new Event("load"));
    });
    await hydrate(frame);
    const root = frameDocument(frame).documentElement;
    expect(root.getAttribute("data-nx-theme")).toBe("dark");

    rerender(
      <CanvasFrame width={1280} title="Home" source={source} theme="light">
        <Page />
      </CanvasFrame>
    );
    expect(root.getAttribute("data-nx-theme")).toBe("light");

    // Named no longer: the site's own value comes back.
    rerender(
      <CanvasFrame width={1280} title="Home" source={source}>
        <Page />
      </CanvasFrame>
    );
    expect(root.getAttribute("data-nx-theme")).toBe("dark");
  });

  it("falls back when the route never loads at all", () => {
    vi.useFakeTimers();
    const onSourceFallback =
      vi.fn<(reason: CanvasFrameFallback | null) => void>();
    render(
      <CanvasFrame
        width={1280}
        title="Home"
        source={siteSource()}
        onSourceFallback={onSourceFallback}
      />
    );
    // No response, so no load: the frame still holds the page it starts with.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(onSourceFallback).toHaveBeenLastCalledWith("not-ready");
  });

  it("falls back when the site takes the mount point away and never brings it back", async () => {
    const onSourceFallback =
      vi.fn<(reason: CanvasFrameFallback | null) => void>();
    const { container } = render(
      <CanvasFrame
        width={1280}
        title="Home"
        source={siteSource()}
        onSourceFallback={onSourceFallback}
      >
        <Page />
      </CanvasFrame>
    );
    const frame = frameIn(container);
    arrive(frame, SITE_PAGE);
    await hydrate(frame);
    vi.useFakeTimers();
    const mount = frameDocument(frame).querySelector(`[${MOUNT}]`);
    await act(async () => {
      mount?.removeAttribute(READY);
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(19_000);
    });
    expect(onSourceFallback).toHaveBeenLastCalledWith(null);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(onSourceFallback).toHaveBeenLastCalledWith("not-ready");
  });

  it("keeps the route when the site brings its mount point back in time", async () => {
    const onSourceFallback =
      vi.fn<(reason: CanvasFrameFallback | null) => void>();
    const { container } = render(
      <CanvasFrame
        width={1280}
        title="Home"
        source={siteSource()}
        onSourceFallback={onSourceFallback}
      >
        <Page />
      </CanvasFrame>
    );
    const frame = frameIn(container);
    arrive(frame, SITE_PAGE);
    await hydrate(frame);
    vi.useFakeTimers();
    const mount = frameDocument(frame).querySelector(`[${MOUNT}]`);
    await act(async () => {
      mount?.removeAttribute(READY);
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    await act(async () => {
      mount?.setAttribute(READY, "");
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onSourceFallback).toHaveBeenLastCalledWith(null);
    expect(mount?.querySelector(".nx-canvas")).not.toBeNull();
  });

  it("leaves the site's own theme as it is now, when the editor names none", async () => {
    const source = siteSource();
    const { container, rerender } = render(
      <CanvasFrame width={1280} title="Home" source={source}>
        <Page />
      </CanvasFrame>
    );
    const frame = frameIn(container);
    act(() => {
      const doc = frameDocument(frame);
      doc.replaceChildren(doc.createElement("html"));
      doc.documentElement.setAttribute("data-nx-theme", "dark");
      doc.documentElement.innerHTML = `<head></head><body>${SITE_PAGE}</body>`;
      frame.dispatchEvent(new Event("load"));
    });
    await hydrate(frame);
    const root = frameDocument(frame).documentElement;
    // The site switches its own mode after hydrating, from a preference.
    root.setAttribute("data-nx-theme", "light");
    // An unrelated change re-runs the editor's markers.
    rerender(
      <CanvasFrame
        width={1280}
        title="Home"
        source={source}
        showEmptyElements={false}
      >
        <Page />
      </CanvasFrame>
    );
    expect(root.getAttribute("data-nx-theme")).toBe("light");
  });

  it("waits for a new route rather than drawing into the page the last one left", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const onSourceFallback =
      vi.fn<(reason: CanvasFrameFallback | null) => void>();
    const { container, rerender } = render(
      <CanvasFrame
        width={1280}
        title="Home"
        source={siteSource("/canvas")}
        onSourceFallback={onSourceFallback}
      >
        <Page />
      </CanvasFrame>
    );
    const frame = frameIn(container);
    arrive(frame, SITE_PAGE);
    await hydrate(frame);
    const mount = frameDocument(frame).querySelector(`[${MOUNT}]`);
    expect(mount?.querySelector(".nx-canvas")).not.toBeNull();

    // Another language's route: the frame still holds the last page, ready,
    // until the new one loads.
    rerender(
      <CanvasFrame
        width={1280}
        title="Home"
        source={siteSource("/ar/canvas")}
        onSourceFallback={onSourceFallback}
      >
        <Page />
      </CanvasFrame>
    );
    expect(mount?.querySelector(".nx-canvas")).toBeNull();
    // And a new route that never loads falls back like any other.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(onSourceFallback).toHaveBeenLastCalledWith("not-ready");
  });

  it("stops drawing into a mount point the site takes away", async () => {
    const { container } = render(
      <CanvasFrame width={1280} title="Home" source={siteSource()}>
        <Page />
      </CanvasFrame>
    );
    const frame = frameIn(container);
    arrive(frame, SITE_PAGE);
    await hydrate(frame);
    const doc = frameDocument(frame);
    const mount = doc.querySelector(`[${MOUNT}]`);
    expect(mount?.querySelector(".nx-canvas")).not.toBeNull();

    // The route's page clears its marker as the site's root unmounts it.
    await act(async () => {
      mount?.removeAttribute(READY);
      await Promise.resolve();
    });
    expect(mount?.querySelector(".nx-canvas")).toBeNull();
  });
});

describe("which page a frame holds", () => {
  const SITE = "http://localhost:3000/";

  it("is the route's page at the route's address, whatever its fragment", () => {
    expect(isPageAt(`${SITE}canvas`, SITE, "/canvas")).toBe(true);
    expect(isPageAt(`${SITE}canvas#top`, SITE, "/canvas")).toBe(true);
  });

  it("is not the page another route left behind", () => {
    // The frame still holds the last language's route while the next loads.
    expect(isPageAt(`${SITE}canvas`, SITE, "/ar/canvas")).toBe(false);
    expect(isPageAt("about:blank", SITE, "/canvas")).toBe(false);
  });
});
