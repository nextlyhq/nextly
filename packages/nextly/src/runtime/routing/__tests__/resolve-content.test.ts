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
import { TRUSTS_EVERY_COLLECTION } from "../../../services/collections/trust-grant";

function stubReader(behavior: {
  items?: Record<string, unknown>[];
  error?: unknown;
  /** What the by-id re-read returns; `null` models a row deleted mid-resolve. */
  overlay?: Record<string, unknown> | null;
  /** What the by-id re-read throws, modelling the real API's error behaviour. */
  overlayError?: unknown;
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
      if (behavior.overlayError) throw behavior.overlayError;
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
    const { reader, calls } = stubReader({
      items: [{ id: "1", status: "published" }],
    });
    await resolveContent("posts", "a", {
      nextly: reader,
      overrideAccess: true,
      trustedCollections: TRUSTS_EVERY_COLLECTION,
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
    const { reader, byIdCalls } = stubReader({
      items: [{ id: "1", status: "published" }],
    });
    await resolveContent("posts", "a", { nextly: reader });
    expect(byIdCalls).toHaveLength(0);
  });

  it("overlays the working draft on the row the slug resolved to", async () => {
    // The overlay lives on the by-id read, not the list read, so a slug lookup
    // cannot surface it without this second step.
    const { reader, calls, byIdCalls } = stubReader({
      items: [{ id: "1", title: "live", status: "published" }],
      overlay: { id: "1", title: "pending edit", _isWorkingDraft: true },
    });

    const result = await resolveContent("posts", "a", {
      nextly: reader,
      draft: true,
      overrideAccess: true,
      trustedCollections: TRUSTS_EVERY_COLLECTION,
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
    const { reader, calls } = stubReader({
      items: [{ id: "1", status: "published" }],
    });
    await resolveContent("posts", "a", {
      nextly: reader,
      draft: true,
      overrideAccess: true,
      trustedCollections: TRUSTS_EVERY_COLLECTION,
    });
    expect(calls[0].status).toBe("all");
  });

  it("does not widen the lifecycle scope for an untrusted draft read", async () => {
    // The two halves of a draft read are gated very differently. The overlay is
    // judged per row by an update-capability probe, so asking for it is safe
    // from anywhere; widening `status` is judged by nothing at all — the list
    // read simply returns never-published rows. Tying the widening to the draft
    // flag alone would let a preview flag wired from an untrusted request
    // publish unpublished pages.
    const { reader, calls } = stubReader({
      items: [{ id: "1", status: "published" }],
    });

    await resolveContent("posts", "a", { nextly: reader, draft: true });

    expect(calls[0].status).toBe("published");
  });

  it("still overlays pending edits on an untrusted read", async () => {
    // Refusing the widening must not cost the half that IS safely gated: a
    // published page's pending edits are still previewable, judged per row.
    const { reader, byIdCalls } = stubReader({
      items: [{ id: "1", status: "published" }],
      overlay: { id: "1", title: "pending", _isWorkingDraft: true },
    });

    const result = await resolveContent("posts", "a", {
      nextly: reader,
      draft: true,
      user: { id: "u1", role: "editor" },
    });

    expect(byIdCalls).toHaveLength(1);
    expect(result).toEqual({
      id: "1",
      title: "pending",
      _isWorkingDraft: true,
    });
  });

  it("does not decide whether to overlay from the row's own status", async () => {
    // An `afterRead` hook may reshape or drop `status` before it is read here,
    // so gating the overlay on it made preview depend on a field the collection
    // is free to redefine. The overlay is attempted for every row instead.
    const { reader, byIdCalls } = stubReader({
      items: [{ id: "1", title: "live" }],
      overlay: { id: "1", title: "pending", _isWorkingDraft: true },
    });

    const result = await resolveContent("posts", "a", {
      nextly: reader,
      draft: true,
      overrideAccess: true,
      trustedCollections: TRUSTS_EVERY_COLLECTION,
    });

    expect(byIdCalls).toHaveLength(1);
    expect(result).toEqual({
      id: "1",
      title: "pending",
      _isWorkingDraft: true,
    });
  });

  it("falls back to the live row when there is no overlay to be had", async () => {
    // The overlay is an enhancement, so anything that means "no draft" leaves
    // the live row standing: a row deleted between the two reads, or an
    // enforced by-id read filtering it to published, both answer 404.
    //
    // Caught around the OVERLAY read alone, and by status rather than with
    // `disableErrors`. A handler over the whole read would turn a 404 from a
    // mistyped collection into a silent content miss, and `disableErrors`
    // returns null for every unsuccessful result — a database blip would become
    // a permanently-cached 404. Both halves are asserted, because only the
    // second separates the two.
    const gone = stubReader({
      items: [{ id: "1", title: "live", status: "published" }],
      overlayError: NextlyError.notFound(),
    });
    expect(
      await resolveContent("posts", "a", {
        nextly: gone.reader,
        draft: true,
        overrideAccess: true,
        trustedCollections: TRUSTS_EVERY_COLLECTION,
      })
    ).toEqual({ id: "1", title: "live", status: "published" });

    const broken = NextlyError.internal();
    const blip = stubReader({
      items: [{ id: "1", status: "published" }],
      overlayError: broken,
    });
    await expect(
      resolveContent("posts", "a", {
        nextly: blip.reader,
        draft: true,
        overrideAccess: true,
        trustedCollections: TRUSTS_EVERY_COLLECTION,
      })
    ).rejects.toBe(broken);
  });

  it("still surfaces a 404 that came from the slug lookup", async () => {
    // The overlay's handler must not reach this read. A mistyped collection —
    // or schema or hook code beneath it — answers 404, and swallowing that
    // would render an ordinary content miss with nothing to say why.
    const notFound = NextlyError.notFound();
    const { reader } = stubReader({ error: notFound });

    await expect(
      resolveContent("posts", "a", {
        nextly: reader,
        draft: true,
        overrideAccess: true,
        trustedCollections: TRUSTS_EVERY_COLLECTION,
      })
    ).rejects.toBe(notFound);
  });

  it("still lets an explicit lifecycle scope win", async () => {
    // Previewing pending edits on live pages only is a legitimate ask.
    const { reader, calls } = stubReader({
      items: [{ id: "1", status: "published" }],
    });
    await resolveContent("posts", "a", {
      nextly: reader,
      draft: true,
      status: "published",
      overrideAccess: true,
      trustedCollections: TRUSTS_EVERY_COLLECTION,
    });
    expect(calls[0].status).toBe("published");
  });

  it("carries the read context into the overlay read", async () => {
    // The two reads must agree: an overlay fetched at a different depth or
    // locale would render a page the slug lookup never described.
    const { reader, byIdCalls } = stubReader({
      items: [{ id: "1", status: "published" }],
    });
    await resolveContent("posts", "a", {
      nextly: reader,
      draft: true,
      depth: 3,
      locale: "fr",
      richTextFormat: "html",
      overrideAccess: true,
      trustedCollections: TRUSTS_EVERY_COLLECTION,
      user: { id: "u1", role: "editor" },
    });

    expect(byIdCalls[0].depth).toBe(3);
    expect(byIdCalls[0].locale).toBe("fr");
    expect(byIdCalls[0].richTextFormat).toBe("html");
    expect(byIdCalls[0].overrideAccess).toBe(true);
    expect(byIdCalls[0].user).toEqual({ id: "u1", role: "editor" });
  });

  it("keeps the live row when the overlay read finds no draft", async () => {
    // The overlay adds pending edits; its absence is the ordinary case, not a
    // failure. Returning nothing here would 404 a page that resolved fine.
    const { reader } = stubReader({
      items: [{ id: "1", title: "live", status: "published" }],
      overlay: null,
    });
    expect(
      await resolveContent("posts", "a", {
        nextly: reader,
        draft: true,
        overrideAccess: true,
        trustedCollections: TRUSTS_EVERY_COLLECTION,
      })
    ).toEqual({ id: "1", title: "live", status: "published" });
  });

  it("returns the row unchanged when its id is not addressable", async () => {
    // A collection whose rows carry no usable id has nothing to re-read by;
    // the live row is a truthful answer where a crash is not.
    const { reader, byIdCalls } = stubReader({
      items: [{ id: { nested: true }, title: "live", status: "published" }],
    });

    const result = await resolveContent("posts", "a", {
      nextly: reader,
      draft: true,
      overrideAccess: true,
      trustedCollections: TRUSTS_EVERY_COLLECTION,
    });

    expect(result).toEqual({
      id: { nested: true },
      title: "live",
      status: "published",
    });
    expect(byIdCalls).toHaveLength(0);
  });
});
