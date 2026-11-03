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
