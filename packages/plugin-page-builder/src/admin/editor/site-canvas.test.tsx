// @vitest-environment jsdom
/**
 * The canvas inside the site's own layout, from the editor's side: the frame
 * source for the site's canvas route, and the note when it is not used.
 *
 * The route's page is the real `PageBuilderCanvas`, rendered into a document
 * of its own, so the editor's source is asked about exactly the markup a site
 * serves: the two sides agree on attribute names by construction, and this
 * holds them to it.
 *
 * @module admin/editor/site-canvas.test
 */
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let locale: { rtl: boolean; code?: string | null } | null = null;

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useDocumentLocale: () => locale,
}));

const { PageBuilderCanvas } = await import("../../canvas");
const {
  canvasPathFor,
  readCanvasPath,
  siteCanvasSource,
  SiteLayoutNote,
  useSiteCanvas,
} = await import("./site-canvas");

afterEach(() => {
  cleanup();
  locale = null;
  document.body.innerHTML = "";
});

/**
 * The route's page, as the site's React root renders and hydrates it, in a
 * frame's document: one with a window, as the editor's frame holds.
 */
function servedPage(): { doc: Document; unmount: () => void } {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const doc = frame.contentDocument;
  if (doc === null) throw new Error("no frame document");
  const container = doc.createElement("main");
  doc.body.append(container);
  const { unmount } = render(<PageBuilderCanvas />, { container });
  return { doc, unmount };
}

describe("the site's canvas route, as the editor reads it", () => {
  it("is served, ready, and mounts the canvas in its mount point once hydrated", () => {
    const source = siteCanvasSource("/page-builder-canvas");
    expect("src" in source && source.src).toBe("/page-builder-canvas");
    const { doc } = servedPage();
    expect("served" in source && source.served(doc)).toBe(true);
    expect(source.ready(doc)).toBe(true);
    const mount = source.mountPoint(doc);
    expect(mount?.parentElement?.localName).toBe("main");
    // It holds nothing of its own, so the site's React never touches what the
    // editor portals in.
    expect(mount?.childNodes).toHaveLength(0);
    // And it draws no box of its own, so the page drawn in it sits in the
    // site's layout where the published page does: a flex or grid layout lays
    // out what is portalled in, not the mount.
    expect(
      mount === null ? "" : doc.defaultView?.getComputedStyle(mount).display
    ).toBe("contents");
  });

  it("is not served by a page without the mount point", () => {
    const source = siteCanvasSource("/page-builder-canvas");
    const doc = document.implementation.createHTMLDocument("not found");
    doc.body.innerHTML = "<main><h1>Not found</h1></main>";
    expect("served" in source && source.served(doc)).toBe(false);
    expect(source.ready(doc)).toBe(false);
  });

  it("says its readiness changed when the site's root takes the mount point away", async () => {
    const source = siteCanvasSource("/page-builder-canvas");
    const { doc, unmount } = servedPage();
    const changed = vi.fn();
    const stop = "watch" in source ? source.watch(doc, changed) : () => {};
    await act(async () => {
      unmount();
      await Promise.resolve();
    });
    expect(changed).toHaveBeenCalled();
    expect(source.ready(doc)).toBe(false);
    stop();
  });
});

describe("the canvas route's path from the client config", () => {
  it("is read when it is a path, and absent otherwise", () => {
    expect(readCanvasPath({ canvasPath: "/c" })).toBe("/c");
    expect(readCanvasPath({ canvasPath: "" })).toBeUndefined();
    expect(readCanvasPath({ canvasPath: 7 })).toBeUndefined();
    expect(readCanvasPath(undefined)).toBeUndefined();
  });
});

describe("the canvas route for the language being edited", () => {
  it("puts the language's code where the path says {locale}", () => {
    expect(canvasPathFor("/{locale}/page-builder-canvas", "ar")).toBe(
      "/ar/page-builder-canvas"
    );
    expect(canvasPathFor("/page-builder-canvas/{locale}", "fr-CA")).toBe(
      "/page-builder-canvas/fr-CA"
    );
  });

  it("leaves the default language unprefixed, as most localized sites route it", () => {
    expect(canvasPathFor("/{locale}/page-builder-canvas", null)).toBe(
      "/page-builder-canvas"
    );
    // Never two slashes at the start: that would name another host.
    expect(canvasPathFor("/{locale}", null)).toBe("/");
  });

  it("leaves a path without the placeholder as it is", () => {
    expect(canvasPathFor("/page-builder-canvas", "ar")).toBe(
      "/page-builder-canvas"
    );
  });

  it("loads the route for the language being edited", () => {
    locale = { rtl: true, code: "ar" };
    const { result } = renderHook(() =>
      useSiteCanvas({ canvasPath: "/{locale}/page-builder-canvas" })
    );
    const source = result.current.canvasSource;
    expect(source !== undefined && "src" in source && source.src).toBe(
      "/ar/page-builder-canvas"
    );
  });
});

describe("the editor's site canvas", () => {
  it("draws on the blank page, and says nothing, where the site has no canvas route", () => {
    // Every site that has not opted in: a note there would never go away.
    const { result } = renderHook(() => useSiteCanvas({}));
    expect(result.current.canvasSource).toBeUndefined();
    expect(result.current.canvasFallback).toBeNull();
  });

  it("loads the route, and says why when the frame falls back from it", () => {
    const { result, rerender } = renderHook(() =>
      useSiteCanvas({ canvasPath: "/page-builder-canvas" })
    );
    const first = result.current.canvasSource;
    expect(first).toBeDefined();
    expect(result.current.canvasFallback).toBeNull();

    act(() => result.current.onCanvasFallback("not-served"));
    expect(result.current.canvasFallback).toBe("not-served");
    // One source for the life of the path, so the frame holds its refusal
    // against it rather than loading the route again on every render.
    rerender();
    expect(result.current.canvasSource).toBe(first);
  });

  it("writes the page in the direction of the language being edited", () => {
    locale = { rtl: true };
    const { result, rerender } = renderHook(() => useSiteCanvas({}));
    expect(result.current.canvasDir).toBe("rtl");
    locale = { rtl: false };
    rerender();
    expect(result.current.canvasDir).toBe("ltr");
  });
});

describe("the note above a canvas without the site's layout", () => {
  it("says nothing while the site's own page is shown", () => {
    const { container } = render(<SiteLayoutNote fallback={null} />);
    expect(container.childNodes).toHaveLength(0);
  });

  it.each(["other-origin", "not-served", "not-ready"] as const)(
    "says what is shown, in the author's words, with the docs one press away, for %s",
    fallback => {
      render(<SiteLayoutNote fallback={fallback} />);
      const note = screen.getByRole("status");
      expect(note.textContent).toBe(
        "Shown without your site’s header, footer and styles. The site’s canvas page didn’t load. Details"
      );
      // The reason stays on the note, for a test or whoever debugs it.
      expect(note.getAttribute("data-canvas-state")).toBe(
        `site-layout-${fallback}`
      );
      const details = screen.getByRole("link", { name: /^Details/ });
      expect(details.getAttribute("href")).toBe(
        "https://nextlyhq.com/docs/page-builder#draw-the-canvas-in-your-sites-layout"
      );
      expect(details.getAttribute("target")).toBe("_blank");
    }
  );
});
