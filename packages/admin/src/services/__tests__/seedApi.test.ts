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

    it("treats 401 as 'endpoint exists' so the card can render auth hint", async () => {
      global.fetch = vi.fn(
        async () =>
          new Response(null, {
            status: 401,
            headers: { "x-nextly-seed-template": "blog" },
          })
      ) as unknown as typeof fetch;
      const result = await seedApi.probe();
      expect(result.available).toBe(true);
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

  describe("runSeed", () => {
    it("returns the parsed SeedResult on success", async () => {
      const result = {
        message: "Demo content seeded.",
        summary: {
          rolesCreated: 3,
          usersCreated: 3,
          categoriesCreated: 5,
          tagsCreated: 8,
          postsCreated: 12,
          mediaUploaded: 14,
          mediaSkipped: 0,
          collectionsRegistered: 0,
          singlesRegistered: 0,
          permissionsSynced: 0,
        },
        warnings: [],
      };
      global.fetch = vi.fn(
        async () => new Response(JSON.stringify(result), { status: 200 })
      ) as unknown as typeof fetch;
      expect(await seedApi.runSeed()).toEqual(result);
    });

    it("throws with the server-supplied message on error", async () => {
      global.fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({ errors: [{ message: "Permission sync failed" }] }),
            { status: 500 }
          )
      ) as unknown as typeof fetch;
      await expect(seedApi.runSeed()).rejects.toThrow("Permission sync failed");
    });

    it("throws a status-coded fallback if no error body", async () => {
      global.fetch = vi.fn(
        async () => new Response(null, { status: 500 })
      ) as unknown as typeof fetch;
      await expect(seedApi.runSeed()).rejects.toThrow(/Seed failed.*500/);
    });
  });

  describe("getStatus", () => {
    it("returns the parsed status when ok", async () => {
      global.fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              completedAt: "2026-05-04T00:00:00Z",
              skippedAt: null,
            }),
            { status: 200 }
          )
      ) as unknown as typeof fetch;
      const status = await seedApi.getStatus();
      expect(status.completedAt).toBe("2026-05-04T00:00:00Z");
      expect(status.skippedAt).toBeNull();
    });

    it("returns null fields on non-ok response", async () => {
      global.fetch = vi.fn(
        async () => new Response(null, { status: 500 })
      ) as unknown as typeof fetch;
      expect(await seedApi.getStatus()).toEqual({
        completedAt: null,
        skippedAt: null,
      });
    });

    it("returns null fields when body is malformed", async () => {
      global.fetch = vi.fn(
        async () => new Response("not json", { status: 200 })
      ) as unknown as typeof fetch;
      expect(await seedApi.getStatus()).toEqual({
        completedAt: null,
        skippedAt: null,
      });
    });
  });

  describe("setSkipped", () => {
    it("sends a PUT with skippedAt", async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "ok" }), { status: 200 })
      );
      global.fetch = fetchMock as unknown as typeof fetch;
      await seedApi.setSkipped();
      expect(fetchMock).toHaveBeenCalledWith(
        "/admin/api/meta/seed-status",
        expect.objectContaining({ method: "PUT" })
      );
      const call = fetchMock.mock.calls[0];
      const init = call[1] as RequestInit;
      const body = JSON.parse(init.body as string) as { skippedAt: string };
      expect(typeof body.skippedAt).toBe("string");
      expect(body.skippedAt.length).toBeGreaterThan(0);
    });
  });
});
