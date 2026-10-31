import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@admin/lib/api/protectedApi", () => ({ protectedApi: { post } }));

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
  });

  describe("probe", () => {
    it("returns { available: false } on 404", async () => {
      global.fetch = vi.fn(
        async () => new Response(null, { status: 404 })
      ) as unknown as typeof fetch;
      const result = await seedApi.probe();
      expect(result).toEqual({ available: false });
    });

    it("returns { available: false } on 503 (transient init failure)", async () => {
      global.fetch = vi.fn(
        async () => new Response(null, { status: 503 })
      ) as unknown as typeof fetch;
      expect(await seedApi.probe()).toEqual({ available: false });
    });

    it("returns { available: false } if fetch throws", async () => {
      global.fetch = vi.fn(async () => {
        throw new Error("network");
      }) as unknown as typeof fetch;
      expect(await seedApi.probe()).toEqual({ available: false });
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
      [401, "no session"],
      [403, "a person the route refuses"],
      [404, "no sample-content route in this project"],
      [500, "the route failing"],
      [503, "the server still starting"],
    ])("returns { available: false } on %i (%s)", async status => {
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
      expect(await seedApi.probe()).toEqual({ available: false });
    });

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
