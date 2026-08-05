/**
 * `resolveContent` unit behavior against a stubbed reader (no DB): it forwards
 * the lifecycle-aware `status` scope and the access context to `find`, resolves
 * an access denial (403) to `null`, and rethrows any other error.
 */
import { describe, expect, it } from "vitest";

import type {
  FindArgs,
  FindByIDArgs,
} from "../../../direct-api/types/collections";
import type { ListResult } from "../../../direct-api/types/shared";
import { NextlyError } from "../../../errors/nextly-error";
import { resolveContent, type NextlyContentReader } from "../resolve-content";

function stubReader(behavior: {
  items?: Record<string, unknown>[];
  error?: unknown;
  /** What the by-id re-read returns; `null` models a row deleted mid-resolve. */
  overlay?: Record<string, unknown> | null;
}): {
  reader: NextlyContentReader;
  calls: FindArgs[];
  byIdCalls: FindByIDArgs[];
} {
  const calls: FindArgs[] = [];
  const byIdCalls: FindByIDArgs[] = [];
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
    findByID: async (args): Promise<Record<string, unknown> | null> => {
      byIdCalls.push(args);
      if (behavior.error) throw behavior.error;
      return behavior.overlay === undefined
        ? (behavior.items?.[0] ?? null)
        : behavior.overlay;
    },
  };
  return { reader, calls, byIdCalls };
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

describe("resolveContent (working-draft layer)", () => {
  it("does not re-read by id when no draft was asked for", async () => {
    // The ordinary published read stays exactly one query.
    const { reader, byIdCalls } = stubReader({ items: [{ id: "1" }] });
    await resolveContent("posts", "a", { nextly: reader });
    expect(byIdCalls).toHaveLength(0);
  });

  it("overlays the working draft on the row the slug resolved to", async () => {
    // The overlay lives on the by-id read, not the list read, so a slug lookup
    // cannot surface it without this second step.
    const { reader, calls, byIdCalls } = stubReader({
      items: [{ id: "1", title: "live" }],
      overlay: { id: "1", title: "pending edit", _isWorkingDraft: true },
    });

    const result = await resolveContent("posts", "a", {
      nextly: reader,
      draft: true,
      overrideAccess: true,
    });

    expect(result).toEqual({
      id: "1",
      title: "pending edit",
      _isWorkingDraft: true,
    });
    expect(calls).toHaveLength(1);
    expect(byIdCalls).toHaveLength(1);
    expect(byIdCalls[0].id).toBe("1");
    expect(byIdCalls[0].draft).toBe(true);
    expect(byIdCalls[0].collection).toBe("posts");
  });

  it("widens the lifecycle scope so a never-published entry is found", async () => {
    // Half-configuring preview is the failure this default exists to prevent: a
    // published-only lookup finds nothing to overlay for an entry that has
    // never gone live, so the page 404s while the editor is looking at it.
    const { reader, calls } = stubReader({ items: [{ id: "1" }] });
    await resolveContent("posts", "a", {
      nextly: reader,
      draft: true,
      overrideAccess: true,
    });
    expect(calls[0].status).toBe("all");
  });

  it("still lets an explicit lifecycle scope win", async () => {
    // Previewing pending edits on live pages only is a legitimate ask.
    const { reader, calls } = stubReader({ items: [{ id: "1" }] });
    await resolveContent("posts", "a", {
      nextly: reader,
      draft: true,
      status: "published",
      overrideAccess: true,
    });
    expect(calls[0].status).toBe("published");
  });

  it("carries the read context into the overlay read", async () => {
    // The two reads must agree: an overlay fetched at a different depth or
    // locale would render a page the slug lookup never described.
    const { reader, byIdCalls } = stubReader({ items: [{ id: "1" }] });
    await resolveContent("posts", "a", {
      nextly: reader,
      draft: true,
      depth: 3,
      locale: "fr",
      richTextFormat: "html",
      overrideAccess: true,
      user: { id: "u1", role: "editor" },
    });

    expect(byIdCalls[0].depth).toBe(3);
    expect(byIdCalls[0].locale).toBe("fr");
    expect(byIdCalls[0].richTextFormat).toBe("html");
    expect(byIdCalls[0].overrideAccess).toBe(true);
    expect(byIdCalls[0].user).toEqual({ id: "u1", role: "editor" });
  });

  it("resolves to nothing when the row disappears between the two reads", async () => {
    // Falling back to the copy already in hand would render a page that no
    // longer exists.
    const { reader } = stubReader({ items: [{ id: "1" }], overlay: null });
    expect(
      await resolveContent("posts", "a", {
        nextly: reader,
        draft: true,
        overrideAccess: true,
      })
    ).toBeNull();
  });

  it("returns the row unchanged when its id is not addressable", async () => {
    // A collection whose rows carry no usable id has nothing to re-read by;
    // the live row is a truthful answer where a crash is not.
    const { reader, byIdCalls } = stubReader({
      items: [{ id: { nested: true }, title: "live" }],
    });

    const result = await resolveContent("posts", "a", {
      nextly: reader,
      draft: true,
      overrideAccess: true,
    });

    expect(result).toEqual({ id: { nested: true }, title: "live" });
    expect(byIdCalls).toHaveLength(0);
  });
});
