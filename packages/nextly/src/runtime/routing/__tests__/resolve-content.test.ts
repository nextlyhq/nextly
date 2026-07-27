/**
 * `resolveContent` unit behavior against a stubbed reader (no DB): it forwards
 * the lifecycle-aware `status` scope and the access context to `find`, resolves
 * an access denial (403) to `null`, and rethrows any other error.
 */
import { describe, expect, it } from "vitest";

import type { FindArgs } from "../../../direct-api/types/collections";
import type { ListResult } from "../../../direct-api/types/shared";
import { NextlyError } from "../../../errors/nextly-error";
import { resolveContent, type NextlyContentReader } from "../resolve-content";

function stubReader(behavior: {
  items?: Record<string, unknown>[];
  error?: unknown;
}): { reader: NextlyContentReader; calls: FindArgs[] } {
  const calls: FindArgs[] = [];
  const reader: NextlyContentReader = {
    find: async (args): Promise<ListResult<Record<string, unknown>>> => {
      calls.push(args);
      if (behavior.error) throw behavior.error;
      const items = behavior.items ?? [];
      return {
        items,
        meta: {
          total: items.length,
          page: 1,
          limit: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    },
  };
  return { reader, calls };
}

describe("resolveContent (unit)", () => {
  it("defaults to an enforced, published read and forwards the scope to find", async () => {
    const { reader, calls } = stubReader({ items: [{ id: "1", title: "A" }] });
    const result = await resolveContent("posts", "a", { nextly: reader });

    expect(result).toEqual({ id: "1", title: "A" });
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe("published");
    expect(calls[0].overrideAccess).toBe(false);
    expect(calls[0].where).toEqual({ slug: { equals: "a" } });
    expect(calls[0].sort).toBe("id");
  });

  it("forwards an explicit user and status, and a trusted override", async () => {
    const { reader, calls } = stubReader({ items: [{ id: "1" }] });
    await resolveContent("posts", "a", {
      nextly: reader,
      overrideAccess: true,
      user: { id: "u1", role: "editor" },
      status: "all",
    });
    expect(calls[0].overrideAccess).toBe(true);
    expect(calls[0].user).toEqual({ id: "u1", role: "editor" });
    expect(calls[0].status).toBe("all");
  });

  it("resolves an access denial (403) to null", async () => {
    const { reader } = stubReader({ error: NextlyError.forbidden() });
    expect(await resolveContent("posts", "a", { nextly: reader })).toBeNull();
  });

  it("rethrows a non-access error (retryable, not a cached 404)", async () => {
    const boom = NextlyError.internal();
    const { reader } = stubReader({ error: boom });
    await expect(resolveContent("posts", "a", { nextly: reader })).rejects.toBe(
      boom
    );
  });

  it("returns null on a genuine miss (no items)", async () => {
    const { reader } = stubReader({ items: [] });
    expect(await resolveContent("posts", "a", { nextly: reader })).toBeNull();
  });
});
