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
 *   than an error the caller would have to catch.
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
    expect((await renderedCopyAt(owner, PAGE, PAGE))?.body).toBe("Words.");
    expect((await renderedCopyAt(owner, PAGE, PAGE))?.body).toBe("Words.");
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
    expect(await renderedCopyAt({}, PAGE, PAGE)).toBeNull();
    expect(pulled).toBeLessThan(12);
  });

  it("has no copy where the page answers with no HTML", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(null, { status: 307, headers: { location: "/x" } })
    );
    expect(await renderedCopyAt({}, PAGE, PAGE)).toBeNull();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response("{}", { headers: { "content-type": "application/json" } })
    );
    expect(await renderedCopyAt({}, PAGE, PAGE)).toBeNull();
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
    await expect(renderedCopyAt({}, PAGE, PAGE)).resolves.toBeNull();
  });
});
