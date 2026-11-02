/**
 * The guard on an emptied blocks field, against a hook context the test
 * controls: what it reads, when it declines, and when it reports a field
 * unjudged. The SQLite suite (`__tests__/layers-lock.integration.test.ts`)
 * shows the refusal through the Direct API.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import type { HookContext } from "nextly";
import { describe, expect, it, vi } from "vitest";

import { registerLayersLockGuard } from "./layers-lock-guard";

const lockedPage = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "hero",
      type: "core/box",
      version: 1,
      props: {},
      locked: true,
      name: "Hero",
    },
  ],
};

/** The guard, registered against a fake plugin context. */
function guarded(localized = false) {
  let handler: ((context: HookContext<unknown>) => unknown) | undefined;
  const getCollection = vi.fn(async () => ({
    localized,
    fields: [{ name: "content", type: "blocks", localized }],
  }));
  const onUnjudged = vi.fn();
  registerLayersLockGuard({
    ctx: {
      hooks: {
        on: (_type, _collection, registered) => {
          handler = registered;
        },
      },
      services: { collections: { getCollection } },
    },
    onUnjudged,
  });
  const run = (
    context: Partial<HookContext<unknown>> & { executor?: unknown }
  ) =>
    Promise.resolve(
      handler?.({
        collection: "pages",
        operation: "update",
        context: {},
        ...context,
      } as HookContext<unknown>)
    );
  return { run, getCollection, onUnjudged };
}

describe("the guard on an emptied blocks field", () => {
  it("reads no configuration for a write that empties nothing", async () => {
    const { run, getCollection } = guarded();
    await run({
      data: { title: "x" },
      originalData: { id: "p1", content: lockedPage },
    });
    expect(getCollection).not.toHaveBeenCalled();
  });

  it("judges against the row it is handed inside a caller's transaction", async () => {
    // No pooled read there: it would wait on the transaction's connection.
    const findByID = vi.fn();
    const { run } = guarded();
    await expect(
      run({
        data: { content: null },
        originalData: { id: "p1", content: lockedPage },
        req: { nextly: { findByID } } as never,
        executor: {},
      })
    ).rejects.toMatchObject({
      publicData: {
        errors: [expect.objectContaining({ code: "layers-lock-changed" })],
      },
    });
    expect(findByID).not.toHaveBeenCalled();
  });

  it("reports a translated field unjudged rather than judging another language", async () => {
    const { run, onUnjudged } = guarded(true);
    await expect(
      run({
        data: { content: null },
        originalData: { id: "p1", content: lockedPage },
      })
    ).resolves.toBeUndefined();
    expect(onUnjudged).toHaveBeenCalledWith(
      expect.objectContaining({ field: "content", reason: "language-unknown" })
    );
  });
});
