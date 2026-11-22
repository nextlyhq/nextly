/**
 * The write normalisation's move after a batch commits, against doubles:
 * a save of the page landing between the move's read and its rewrite.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import type { EmptySeedParts } from "./empty-seed";
import { registerEmptySeedWriteHook } from "./empty-seed-write";

const SLUGS = { layouts: "layouts", settings: "page-builder-settings" };

/** The Direct API of a site whose recorded seed is empty, and one page on it. */
function site() {
  let rev = 1;
  return {
    findSingle: vi.fn(async () => ({ seededLayout: "seed" })),
    find: vi.fn(async () => ({
      items: [{ id: "seed", areas: [] }],
      meta: { hasNext: false },
    })),
    findByID: vi.fn(async (args: { collection: string }) =>
      args.collection === "layouts"
        ? { id: "seed", areas: [] }
        : { id: "page", layout: "seed", _rev: String(rev++) }
    ),
  };
}

/** The after-update handler as registered, and what it writes and logs. */
function installed(rewrite: EmptySeedParts["rewrite"]) {
  const handlers = new Map<string, (context: unknown) => unknown>();
  const warn = vi.fn();
  registerEmptySeedWriteHook({
    ctx: {
      hooks: {
        on: (type, _collection, handler) => handlers.set(type, handler),
      },
    },
    pages: "pages",
    slugs: SLUGS,
    emptySeed: { mark: { read: vi.fn(), write: vi.fn() }, rewrite },
    warn,
  });
  const afterUpdate = handlers.get("afterUpdate");
  if (afterUpdate === undefined) throw new Error("no afterUpdate handler");
  return { afterUpdate, warn };
}

/** An update inside a caller's transaction, whose effect runs at "commit". */
function batchUpdate(nextly: unknown) {
  return {
    data: { id: "page", layout: "seed" },
    executor: {},
    req: { nextly },
    afterCommit: async (effect: () => unknown) => {
      await effect();
    },
  };
}

describe("a page a batch put on the empty seed", () => {
  it("is moved after the commit even when a save lands between the move's read and its rewrite", async () => {
    let calls = 0;
    const rewrite = vi.fn<EmptySeedParts["rewrite"]>(async () => {
      calls += 1;
      if (calls === 1) {
        throw new NextlyError({
          code: "STALE_VERSION",
          publicMessage: "Saved since it was read.",
        });
      }
      return { version: "3", copies: [{ form: "live", locale: null }] };
    });
    const { afterUpdate, warn } = installed(rewrite);

    await afterUpdate(batchUpdate(site()));

    expect(rewrite).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      "[page-builder] a page written in a batch named the empty seeded header & footer set, so it now uses the site default",
      expect.objectContaining({ pageId: "page" })
    );
  });

  it("says so when every try is refused, rather than leaving the page silently", async () => {
    const rewrite = vi.fn<EmptySeedParts["rewrite"]>(async () => {
      throw new NextlyError({
        code: "STALE_VERSION",
        publicMessage: "Saved since it was read.",
      });
    });
    const { afterUpdate, warn } = installed(rewrite);

    await afterUpdate(batchUpdate(site()));

    expect(rewrite.mock.calls.length).toBeGreaterThan(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not be moved"),
      expect.objectContaining({ pageId: "page" })
    );
  });
});
