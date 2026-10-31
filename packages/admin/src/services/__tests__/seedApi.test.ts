import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedApi } from "../seedApi";

describe("seedApi", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
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
    const answer = (status: number, body: unknown) =>
      vi.fn(async () => Response.json(body, { status }));

    it("posts no body for a first start, and the confirmation only when asked", async () => {
      const fetchMock = answer(200, { outcome: "loaded", result: {} });
      global.fetch = fetchMock as unknown as typeof fetch;
      await seedApi.start(false);
      await seedApi.start(true);
      const [first, second] = fetchMock.mock.calls as unknown as Array<
        [string, RequestInit]
      >;
      expect(first?.[1]).not.toHaveProperty("body");
      expect(second?.[1].body).toBe(JSON.stringify({ confirm: true }));
    });

    it("reads loaded, loaded but not recorded, and a route older than the runner", async () => {
      global.fetch = answer(200, {
        outcome: "unrecorded",
        run: "run-1",
        startedAt: "2026-10-31T09:00:00.000Z",
      }) as unknown as typeof fetch;
      expect(await seedApi.start(false)).toEqual({
        outcome: "unrecorded",
        run: "run-1",
        startedAt: "2026-10-31T09:00:00.000Z",
      });
      // An older route answers its SeedResult alone, having recorded it itself.
      const result = { message: "ok", summary: {}, warnings: [] };
      global.fetch = answer(200, result) as unknown as typeof fetch;
      expect(await seedApi.start(false)).toEqual({
        outcome: "loaded",
        result,
      });
    });

    it("reads a refusal's reason and words, and anything else failed as what failed", async () => {
      global.fetch = answer(409, {
        outcome: "refused",
        reason: "in-progress",
        errors: [{ message: "A sample-content load is already in progress." }],
      }) as unknown as typeof fetch;
      expect(await seedApi.start(false)).toEqual({
        outcome: "refused",
        reason: "in-progress",
        message: "A sample-content load is already in progress.",
      });
      global.fetch = answer(500, {
        outcome: "failed",
        failure: "post hello: boom",
        startedAt: "2026-10-31T09:00:00.000Z",
      }) as unknown as typeof fetch;
      expect(await seedApi.start(false)).toEqual({
        outcome: "failed",
        failure: "post hello: boom",
        startedAt: "2026-10-31T09:00:00.000Z",
      });
      global.fetch = answer(403, {
        errors: [{ message: "You don't have permission." }],
      }) as unknown as typeof fetch;
      expect(await seedApi.start(false)).toEqual({
        outcome: "failed",
        failure: "You don't have permission.",
      });
    });

    it("answers a request that never reached the server as failed, asked once", async () => {
      const fetchMock = vi.fn(async () => {
        throw new Error("network");
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      expect(await seedApi.start(false)).toEqual({
        outcome: "failed",
        failure: "The server could not be reached.",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
