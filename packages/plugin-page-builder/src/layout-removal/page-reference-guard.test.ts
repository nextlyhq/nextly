/**
 * The page side of the Layout fence: which page writes are refused for naming
 * a Layout being removed, which are let through because they keep a reference
 * the page already holds, the field's floor for writes that skip hooks,
 * the clearing of a page write that landed while its Layout was removed, and
 * the clearing of a deleted Layout from a page as it is published.
 *
 * Driven through the handlers the guard registers, over a fence holding one
 * row and a Direct API answering one page. What the tables hold on each
 * dialect is the integration suite's (`__tests__/layout-removal.integration.test.ts`).
 *
 * @module layout-removal/page-reference-guard.test
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  clearPageReference,
  LAYOUT_CLEAR_CONTEXT_KEY,
  layoutFenceFloor,
  registerPageReferenceGuard,
} from "./page-reference-guard";
import type { LayoutRemoval, LayoutRemovalStore } from "./store";
import { pageLayoutRefusal } from "./words";

const FENCED = "landing";

function row(overrides: Partial<LayoutRemoval> = {}): LayoutRemoval {
  return {
    layoutId: FENCED,
    action: "delete",
    step: "checked",
    token: "token",
    startedBy: null,
    pagesLeft: null,
    copy: null,
    copyVersion: null,
    settledAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

/** A page as the Direct API answers a by-id read with `draft: true`. */
type PageRead = Record<string, unknown> | null;

/** A Layout row as the Layouts collection holds it. */
interface LayoutRow {
  id: string;
  status: "published" | "draft";
}

/**
 * The Layouts that exist, each with its status. A read asking for published
 * Layouts only is answered as such, so a check that asked "is it published"
 * rather than "does it exist" would be told an unpublished Layout is gone.
 */
function layoutsAnswering(rows: readonly LayoutRow[]) {
  return vi.fn(
    async (args: {
      collection: string;
      where?: { id?: { equals?: unknown } };
      status?: string;
    }) => ({
      items: rows.filter(
        row =>
          args.collection === "layouts" &&
          row.id === args.where?.id?.equals &&
          (args.status !== "published" || row.status === "published")
      ),
    })
  );
}

function guard(
  stored: LayoutRemoval | null,
  page: PageRead = null,
  layouts: readonly LayoutRow[] = []
) {
  const handlers = new Map<string, (context: unknown) => unknown>();
  const removalOf = vi.fn(async (id: string) =>
    stored !== null && stored.layoutId === id ? stored : null
  );
  // The same fence, read on a caller's transaction rather than the pool.
  const inTransactionRead = vi.fn(async (id: string) =>
    stored !== null && stored.layoutId === id ? stored : null
  );
  const store = { removalOf } as unknown as LayoutRemovalStore;
  const updates: Record<string, unknown>[] = [];
  const logged: { message: string; detail: unknown }[] = [];
  const nextly = {
    find: layoutsAnswering(layouts),
    findByID: vi.fn(async () => page),
    update: vi.fn(async (args: Record<string, unknown>) => {
      updates.push(args);
      return { item: {} };
    }),
  };
  registerPageReferenceGuard({
    ctx: {
      hooks: {
        on: (type, _collection, handler) => {
          handlers.set(type, handler);
        },
      },
    },
    pages: "pages",
    layouts: "layouts",
    store: () => store,
    inTransaction: executor =>
      executor === undefined ? null : { removalOf: inTransactionRead },
    warn: (message, detail) => {
      logged.push({ message, detail });
    },
  });
  const run = (type: string, context: Record<string, unknown>) => {
    const handler = handlers.get(type);
    if (handler === undefined) throw new Error(`no ${type} handler`);
    return handler({ req: { nextly }, ...context });
  };
  return { run, removalOf, inTransactionRead, nextly, updates, logged };
}

async function refusal(work: unknown): Promise<unknown> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error;
  }
}

/** The message a validation refusal carries for the `layout` field. */
function layoutMessage(error: unknown): string | undefined {
  if (!NextlyError.isCode(error, "VALIDATION_ERROR")) return undefined;
  const errors = (error.publicData as { errors?: unknown[] } | undefined)
    ?.errors as { path: string; message: string }[] | undefined;
  return errors?.find(entry => entry.path === "layout")?.message;
}

describe("a page create", () => {
  it("is refused when it names a Layout being removed, on the layout field", async () => {
    const { run } = guard(row());
    const error = await refusal(
      run("beforeCreate", { operation: "create", data: { layout: FENCED } })
    );
    expect(layoutMessage(error)).toBe(pageLayoutRefusal("removing"));
  });

  it("is let through when its Layout is not fenced", async () => {
    const { run } = guard(null);
    await expect(
      run("beforeCreate", { operation: "create", data: { layout: "other" } })
    ).resolves.toBeUndefined();
  });

  it("is let through naming no Layout, without reading the fence", async () => {
    const { run, removalOf } = guard(row());
    await run("beforeCreate", { operation: "create", data: { title: "x" } });
    expect(removalOf).not.toHaveBeenCalled();
  });
});

describe("a page update", () => {
  it("is refused when it adds a reference to a fenced Layout", async () => {
    const { run } = guard(row(), {
      id: "p1",
      layout: "other",
      status: "draft",
    });
    const error = await refusal(
      run("beforeUpdate", {
        operation: "update",
        data: { layout: FENCED },
        originalData: { id: "p1", layout: "other", status: "draft" },
      })
    );
    expect(layoutMessage(error)).toBe(pageLayoutRefusal("removing"));
  });

  it("keeps a reference the page already holds, dropping the unchanged key", async () => {
    const page = { id: "p1", layout: FENCED, status: "draft" };
    const { run } = guard(row(), page);
    const data = await run("beforeUpdate", {
      operation: "update",
      data: { title: "Renamed", layout: FENCED },
      originalData: page,
    });
    expect(data).toEqual({ title: "Renamed" });
  });

  it("judges against the working draft: a stale save re-adding a reference its draft dropped is refused", async () => {
    // The live row still names the Layout; the page's working draft no longer
    // does. A save from a stale copy that names it again adds a reference.
    const { run } = guard(row(), {
      id: "p1",
      layout: null,
      status: "published",
      _isWorkingDraft: true,
    });
    const error = await refusal(
      run("beforeUpdate", {
        operation: "update",
        data: { layout: FENCED },
        originalData: { id: "p1", layout: FENCED, status: "published" },
      })
    );
    expect(layoutMessage(error)).toBe(pageLayoutRefusal("removing"));
  });

  it("keeps a reference only its working draft holds", async () => {
    const { run } = guard(row(), {
      id: "p1",
      layout: FENCED,
      status: "published",
      _isWorkingDraft: true,
    });
    const data = await run("beforeUpdate", {
      operation: "update",
      data: { layout: FENCED, title: "x" },
      originalData: { id: "p1", layout: "other", status: "published" },
    });
    expect(data).toEqual({ title: "x" });
  });

  it("says a Layout unpublished with Remove Layout can be chosen once published again", async () => {
    const { run } = guard(
      row({ step: "removed", action: "unpublish", settledAt: new Date() }),
      { id: "p1", layout: null, status: "draft" }
    );
    const error = await refusal(
      run("beforeUpdate", {
        operation: "update",
        data: { layout: FENCED },
        originalData: { id: "p1", layout: null, status: "draft" },
      })
    );
    expect(layoutMessage(error)).toBe(pageLayoutRefusal("unpublished"));
  });

  it("refuses a fenced Layout inside a caller's transaction, read on that transaction, never the pool", async () => {
    const { run, removalOf, inTransactionRead } = guard(row());
    const error = await refusal(
      run("beforeUpdate", {
        operation: "update",
        data: { layout: FENCED },
        originalData: { id: "p1" },
        executor: {},
      })
    );
    expect(layoutMessage(error)).toBe(pageLayoutRefusal("removing"));
    expect(inTransactionRead).toHaveBeenCalledWith(FENCED);
    expect(removalOf).not.toHaveBeenCalled();
  });
});

describe("the layout field's floor", () => {
  const floor = (stored: LayoutRemoval | null, fails = false) =>
    layoutFenceFloor(() => ({
      removalOf: async () => {
        if (fails) throw new Error("the fence could not be read");
        return stored;
      },
    }));

  it("refuses any value naming a fenced Layout, returning its message", async () => {
    expect(await floor(row())(FENCED)).toBe(pageLayoutRefusal("removing"));
    expect(
      await floor(row({ step: "removed", settledAt: new Date() }))(FENCED)
    ).toBe(pageLayoutRefusal("deleted"));
  });

  it("passes a Layout with no removal, and no Layout at all", async () => {
    expect(await floor(null)("other")).toBe(true);
    expect(await floor(row())(null)).toBe(true);
  });

  it("fails closed when the fence cannot be read", async () => {
    expect(await floor(null, true)(FENCED)).toBe(pageLayoutRefusal("removing"));
  });

  it("fails closed when the fence read does not answer in time, rather than waiting on it", async () => {
    const stalled = layoutFenceFloor(
      () => ({ removalOf: () => new Promise<never>(() => {}) }),
      { timeoutMs: 20 }
    );
    expect(await stalled(FENCED)).toBe(pageLayoutRefusal("removing"));
  });

  it("passes everything before the plugin is installed, with no fence to read", async () => {
    expect(await layoutFenceFloor(() => undefined)(FENCED)).toBe(true);
  });
});

describe("a page write that landed while its Layout was removed", () => {
  it("has its unpublished page's Layout cleared once the removal is past its final check", async () => {
    const page = { id: "p1", layout: FENCED, status: "draft" };
    const { run, updates } = guard(row({ step: "final" }), page);
    await run("afterUpdate", { data: page, originalData: page });
    expect(updates).toEqual([
      expect.objectContaining({
        collection: "pages",
        id: "p1",
        data: { layout: null },
        overrideAccess: true,
      }),
    ]);
  });

  it("clears it with the version the page was read at, so a save since refuses the clear", async () => {
    const page = { id: "p1", layout: FENCED, status: "draft", _rev: "9" };
    const { run, updates } = guard(row({ step: "final" }), page);
    await run("afterUpdate", { data: page, originalData: page });
    expect(updates[0]?.data).toEqual({ layout: null, _rev: "9" });
  });

  // A save of the page between the clear's read and its write moves the
  // version, so the clear is refused; the page is read again and judged
  // afresh, so the removed Layout is not left behind.
  it("reads the page again and clears it when a save since refused the clear", async () => {
    const page = { id: "p1", layout: FENCED, status: "draft", _rev: "9" };
    const { run, nextly, updates } = guard(row({ step: "final" }), page);
    nextly.findByID
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce({ ...page, title: "Saved since", _rev: "10" });
    nextly.update.mockImplementationOnce(
      async (args: Record<string, unknown>) => {
        updates.push(args);
        throw new NextlyError({
          code: "STALE_VERSION",
          publicMessage: "This document changed since the version you gave.",
        });
      }
    );
    await run("afterUpdate", { data: page, originalData: page });
    expect(updates.map(update => update.data)).toEqual([
      { layout: null, _rev: "9" },
      { layout: null, _rev: "10" },
    ]);
  });

  it("leaves the page alone when the save that refused the clear chose another Layout", async () => {
    const page = { id: "p1", layout: FENCED, status: "draft", _rev: "9" };
    const { run, nextly, updates } = guard(row({ step: "final" }), page);
    nextly.findByID
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce({ ...page, layout: "other", _rev: "10" });
    nextly.update.mockImplementationOnce(
      async (args: Record<string, unknown>) => {
        updates.push(args);
        throw new NextlyError({
          code: "STALE_VERSION",
          publicMessage: "This document changed since the version you gave.",
        });
      }
    );
    await run("afterUpdate", { data: page, originalData: page });
    expect(updates.map(update => update.data)).toEqual([
      { layout: null, _rev: "9" },
    ]);
  });

  it("logs which page was cleared, from which Layout, and why", async () => {
    const page = { id: "p1", layout: FENCED, status: "draft" };
    const { run, logged } = guard(row({ step: "final" }), page);
    await run("afterUpdate", { data: page, originalData: page });
    expect(logged).toEqual([
      {
        message: expect.stringContaining("cleared to the site default"),
        detail: {
          pageId: "p1",
          layoutId: FENCED,
          phase: "afterUpdate",
          reason: "layout-being-removed",
        },
      },
    ]);
  });

  it("has a published page's working draft cleared, never its live row", async () => {
    const { run, updates } = guard(row({ step: "removed" }), {
      id: "p1",
      layout: FENCED,
      status: "published",
      _isWorkingDraft: true,
    });
    await run("afterUpdate", { data: { id: "p1", layout: FENCED } });
    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toHaveProperty("status");
  });

  it("leaves a published page whose live row alone names it", async () => {
    const page = { id: "p1", layout: FENCED, status: "published" };
    const { run, updates } = guard(row({ step: "removed" }), page);
    await run("afterUpdate", { data: page });
    expect(updates).toHaveLength(0);
  });

  it("leaves it while the removal can still stop", async () => {
    const page = { id: "p1", layout: FENCED, status: "draft" };
    const { run, updates } = guard(row({ step: "checked" }), page);
    await run("afterCreate", { data: page });
    expect(updates).toHaveLength(0);
  });
});

describe("a publish naming a Layout that no longer exists", () => {
  const GONE = "gone";
  const live = { id: "p1", layout: GONE, status: "published" };

  it("writes no Layout on a direct publish of a page whose live row names it", async () => {
    const { run } = guard(null, live);
    const data = await run("beforeChange", {
      operation: "update",
      data: { title: "Again", status: "published" },
      originalData: live,
    });
    expect(data).toEqual({ title: "Again", status: "published", layout: null });
  });

  it("writes no Layout when the publish itself names it", async () => {
    const { run } = guard(null, live);
    const data = await run("beforeChange", {
      operation: "update",
      data: { layout: GONE, status: "published" },
      originalData: live,
    });
    expect(data).toEqual({ status: "published", layout: null });
  });

  it("writes no Layout when the working draft it promotes names it", async () => {
    // The live row names a Layout that exists; the pending edit the publish
    // puts live names the one that is gone.
    const { run } = guard(
      null,
      { id: "p1", layout: GONE, status: "published", _isWorkingDraft: true },
      [{ id: "kept", status: "published" }]
    );
    const data = await run("beforeChange", {
      operation: "update",
      data: { status: "published" },
      originalData: { id: "p1", layout: "kept", status: "published" },
    });
    expect(data).toEqual({ status: "published", layout: null });
  });

  it("writes no Layout on a page created published onto it", async () => {
    const { run } = guard(null);
    const data = await run("beforeChange", {
      operation: "create",
      data: { title: "New", layout: GONE, status: "published" },
    });
    expect(data).toEqual({ title: "New", status: "published", layout: null });
  });

  it("logs which page was cleared, from which Layout, and why", async () => {
    const { run, logged } = guard(null, live);
    await run("beforeChange", {
      operation: "update",
      data: { status: "published" },
      originalData: live,
    });
    expect(logged).toEqual([
      {
        message: expect.stringContaining("no longer exists"),
        detail: { pageId: "p1", layoutId: GONE, reason: "layout-deleted" },
      },
    ]);
  });

  it("keeps it on a draft save, which publishes nothing, without reading the Layouts", async () => {
    const { run, nextly } = guard(null, live);
    for (const data of [{ title: "Edit" }, { title: "Off", status: "draft" }]) {
      expect(
        await run("beforeChange", {
          operation: "update",
          data,
          originalData: live,
        })
      ).toBeUndefined();
    }
    expect(nextly.find).not.toHaveBeenCalled();
  });

  it("keeps a Layout that exists but is not published", async () => {
    const page = { id: "p1", layout: "unpublished", status: "published" };
    const { run, logged } = guard(null, page, [
      { id: "unpublished", status: "draft" },
    ]);
    expect(
      await run("beforeChange", {
        operation: "update",
        data: { status: "published" },
        originalData: page,
      })
    ).toBeUndefined();
    expect(logged).toEqual([]);
  });

  it("keeps a Layout being removed, which still exists, and still refuses a publish adding it", async () => {
    const page = { id: "p1", layout: FENCED, status: "published" };
    const { run } = guard(row(), page, [{ id: FENCED, status: "published" }]);
    expect(
      await run("beforeChange", {
        operation: "update",
        data: { status: "published" },
        originalData: page,
      })
    ).toBeUndefined();

    const elsewhere = { id: "p2", layout: null, status: "published" };
    const { run: runElsewhere } = guard(row(), elsewhere);
    const error = await refusal(
      runElsewhere("beforeUpdate", {
        operation: "update",
        data: { layout: FENCED, status: "published" },
        originalData: elsewhere,
      })
    );
    expect(layoutMessage(error)).toBe(pageLayoutRefusal("removing"));
  });

  it("leaves a publish inside a caller's transaction as it is, reading nothing through the pool", async () => {
    const { run, nextly } = guard(null, live);
    expect(
      await run("beforeChange", {
        operation: "update",
        data: { status: "published" },
        originalData: live,
        executor: {},
      })
    ).toBeUndefined();
    expect(nextly.find).not.toHaveBeenCalled();
    expect(nextly.findByID).not.toHaveBeenCalled();
  });
});

describe("a clear that read the page before another author changed it", () => {
  const clearing = { [LAYOUT_CLEAR_CONTEXT_KEY]: FENCED };

  it("is refused at its write when the page names another Layout by then", async () => {
    const changed = { id: "p1", layout: "other", status: "draft" };
    const { run } = guard(null, changed);

    const refused = await refusal(
      run("beforeUpdate", {
        data: { layout: null },
        originalData: changed,
        context: clearing,
      })
    );

    expect(NextlyError.isCode(refused, "CONFLICT")).toBe(true);
  });

  it("is let through while the page still names the Layout it read", async () => {
    const page = { id: "p1", layout: FENCED, status: "draft" };
    const { run } = guard(null, page);

    expect(
      await run("beforeUpdate", {
        data: { layout: null },
        originalData: page,
        context: clearing,
      })
    ).toBeUndefined();
  });

  /** A Direct API whose page reads answer `reads` in turn, and whose update throws `refused`. */
  function racing(reads: PageRead[], refused: unknown) {
    const answers = [...reads];
    return {
      find: vi.fn(),
      findByID: vi.fn(async () => answers.shift() ?? null),
      update: vi.fn(async () => {
        throw refused;
      }),
    };
  }

  it("answers that it cleared nothing, carrying the Layout it read, when the page moved on", async () => {
    const nextly = racing(
      [
        { id: "p1", layout: FENCED, status: "draft" },
        { id: "p1", layout: "other", status: "draft" },
      ],
      NextlyError.conflict()
    );

    expect(
      await clearPageReference(nextly as never, "pages", "p1", FENCED)
    ).toBe(false);
    expect(nextly.update).toHaveBeenCalledWith(
      expect.objectContaining({ context: clearing })
    );
  });

  it("passes on a refusal that was not the page moving on", async () => {
    const conflict = NextlyError.conflict();
    const nextly = racing(
      [
        { id: "p1", layout: FENCED, status: "draft" },
        { id: "p1", layout: FENCED, status: "draft" },
      ],
      conflict
    );

    expect(
      await refusal(clearPageReference(nextly as never, "pages", "p1", FENCED))
    ).toBe(conflict);
  });
});
