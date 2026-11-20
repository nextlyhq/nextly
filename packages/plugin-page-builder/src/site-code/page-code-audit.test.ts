/**
 * The audit row each committed change to a page's own code writes: for a
 * blocks field at the top level, inside a named group, or in a repeater's
 * row, named by its path, with hashes, sizes and counts and never the code;
 * and none for a write that leaves the code as it was.
 */
import { DEFAULT_LIMITS, type DocumentLimits } from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import {
  DOCUMENT_CSS_SAVED_AUDIT,
  PAGE_CODE_SAVED_AUDIT,
  registerPageCodeAudit,
} from "./page-code-audit";

const CODE = "<script>window.pageCodeTest = 1</script>";

/** A blocks document, with page code in its head where given. */
function doc(head?: string): Record<string, unknown> {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [],
    ...(head === undefined ? {} : { settings: { code: { head, body: "" } } }),
  };
}

/**
 * The hook, registered as the plugin registers it on a site with these
 * limits where given, and what it writes.
 */
function hooked(limits?: DocumentLimits) {
  const handlers: ((context: unknown) => unknown)[] = [];
  const write = vi.fn(
    async (_event: { metadata?: Record<string, unknown> }) => {}
  );
  const logger = { error: vi.fn() };
  registerPageCodeAudit({
    ctx: {
      hooks: { on: (_phase, _collection, handler) => handlers.push(handler) },
      logger,
      audit: { write },
    },
    mayHoldBlocks: () => true,
    options: undefined,
    siteOrigin: () => "https://site.test",
    ...(limits === undefined ? {} : { limits }),
  });
  const commit = async (
    data: Record<string, unknown>,
    originalData: Record<string, unknown>
  ) => {
    await handlers[0]?.({
      collection: "pages",
      data: { id: "p1", ...data },
      originalData,
      user: { id: "u1" },
    });
  };
  return { commit, write, logger };
}

describe("the page code audit", () => {
  it.each([
    ["at the top level", { content: doc(CODE) }, { content: doc() }, "content"],
    [
      "inside a named group",
      { hero: { body: doc(CODE) } },
      { hero: { body: doc() } },
      "hero.body",
    ],
    [
      "in a repeater's row",
      { sections: [{ body: doc() }, { body: doc(CODE) }] },
      { sections: [{ body: doc() }, { body: doc() }] },
      "sections[1].body",
    ],
  ])(
    "records a change to a blocks field's code %s, by its path, without the code",
    async (_where, after, before, field) => {
      const { commit, write } = hooked();
      await commit(after, before);
      expect(write).toHaveBeenCalledTimes(1);
      const event = write.mock.calls[0]?.[0] as {
        kind: string;
        metadata: Record<string, unknown>;
      };
      expect(event.kind).toBe(PAGE_CODE_SAVED_AUDIT);
      expect(event.metadata).toMatchObject({
        field,
        collection: "pages",
        entryId: "p1",
        headChars: CODE.length,
      });
      expect(JSON.stringify(event)).not.toContain("pageCodeTest");
    }
  );

  it("writes every field's row though one fails, and logs the one it couldn't write", async () => {
    const { commit, write, logger } = hooked();
    write.mockRejectedValueOnce(new Error("audit store down"));
    await commit(
      { content: doc(CODE), sidebar: doc(CODE) },
      { content: doc(), sidebar: doc() }
    );
    expect(write).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]?.[1]).toMatchObject({ field: "content" });
  });

  it("records nothing for a write that leaves the code as it was", async () => {
    const { commit, write } = hooked();
    await commit({ hero: { body: doc(CODE) } }, { hero: { body: doc(CODE) } });
    await commit({ title: "Renamed" }, { content: doc(CODE) });
    expect(write).not.toHaveBeenCalled();
  });
});

describe("the custom CSS audit", () => {
  const PAGE_CSS = "h1 { color: rebeccapurple; }";
  const BLOCK_CSS = "selector { border: 4px solid blue; }";
  /** A page with its own CSS and blocks holding these CSS texts. */
  const styled = (own: string | undefined, ...blocks: string[]) => ({
    ...doc(),
    ...(own === undefined ? {} : { settings: { customCss: own } }),
    nodes: blocks.map((css, index) => ({
      id: `b${index}`,
      type: "core/text",
      version: 1,
      props: {},
      customCss: css,
    })),
  });

  it("records a change to a page's or a block's CSS with hashes and sizes, never the CSS", async () => {
    const { commit, write } = hooked();
    await commit(
      { content: styled(PAGE_CSS, BLOCK_CSS) },
      { content: styled(undefined) }
    );
    expect(write).toHaveBeenCalledTimes(1);
    const event = write.mock.calls[0]?.[0] as {
      kind: string;
      actorUserId: string;
      metadata: Record<string, unknown>;
    };
    expect(event.kind).toBe(DOCUMENT_CSS_SAVED_AUDIT);
    expect(event.actorUserId).toBe("u1");
    expect(event.metadata).toMatchObject({
      collection: "pages",
      entryId: "p1",
      field: "content",
      cssChars: PAGE_CSS.length,
      cssCharsBefore: 0,
      blockCssChars: BLOCK_CSS.length,
      blocksWithCss: 1,
      blocksWithCssBefore: 0,
    });
    expect(event.metadata.cssSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(event.metadata.cssSha256).not.toBe(event.metadata.cssSha256Before);
    expect(JSON.stringify(event)).not.toContain("rebeccapurple");
    expect(JSON.stringify(event)).not.toContain("solid blue");
  });

  it("records a duplicated block's CSS, and nothing for blocks moved with theirs", async () => {
    const { commit, write } = hooked();
    const before = styled(PAGE_CSS, BLOCK_CSS, "selector { color: red; }");
    // Reordered: the same CSS, in another order.
    await commit(
      { content: styled(PAGE_CSS, "selector { color: red; }", BLOCK_CSS) },
      { content: before }
    );
    expect(write).not.toHaveBeenCalled();
    await commit(
      { content: styled(PAGE_CSS, BLOCK_CSS, BLOCK_CSS) },
      { content: styled(PAGE_CSS, BLOCK_CSS) }
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(
      (write.mock.calls[0]?.[0] as { metadata: Record<string, unknown> })
        .metadata
    ).toMatchObject({ blocksWithCss: 2, blocksWithCssBefore: 1 });
  });

  it("records CSS on a block past the default count that the site's own count draws", async () => {
    const count = DEFAULT_LIMITS.maxNodes + 1;
    const { commit, write } = hooked({ ...DEFAULT_LIMITS, maxNodes: count });
    // Only the last block holds CSS, so a read that stops at the engine's
    // default count sees no change at all.
    const page = (css: string | undefined) => ({
      ...doc(),
      nodes: Array.from({ length: count }, (_, index) => ({
        id: `b${index}`,
        type: "core/text",
        version: 1,
        props: {},
        ...(index === count - 1 && css !== undefined ? { customCss: css } : {}),
      })),
    });
    await commit({ content: page(BLOCK_CSS) }, { content: page(undefined) });
    expect(write).toHaveBeenCalledTimes(1);
    const event = write.mock.calls[0]?.[0] as
      | { metadata?: Record<string, unknown> }
      | undefined;
    expect(event?.metadata).toMatchObject({
      blocksWithCss: 1,
      blocksWithCssBefore: 0,
    });
  });
});
