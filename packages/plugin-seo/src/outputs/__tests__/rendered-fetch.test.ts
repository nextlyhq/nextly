/**
 * The rendered page a copy is made from: asked for once and kept a while,
 * and never read past its size limit, whether or not the page says its
 * length.
 *
 * What each case pins:
 * - a page answered with HTML is copied, and a second ask within the time
 *   it is kept fetches nothing;
 * - a page whose body runs past 6 MB with no Content-Length is given up
 *   without reading the rest of it;
 * - a page answered with anything but HTML, or with a redirect, has no copy;
 * - a page whose body breaks off after its headers has no copy, rather
 *   than an error the caller would have to catch;
 * - each page with no copy says why, in the words the problem list shows:
 *   its status, a time-out, its size, or no main content.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderedCopyAt } from "../rendered-fetch";

const PAGE = "https://acme.example/pricing";

afterEach(() => {
  vi.restoreAllMocks();
});

const html =
  "<html><head><title>Pricing</title></head><body><main><p>Words.</p></main></body></html>";

describe("the rendered page a copy is made from", () => {
  it("is asked for once and kept", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () =>
          new Response(html, { headers: { "content-type": "text/html" } })
      );
    const owner = {};
    const bodyOf = async () => {
      const rendered = await renderedCopyAt(owner, PAGE, PAGE);
      return "copy" in rendered ? rendered.copy.body : rendered.failed;
    };
    expect(await bodyOf()).toBe("Words.");
    expect(await bodyOf()).toBe("Words.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("is given up past its size limit, though it names no length", async () => {
    const chunk = new TextEncoder().encode("<p>".padEnd(1024 * 1024, "x"));
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        // Endless: a page that never stops is read no further than the limit.
        controller.enqueue(chunk);
      },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(body, { headers: { "content-type": "text/html" } })
    );
    expect(await renderedCopyAt({}, PAGE, PAGE)).toEqual({
      failed: "over 6 MB",
    });
    expect(pulled).toBeLessThan(12);
  });

  it("has no copy where the page answers with no HTML", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(null, { status: 307, headers: { location: "/x" } })
    );
    expect(await renderedCopyAt({}, PAGE, PAGE)).toEqual({
      failed: "status 307",
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response("{}", { headers: { "content-type": "application/json" } })
    );
    expect(await renderedCopyAt({}, PAGE, PAGE)).toEqual({
      failed: "not an HTML page",
    });
  });

  it("has no copy where the page's body breaks off after its headers", async () => {
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.error(new Error("connection reset"));
          return;
        }
        sent = true;
        controller.enqueue(new TextEncoder().encode("<html><body><main>"));
      },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(body, { headers: { "content-type": "text/html" } })
    );
    await expect(renderedCopyAt({}, PAGE, PAGE)).resolves.toEqual({
      failed: "the page could not be reached",
    });
  });

  it("says why a page gave no copy: an error status, a time-out, or no main content", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response("<html><body>Oops</body></html>", {
          status: 500,
          headers: { "content-type": "text/html" },
        })
    );
    expect(await renderedCopyAt({}, PAGE, PAGE)).toEqual({
      failed: "status 500",
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    expect(await renderedCopyAt({}, PAGE, PAGE)).toEqual({
      failed: "timed out after 10 s",
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response("<html><body><nav>Menu</nav></body></html>", {
          headers: { "content-type": "text/html" },
        })
    );
    expect(await renderedCopyAt({}, PAGE, PAGE)).toEqual({
      failed: "no main content (<main>)",
    });
  });
});
