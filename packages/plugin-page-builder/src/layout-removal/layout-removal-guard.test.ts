/**
 * The Layout guard's let-through rule: a delete or unpublish passes only with
 * the removal's token, at its final step, for its action, while the Layout
 * still has the copy's version. Everything else is refused with the sentence
 * that names Remove Layout.
 *
 * Driven through the handlers the guard registers, with a store holding one
 * row and a Direct API answering the working-draft read. What the table holds
 * on each dialect is the integration suite's.
 *
 * @module layout-removal/layout-removal-guard.test
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { versionOf } from "./layout-copy";
import { unpublishes } from "../unpublish-write";

import {
  LAYOUT_REMOVAL_CONTEXT_KEY,
  registerLayoutRemovalGuard,
  VERSION_MOVED,
} from "./layout-removal-guard";
import type { LayoutRemoval, LayoutRemovalStore } from "./store";
import { LAYOUT_EDIT_DURING_REMOVAL, REMOVE_LAYOUT_REFUSAL } from "./words";

const LIVE = {
  id: "layout-1",
  status: "published",
  updatedAt: "2026-11-01T10:00:00.000Z",
};

const TOKEN = "11111111-1111-4111-8111-111111111111";

/** The live row's version, as a removal's copy records it. */
const LIVE_VERSION = await versionOf(LIVE, null);

function row(overrides: Partial<LayoutRemoval> = {}): LayoutRemoval {
  return {
    layoutId: LIVE.id,
    action: "delete",
    step: "final",
    token: TOKEN,
    startedBy: null,
    pagesLeft: null,
    copy: { live: LIVE, draft: null },
    copyVersion: LIVE_VERSION,
    settledAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

/** The guard registered over one stored row, with its handlers by phase. */
function guard(stored: LayoutRemoval | null) {
  const handlers = new Map<string, (context: unknown) => unknown>();
  const removalOf = vi.fn(async () => stored);
  const releaseTombstone = vi.fn(async () => {});
  const store = {
    removalOf,
    releaseTombstone,
  } as unknown as LayoutRemovalStore;
  // The same fence, reached through a caller's transaction.
  const txRemovalOf = vi.fn(async () => stored);
  const txReleaseTombstone = vi.fn(async () => {});
  registerLayoutRemovalGuard({
    ctx: {
      hooks: {
        on: (type, _collection, handler) => {
          handlers.set(type, handler);
        },
      },
    },
    layouts: "layouts",
    store: () => store,
    inTransaction: executor =>
      executor === TX
        ? { removalOf: txRemovalOf, releaseTombstone: txReleaseTombstone }
        : null,
    warn: () => {},
  });
  const run = (type: string, context: unknown) => {
    const handler = handlers.get(type);
    if (handler === undefined) throw new Error(`no ${type} handler`);
    return handler(context);
  };
  return { run, removalOf, releaseTombstone, txRemovalOf, txReleaseTombstone };
}

/** A caller's transaction, as the hook context hands it over. */
const TX = { transaction: "caller" };

/**
 * A Direct API answering the Layout's read with `live` and the working-draft
 * read with `draft`.
 */
function reader(
  draft: Record<string, unknown> | null = null,
  live: Record<string, unknown> = LIVE
) {
  return {
    nextly: {
      find: async () => ({ items: [{ ...live }], meta: { hasNext: false } }),
      findByID: async () =>
        draft === null ? { ...live } : { ...draft, _isWorkingDraft: true },
    },
  };
}

function deleteHook(context: Record<string, unknown> = {}, extra = {}) {
  return {
    operation: "delete",
    data: { ...LIVE },
    context,
    req: reader(),
    ...extra,
  };
}

async function refusal(work: unknown): Promise<unknown> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("a Layout's delete", () => {
  it("is refused without a removal token, naming Remove Layout", async () => {
    const { run } = guard(row());
    const error = await refusal(run("beforeDelete", deleteHook()));
    expect(NextlyError.isCode(error, "CONFLICT")).toBe(true);
    expect((error as Error).message).toBe(REMOVE_LAYOUT_REFUSAL);
  });

  it("is let through with the row's token at the final step and the copy's version", async () => {
    const { run } = guard(row());
    await expect(
      run("beforeDelete", deleteHook({ [LAYOUT_REMOVAL_CONTEXT_KEY]: TOKEN }))
    ).resolves.toBeUndefined();
  });

  it("is refused with a token the row does not hold (a forged row's)", async () => {
    const { run } = guard(
      row({ token: "22222222-2222-4222-8222-222222222222" })
    );
    const error = await refusal(
      run("beforeDelete", deleteHook({ [LAYOUT_REMOVAL_CONTEXT_KEY]: TOKEN }))
    );
    expect((error as Error).message).toBe(REMOVE_LAYOUT_REFUSAL);
  });

  it.each(["marked", "checked", "removed"] as const)(
    "is refused while the row is at %s, not final",
    async step => {
      const { run } = guard(row({ step }));
      const error = await refusal(
        run("beforeDelete", deleteHook({ [LAYOUT_REMOVAL_CONTEXT_KEY]: TOKEN }))
      );
      expect((error as Error).message).toBe(REMOVE_LAYOUT_REFUSAL);
    }
  );

  it("is refused when the row is an unpublish's", async () => {
    const { run } = guard(row({ action: "unpublish" }));
    const error = await refusal(
      run("beforeDelete", deleteHook({ [LAYOUT_REMOVAL_CONTEXT_KEY]: TOKEN }))
    );
    expect((error as Error).message).toBe(REMOVE_LAYOUT_REFUSAL);
  });

  it("is refused with no row at all", async () => {
    const { run } = guard(null);
    const error = await refusal(
      run("beforeDelete", deleteHook({ [LAYOUT_REMOVAL_CONTEXT_KEY]: TOKEN }))
    );
    expect((error as Error).message).toBe(REMOVE_LAYOUT_REFUSAL);
  });

  it("is refused, for the removal to take its copy again, when the Layout gained a working draft since the copy", async () => {
    const { run } = guard(row());
    const error = await refusal(
      run(
        "beforeDelete",
        deleteHook(
          { [LAYOUT_REMOVAL_CONTEXT_KEY]: TOKEN },
          {
            req: reader({
              id: LIVE.id,
              updatedAt: "2026-11-01T10:05:00.000Z",
            }),
          }
        )
      )
    );
    expect(NextlyError.isCode(error, "CONFLICT")).toBe(true);
    expect((error as NextlyError).logContext?.reason).toBe(VERSION_MOVED);
  });

  it("is refused inside a caller's transaction without reading the fence", async () => {
    const { run, removalOf } = guard(row());
    const error = await refusal(
      run(
        "beforeDelete",
        deleteHook({ [LAYOUT_REMOVAL_CONTEXT_KEY]: TOKEN }, { executor: {} })
      )
    );
    expect((error as Error).message).toBe(REMOVE_LAYOUT_REFUSAL);
    expect(removalOf).not.toHaveBeenCalled();
  });
});

describe("a Layout's unpublish", () => {
  const unpublish = (context: Record<string, unknown> = {}) => ({
    operation: "update",
    data: { status: "draft" },
    originalData: { ...LIVE },
    context,
    req: reader(),
  });

  it("is refused without a removal token", async () => {
    const { run } = guard(row({ action: "unpublish" }));
    const error = await refusal(run("beforeChange", unpublish()));
    expect((error as Error).message).toBe(REMOVE_LAYOUT_REFUSAL);
  });

  it("is let through with an unpublish removal's token at its final step", async () => {
    const { run } = guard(row({ action: "unpublish" }));
    await expect(
      run("beforeChange", unpublish({ [LAYOUT_REMOVAL_CONTEXT_KEY]: TOKEN }))
    ).resolves.toBeUndefined();
  });

  it("does not judge a save that leaves it published as an unpublish", async () => {
    // Read as an edit instead: the fence is asked, and with no removal the
    // save goes through.
    const { run, removalOf } = guard(null);
    await expect(
      run("beforeChange", {
        operation: "update",
        data: { title: "Renamed" },
        originalData: { ...LIVE },
        req: reader(),
      })
    ).resolves.toBeUndefined();
    expect(removalOf).toHaveBeenCalledWith(LIVE.id);
  });
});

describe("what counts as an unpublish", () => {
  it.each([
    ["an explicit draft", { status: "draft" }, true],
    ["any status other than published", { status: "archived" }, true],
    ["a status-less save", { title: "x" }, false],
    ["a status of undefined, which core strips", { status: undefined }, false],
    ["publishing again", { status: "published" }, false],
  ])("%s", (_label, data, expected) => {
    expect(
      unpublishes({ operation: "update", data, originalData: { ...LIVE } })
    ).toBe(expected);
  });

  it("is never a create, which has no stored row", () => {
    expect(
      unpublishes({
        operation: "create",
        data: { status: "draft" },
        originalData: { ...LIVE },
      })
    ).toBe(false);
  });

  it("is never a save of a Layout that was not published", () => {
    expect(
      unpublishes({
        operation: "update",
        data: { status: "draft" },
        originalData: { ...LIVE, status: "draft" },
      })
    ).toBe(false);
  });
});

describe("publishing a Layout again", () => {
  it("drops an unpublish removal's tombstone", async () => {
    const { run, releaseTombstone } = guard(null);
    await run("afterUpdate", { data: { ...LIVE, status: "published" } });
    expect(releaseTombstone).toHaveBeenCalledWith(LIVE.id);
  });

  it("leaves it for a save that keeps the Layout unpublished", async () => {
    const { run, releaseTombstone } = guard(null);
    await run("afterUpdate", { data: { ...LIVE, status: "draft" } });
    expect(releaseTombstone).not.toHaveBeenCalled();
  });
});

describe("a Layout edit while its removal runs", () => {
  const edit = (extra: Record<string, unknown> = {}) => ({
    operation: "update",
    data: { title: "Renamed" },
    originalData: { ...LIVE },
    req: reader(),
    ...extra,
  });

  it.each(["marked", "checked", "final"] as const)(
    "is refused while the removal is at %s, saying to try again shortly",
    async step => {
      const { run } = guard(row({ step }));
      const error = await refusal(run("beforeChange", edit()));
      expect(NextlyError.isCode(error, "CONFLICT")).toBe(true);
      expect((error as Error).message).toBe(LAYOUT_EDIT_DURING_REMOVAL);
    }
  );

  it("is refused for a publish too, not only a status-less save", async () => {
    const { run } = guard(row({ step: "checked" }));
    const error = await refusal(
      run("beforeChange", edit({ data: { status: "published" } }))
    );
    expect((error as Error).message).toBe(LAYOUT_EDIT_DURING_REMOVAL);
  });

  it("is let through once the removal settled, as an unpublish's tombstone", async () => {
    const { run } = guard(
      row({ step: "removed", action: "unpublish", settledAt: new Date() })
    );
    await expect(run("beforeChange", edit())).resolves.toBeUndefined();
  });

  it("is let through when the removal's row is older than its lease", async () => {
    const { run } = guard(
      row({ step: "checked", updatedAt: new Date(Date.now() - 6 * 60_000) })
    );
    await expect(run("beforeChange", edit())).resolves.toBeUndefined();
  });

  it("is let through with no removal at all", async () => {
    const { run } = guard(null);
    await expect(run("beforeChange", edit())).resolves.toBeUndefined();
  });

  it("is refused inside a caller's transaction, reading the fence through that transaction", async () => {
    const { run, removalOf, txRemovalOf } = guard(row({ step: "checked" }));
    const error = await refusal(run("beforeChange", edit({ executor: TX })));
    expect((error as Error).message).toBe(LAYOUT_EDIT_DURING_REMOVAL);
    expect(txRemovalOf).toHaveBeenCalledWith(LIVE.id);
    expect(removalOf).not.toHaveBeenCalled();
  });

  it("is refused inside a transaction it cannot read through, failing closed", async () => {
    const { run } = guard(null);
    const error = await refusal(
      run("beforeChange", edit({ executor: { unknown: true } }))
    );
    expect((error as Error).message).toBe(LAYOUT_EDIT_DURING_REMOVAL);
  });
});

describe("publishing a Layout again inside a caller's transaction", () => {
  it("drops the tombstone through that transaction", async () => {
    const { run, releaseTombstone, txReleaseTombstone } = guard(null);
    await run("afterUpdate", {
      data: { ...LIVE, status: "published" },
      executor: TX,
    });
    expect(txReleaseTombstone).toHaveBeenCalledWith(LIVE.id);
    expect(releaseTombstone).not.toHaveBeenCalled();
  });
});
