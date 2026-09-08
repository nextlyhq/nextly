/**
 * What the insert panel is allowed to be told about the pattern library.
 *
 * The assertions that matter most are the two the author never sees: that the
 * read runs as the USER rather than with the instance's identity, and that it
 * asks the collection the host actually has rather than the one this package
 * declared. Getting either wrong offers every pattern to everyone, or none to
 * anyone, and the panel looks the same in both cases.
 */
import { describe, expect, it, vi } from "vitest";

import {
  LIBRARY_PAGE_SIZE,
  MAX_LIBRARY_PATTERNS,
  readPatternLibrary,
  type LibraryRouteContext,
} from "./library-route";

/** A stored row as the collection hands one back. */
function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Pattern ${id}`,
    granularity: "section",
    content: { formatVersion: 1, kind: "pattern", nodes: [] },
    ...extra,
  };
}

/**
 * A context whose service answers with the pages given, in order.
 *
 * The spy is the point: what this route decides is WHICH read it makes, so the
 * arguments it passed are the observable behaviour rather than an
 * implementation detail.
 */
function contextOver(
  pages: unknown[][],
  self: Record<string, string | undefined> = {}
) {
  const listEntries = vi.fn((_slug: string, _options: unknown, _ctx: unknown) =>
    Promise.resolve({ data: pages.shift() ?? [] })
  );
  const ctx: LibraryRouteContext = {
    self: { collections: self },
    user: { id: "u1" },
    services: { collections: { listEntries } },
  };
  return { ctx, listEntries };
}

describe("what the library read asks for", () => {
  it("asks only for PUBLISHED patterns", async () => {
    // A draft is a pattern being worked on. Offering one puts a half-built
    // starting point in front of every author on the site.
    const { ctx, listEntries } = contextOver([[row("a")]]);

    await readPatternLibrary(ctx);

    expect(listEntries.mock.calls[0]?.[1]).toMatchObject({
      where: { status: { equals: "published" } },
    });
  });

  it("reads AS THE USER, not with the instance's identity", async () => {
    // The route is authenticated, and this is what makes it also AUTHORIZED: a
    // read with the instance's own identity answers every caller with every
    // pattern, whatever the collection's permissions say.
    const { ctx, listEntries } = contextOver([[row("a")]]);

    await readPatternLibrary(ctx);

    expect(listEntries.mock.calls[0]?.[2]).toEqual({
      as: "user",
      user: { id: "u1" },
    });
  });

  it("asks the collection the HOST has, not the one this package declared", async () => {
    // An integrator may rename the collection. A route holding the literal
    // reads a collection that does not exist and answers an empty library,
    // which looks exactly like a site that has saved no patterns yet.
    const { ctx, listEntries } = contextOver([[row("a")]], {
      patterns: "design-patterns",
    });

    await readPatternLibrary(ctx);

    expect(listEntries.mock.calls[0]?.[0]).toBe("design-patterns");
  });

  it("falls back to the declared slug when the host renamed nothing", async () => {
    // The control for the test above: without it, a reader that always returned
    // the fallback would pass that one and this one would be the same green.
    const { ctx, listEntries } = contextOver([[row("a")]]);

    await readPatternLibrary(ctx);

    expect(listEntries.mock.calls[0]?.[0]).toBe("patterns");
  });
});

describe("what one row becomes", () => {
  it("carries the document whole, unread", async () => {
    // What a pattern document must BE is the planner's question, asked before
    // the panel offers it. A second reading here would be a narrower one that
    // disagrees the first time the format gains a field.
    const document = {
      formatVersion: 1,
      kind: "pattern",
      nodes: [{ id: "x" }],
    };
    const { ctx } = contextOver([[row("a", { content: document })]]);

    const library = await readPatternLibrary(ctx);

    expect(library.items[0]?.content).toEqual(document);
  });

  it("carries a null keywords through rather than dropping it", async () => {
    // Nextly writes an unset non-required field as SQL NULL and reads it back
    // with the KEY PRESENT, so the ordinary pattern saved without keywords
    // arrives as `null`. The panel's own reader is written to meet that.
    const { ctx } = contextOver([[row("a", { keywords: null })]]);

    const library = await readPatternLibrary(ctx);

    expect(library.items[0]).toHaveProperty("keywords", null);
  });

  it("drops a row it cannot key or label, and keeps the rest", async () => {
    // One pattern stops being offered rather than all of them — the direction
    // the remote-pattern reader already moves in. A row with no id could not be
    // planned against; one with no title could not be found.
    const { ctx } = contextOver([
      [row("a"), { title: "no id" }, row("b", { title: "" }), row("c")],
    ]);

    const library = await readPatternLibrary(ctx);

    expect(library.items.map(p => p.id)).toEqual(["a", "c"]);
  });
});

describe("how much of the library travels", () => {
  it("keeps reading while pages come back full", async () => {
    const full = Array.from({ length: LIBRARY_PAGE_SIZE }, (_, i) =>
      row(`p${String(i)}`)
    );
    const { ctx, listEntries } = contextOver([full, [row("last")]]);

    const library = await readPatternLibrary(ctx);

    expect(listEntries).toHaveBeenCalledTimes(2);
    expect(library.items).toHaveLength(LIBRARY_PAGE_SIZE + 1);
  });

  it("pages on the COLLECTION's count, not the readable subset", async () => {
    // A full page every row of which was dropped still means there may be more.
    // Reading the second page on the kept count would stop at the first page a
    // library of unreadable rows produced, and report the rest as absent.
    const unreadable = Array.from({ length: LIBRARY_PAGE_SIZE }, () => ({
      title: "no id",
    }));
    const { ctx, listEntries } = contextOver([unreadable, [row("real")]]);

    const library = await readPatternLibrary(ctx);

    expect(listEntries).toHaveBeenCalledTimes(2);
    expect(library.items.map(p => p.id)).toEqual(["real"]);
  });

  it("stops at the ceiling and SAYS it stopped", async () => {
    // Silently truncating hands the author a library they will search in vain.
    const pages = Array.from({ length: 40 }, (_, page) =>
      Array.from({ length: LIBRARY_PAGE_SIZE }, (_, i) =>
        row(`p${String(page)}-${String(i)}`)
      )
    );
    const { ctx } = contextOver(pages);

    const library = await readPatternLibrary(ctx);

    expect(library.items).toHaveLength(MAX_LIBRARY_PATTERNS);
    expect(library.meta.truncated).toBe(true);
    expect(library.meta.count).toBe(MAX_LIBRARY_PATTERNS);
  });

  it("stops asking when every row of every page is dropped", async () => {
    // The pattern ceiling counts patterns KEPT, so a library whose rows this
    // reader cannot use never reaches it. Measured while break-verifying: a
    // stop condition on the kept count asked for page after page until the
    // process died. The bound has to be on the READS as well.
    const unreadable = () =>
      Array.from({ length: LIBRARY_PAGE_SIZE }, () => ({ title: "no id" }));
    const pages = Array.from({ length: 500 }, unreadable);
    const { ctx, listEntries } = contextOver(pages);

    const library = await readPatternLibrary(ctx);

    expect(listEntries.mock.calls.length).toBeLessThanOrEqual(
      MAX_LIBRARY_PATTERNS / LIBRARY_PAGE_SIZE
    );
    expect(library.items).toHaveLength(0);
    expect(library.meta.truncated).toBe(true);
  });

  it("does not claim truncation for a library that simply ended", async () => {
    // The control: `truncated` has to be able to be false, or the flag above is
    // satisfied by a reader that always sets it.
    const { ctx } = contextOver([[row("a")]]);

    const library = await readPatternLibrary(ctx);

    expect(library.meta).toEqual({ count: 1, truncated: false });
  });
});
