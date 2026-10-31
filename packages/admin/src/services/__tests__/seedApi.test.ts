import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { post, debugLog } = vi.hoisted(() => ({
  post: vi.fn(),
  debugLog: vi.fn(),
}));
vi.mock("@admin/lib/api/protectedApi", () => ({ protectedApi: { post } }));
// Watched rather than silenced: an unexpected answer is said here, at debug
// level, and never as a console error.
vi.mock("@admin/lib/debug", () => ({ debugLog }));

import { seedApi } from "../seedApi";

describe("seedApi", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    post.mockReset();
    debugLog.mockReset();
  });

  describe("probe", () => {
    it("returns { available: false } on 404", async () => {
      global.fetch = vi.fn(
        async () => new Response(null, { status: 404 })
      ) as unknown as typeof fetch;
      const result = await seedApi.probe();
      expect(result).toEqual({ available: false });
    });

    it("returns not known on 503 (transient init failure): no offer, and no refusal either", async () => {
      global.fetch = vi.fn(
        async () => new Response(null, { status: 503 })
      ) as unknown as typeof fetch;
      expect(await seedApi.probe()).toEqual({
        available: false,
        unknown: true,
      });
    });

    it("returns not known if fetch throws", async () => {
      global.fetch = vi.fn(async () => {
        throw new Error("network");
      }) as unknown as typeof fetch;
      expect(await seedApi.probe()).toEqual({
        available: false,
        unknown: true,
      });
    });

    it("returns { available: true, template } on 200 with headers", async () => {
      global.fetch = vi.fn(
        async () =>
          new Response(null, {
            status: 200,
            headers: {
              "x-nextly-seed-template": "blog",
              "x-nextly-seed-template-label": "Blog",
            },
          })
      ) as unknown as typeof fetch;
      expect(await seedApi.probe()).toEqual({
        available: true,
        template: { slug: "blog", label: "Blog" },
      });
    });

    // "Available" means THIS person may load sample content, so every answer
    // but a success fails closed. Each refusal here carries the template
    // headers a success carries, although the blog template's route sends them
    // only with a 200: without them, a probe that offered on the headers rather
    // than on the status would pass these too.
    it.each([
      [401, "no session", {}],
      [403, "a person the route refuses", {}],
      [404, "no sample-content route in this project", {}],
      [400, "an admin API that refuses a path it does not serve", {}],
      [405, "a route that does not answer HEAD", {}],
      [410, "a route that is gone", {}],
      [501, "a server that does not implement HEAD", {}],
      // A 4xx that may not hold on the next ask stays not known, so the
      // probe is asked again rather than hiding the offer for good.
      [408, "a request that timed out", { unknown: true }],
      [409, "a conflict that may clear", { unknown: true }],
      [425, "too early", { unknown: true }],
      [429, "too many requests", { unknown: true }],
      [500, "the route failing", { unknown: true }],
      [503, "the server still starting", { unknown: true }],
    ])(
      "returns no offer on %i (%s), not known unless it is a refusal or no route",
      async (status, _why, extra) => {
        global.fetch = vi.fn(
          async () =>
            new Response(null, {
              status,
              headers: {
                "x-nextly-seed-template": "blog",
                "x-nextly-seed-template-label": "Blog",
              },
            })
        ) as unknown as typeof fetch;
        expect(await seedApi.probe()).toEqual({ available: false, ...extra });
      }
    );

    // A 400 is what Nextly's admin API catch-all answered for a project with
    // no sample-content route of its own, on every dashboard load. Read as
    // "not known", the step stayed open as unreadable and was asked again on
    // every read of the card.
    it("reads a 400, the old catch-all's answer, as no offer, said once at debug level and never as a console error", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      global.fetch = vi.fn(
        async () => new Response(null, { status: 400 })
      ) as unknown as typeof fetch;

      expect(await seedApi.probe()).toEqual({ available: false });
      expect(debugLog).toHaveBeenCalledTimes(1);
      expect(debugLog).toHaveBeenCalledWith(
        "seedApi",
        expect.stringContaining("400")
      );
      expect(consoleError).not.toHaveBeenCalled();
    });

    it("asks without the browser's cache, so a kept answer cannot hide a route added since", async () => {
      const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
      global.fetch = fetchMock as unknown as typeof fetch;
      await seedApi.probe();
      expect(fetchMock).toHaveBeenCalledWith(
        "/admin/api/seed",
        expect.objectContaining({ method: "HEAD", cache: "no-store" })
      );
    });

    it("says nothing at debug level for an answer the route's contract gives, or one asked again", async () => {
      for (const status of [403, 404, 409, 429, 503]) {
        global.fetch = vi.fn(
          async () => new Response(null, { status })
        ) as unknown as typeof fetch;
        await seedApi.probe();
      }
      expect(debugLog).not.toHaveBeenCalled();
    });

    it("refreshes an expired session before reading a 401 as a refusal, and offers once it answers", async () => {
      // A HEAD's 401 has no body to say the token expired: the probe refreshes, then asks again.
      const calls: string[] = [];
      let heads = 0;
      global.fetch = vi.fn(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          const method = init?.method ?? "GET";
          calls.push(`${method} ${String(url).replace(/^.*\/admin\/api/, "")}`);
          if (method === "HEAD") {
            heads += 1;
            return new Response(null, {
              status: heads === 1 ? 401 : 200,
              headers: { "x-nextly-seed-template": "blog" },
            });
          }
          return new Response(null, { status: 200 });
        }
      ) as unknown as typeof fetch;
      expect(await seedApi.probe()).toMatchObject({ available: true });
      expect(calls).toEqual(["HEAD /seed", "POST /auth/refresh", "HEAD /seed"]);
    });

    it.each([
      [401, {}],
      [500, { unknown: true }],
    ])(
      "reads a 401 as refused only once the refresh is refused too (refresh %i)",
      async (refreshStatus, extra) => {
        global.fetch = vi.fn(
          async (_url: RequestInfo | URL, init?: RequestInit) =>
            init?.method === "HEAD"
              ? new Response(null, { status: 401 })
              : new Response(null, { status: refreshStatus })
        ) as unknown as typeof fetch;
        expect(await seedApi.probe()).toEqual({ available: false, ...extra });
      }
    );

    it("falls back to 'unknown'/'Template' if headers missing", async () => {
      global.fetch = vi.fn(
        async () => new Response(null, { status: 200 })
      ) as unknown as typeof fetch;
      const result = await seedApi.probe();
      expect(result).toEqual({
        available: true,
        template: { slug: "unknown", label: "Template" },
      });
    });
  });

  describe("start", () => {
    /** A refusal or failure as the admin's client throws it, from the error envelope. */
    const apiError = (status: number, message: string, data: unknown) =>
      Object.assign(new Error(message), {
        status,
        code: status === 409 ? "CONFLICT" : "INTERNAL_ERROR",
        data,
      });

    it("sends {} for a first start, and the confirmation only when asked, once each", async () => {
      post.mockResolvedValue({
        message: "Sample content loaded.",
        item: { outcome: "loaded" },
      });
      await seedApi.start(false);
      await seedApi.start(true);
      expect(post.mock.calls).toEqual([
        ["/seed", {}],
        ["/seed", { confirm: true }],
      ]);
    });

    it("reads loaded and loaded-but-not-recorded from the mutation's item, and a route older than the runner as loaded", async () => {
      post.mockResolvedValueOnce({
        message: "Sample content loaded, but recording that failed.",
        item: {
          outcome: "unrecorded",
          run: "run-1",
          startedAt: "2026-10-31T09:00:00.000Z",
        },
      });
      expect(await seedApi.start(false)).toEqual({
        outcome: "unrecorded",
        run: "run-1",
        startedAt: "2026-10-31T09:00:00.000Z",
      });
      // An older route answers its result alone, having recorded it itself.
      post.mockResolvedValueOnce({ message: "ok", summary: {}, warnings: [] });
      expect(await seedApi.start(false)).toEqual({ outcome: "loaded" });
    });

    it("reads a refusal's reason and words, and a failure's what-failed, from the error envelope", async () => {
      post.mockRejectedValueOnce(
        apiError(409, "A sample-content load is already in progress.", {
          reason: "in-progress",
        })
      );
      expect(await seedApi.start(false)).toEqual({
        outcome: "refused",
        reason: "in-progress",
        message: "A sample-content load is already in progress.",
      });
      post.mockRejectedValueOnce(
        apiError(500, "Loading sample content failed.", {
          reason: "failed",
          failure: "post hello: boom",
          startedAt: "2026-10-31T09:00:00.000Z",
        })
      );
      expect(await seedApi.start(false)).toEqual({
        outcome: "failed",
        failure: "post hello: boom",
        startedAt: "2026-10-31T09:00:00.000Z",
      });
      post.mockRejectedValueOnce(
        apiError(403, "You don't have permission.", undefined)
      );
      expect(await seedApi.start(false)).toEqual({
        outcome: "failed",
        failure: "You don't have permission.",
      });
    });

    it("answers a request that never reached the server as failed, asked once", async () => {
      post.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      expect(await seedApi.start(false)).toEqual({
        outcome: "failed",
        failure: "The server could not be reached.",
      });
      expect(post).toHaveBeenCalledTimes(1);
    });
  });
});
