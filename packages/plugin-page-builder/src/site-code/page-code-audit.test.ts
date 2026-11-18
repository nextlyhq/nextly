/**
 * The audit row each committed change to a page's own code writes: for a
 * blocks field at the top level, inside a named group, or in a repeater's
 * row, named by its path, with hashes, sizes and counts and never the code;
 * and none for a write that leaves the code as it was.
 */
import { describe, expect, it, vi } from "vitest";

import {
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

/** The hook, registered as the plugin registers it, and what it writes. */
function hooked() {
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
